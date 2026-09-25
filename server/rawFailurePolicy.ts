import { airbyteConfigFetch } from './airbyteClient';
import type { SupabaseClient } from '@supabase/supabase-js';

// -----------------------------------------------------------------------------
// Política de falha da camada Raw (ver docs/ARQUITETURA.md, "Política de falha
// da Raw"). Duas peças ficam aqui para o gateway inteiro usar igual:
//
// 1) SCHEMA_CHANGE_POLICY — o que o Airbyte faz quando o schema da origem muda.
//    Vai em toda conexão criada (POST /connections) e é aplicado às existentes
//    por POST /api/airbyte/connections/schema-policy.
//      - Mudança NÃO incompatível (coluna nova/removida, tipo alterado): as
//        colunas são propagadas para a Raw sozinhas (`propagate_columns`). A
//        Bronze lista as colunas explicitamente (server/dbtCodegen.ts), então
//        continua funcionando; a coluna nova só chega à Bronze quando os modelos
//        forem regenerados (POST /api/dbt/models/from-integration).
//      - Mudança INCOMPATÍVEL (chave primária ou cursor removido/alterado): o
//        Airbyte sempre bloqueia a conexão — não há configuração que evite. Ela
//        é detectada em diagnoseSyncFailure() como categoria 'schema_incompativel'.
//
// 2) diagnoseSyncFailure() — lê o motivo real da falha de um job (a API pública
//    só devolve status 'failed'), classifica e devolve uma mensagem acionável.
//    É o que vai para pipeline_runs.raw_erro e para alertas_ingestao (sql/015).
// -----------------------------------------------------------------------------

export const SCHEMA_CHANGE_POLICY = {
  nonBreakingSchemaUpdatesBehavior: 'propagate_columns',
} as const;

export type RawFailureCategory =
  | 'schema_incompativel'
  | 'schema_desatualizado'
  | 'configuracao'
  | 'origem'
  | 'destino'
  | 'transitorio'
  | 'plataforma'
  | 'desconhecido';

export interface RawFailureDiagnosis {
  categoria: RawFailureCategory;
  /** 'critica' = precisa de ação humana; 'alta' = pode resolver sozinha numa nova execução. */
  severidade: 'critica' | 'alta';
  /** Frase curta para o usuário — o que houve e o que fazer. */
  mensagem: string;
  /** Mensagem original do Airbyte (quando disponível). */
  detalhe: string | null;
}

interface AirbyteFailure {
  failureOrigin?: string;
  failureType?: string;
  externalMessage?: string;
  internalMessage?: string;
}

interface ConfigJobInfo {
  attempts?: Array<{ attempt?: { status?: string; failureSummary?: { failures?: AirbyteFailure[] } } }>;
}

const ACTION: Record<RawFailureCategory, string> = {
  schema_incompativel:
    'Mudança de schema incompatível na origem (chave primária ou cursor alterado/removido). O Airbyte bloqueou a conexão: revise e aceite o novo schema na conexão do Airbyte, regenere os modelos dbt da integração e execute de novo com "Do zero".',
  schema_desatualizado:
    'O schema da origem mudou (coluna ou tabela removida/alterada) e o catálogo da conexão no Airbyte estava desatualizado, então a sincronização falhou. Isso não é erro de configuração. A próxima execução pelo Studio (com sincronização) atualiza o catálogo antes de sincronizar; se falhar de novo, use "Refresh source schema" na conexão do Airbyte. Veja os alertas de mudança de schema da integração em Pipelines & Fluxos — a tabela afetada pode estar com a atualização bloqueada.',
  configuracao:
    'Erro de configuração (credencial, permissão ou parâmetro da origem/destino). Corrija a configuração e execute de novo.',
  origem: 'A origem de dados falhou durante a leitura. Verifique se o sistema de origem está acessível e execute de novo.',
  destino: 'O destino (BigQuery) recusou a gravação. Verifique permissões/cota do dataset Raw e execute de novo.',
  transitorio: 'Falha temporária (rede/timeout). O Airbyte já tentou de novo; execute outra vez mais tarde.',
  plataforma: 'Falha interna do Airbyte. Verifique a VM do Airbyte e execute de novo.',
  desconhecido: 'A sincronização falhou no Airbyte e o motivo não pôde ser lido. Consulte o log do job no Airbyte.',
};

// Mensagens do Airbyte para um sync com catálogo desatualizado (a origem mudou
// depois da última atualização do catálogo da conexão). Vêm com failureType
// 'config_error', mas a causa é mudança de schema, não configuração.
const STALE_CATALOG_PATTERNS = [
  /not found in stream/i,
  /refresh the source schema/i,
  /schema (has )?changed/i,
  /column .* (does not exist|not found)/i,
];

function classify(f: AirbyteFailure | undefined): RawFailureCategory {
  if (!f) return 'desconhecido';
  const type = f.failureType || '';
  const origin = f.failureOrigin || '';
  const text = `${f.externalMessage || ''} ${f.internalMessage || ''}`;
  if (type === 'refresh_schema') return 'schema_incompativel';
  if (STALE_CATALOG_PATTERNS.some((re) => re.test(text))) return 'schema_desatualizado';
  if (type === 'config_error') return 'configuracao';
  if (type === 'transient_error' || type === 'heartbeat_timeout' || type === 'destination_timeout') return 'transitorio';
  if (origin === 'source') return 'origem';
  if (origin === 'destination') return 'destino';
  if (origin === 'airbyte_platform' || origin === 'persistence' || origin === 'replication') return 'plataforma';
  return 'desconhecido';
}

function build(categoria: RawFailureCategory, detalhe: string | null): RawFailureDiagnosis {
  return {
    categoria,
    severidade: categoria === 'transitorio' || categoria === 'schema_desatualizado' ? 'alta' : 'critica',
    mensagem: ACTION[categoria],
    detalhe: detalhe ? detalhe.slice(0, 2000) : null,
  };
}

/**
 * Motivo da falha de um job de sync. Nunca lança: se a API interna do Airbyte
 * não responder, devolve 'desconhecido' com o erro no detalhe — quem chama
 * (auto-sync, Studio) segue registrando a falha de qualquer jeito.
 */
export async function diagnoseSyncFailure(connectionId: string, jobId: number): Promise<RawFailureDiagnosis> {
  let failure: AirbyteFailure | undefined;
  let lookupError: string | null = null;
  try {
    const info = await airbyteConfigFetch<ConfigJobInfo>('/jobs/get', { id: jobId });
    // A última tentativa é a que decidiu o status final do job.
    const attempts = info.attempts || [];
    for (let i = attempts.length - 1; i >= 0 && !failure; i--) {
      failure = attempts[i].attempt?.failureSummary?.failures?.[0];
    }
  } catch (err) {
    lookupError = err instanceof Error ? err.message : String(err);
  }

  // A conexão marcada com breakingChange é a fonte mais confiável para mudança
  // de schema incompatível — vale mesmo se o failureType veio genérico.
  try {
    const conn = await airbyteConfigFetch<{ breakingChange?: boolean }>('/connections/get', { connectionId });
    if (conn.breakingChange) {
      return build('schema_incompativel', failure?.externalMessage || null);
    }
  } catch {
    // sem essa informação, fica só com a classificação do job
  }

  if (!failure) {
    return build('desconhecido', lookupError ? `Não foi possível ler o motivo no Airbyte: ${lookupError}` : null);
  }
  return build(classify(failure), failure.externalMessage || failure.internalMessage || null);
}

/** Texto gravado em pipeline_runs.raw_erro: a ação recomendada + a mensagem original. */
export function rawErrorText(d: RawFailureDiagnosis): string {
  return d.detalhe ? `${d.mensagem}\nAirbyte: ${d.detalhe}` : d.mensagem;
}

/**
 * Grava a falha do sync: motivo em pipeline_runs (se houver a linha do job) e
 * um alerta em alertas_ingestao (um por job — o índice único evita duplicar
 * quando o Studio e o auto-sync veem a mesma falha). Falhas de gravação só são
 * logadas: o registro nunca pode derrubar quem chamou.
 */
export async function recordRawFailure(
  supabase: SupabaseClient,
  args: {
    idEmpresa: number;
    integracaoId: number;
    integracaoNome: string;
    pipelineId: number | null;
    jobId: number;
    diagnosis: RawFailureDiagnosis;
  },
): Promise<void> {
  const { idEmpresa, integracaoId, integracaoNome, pipelineId, jobId, diagnosis } = args;
  if (pipelineId) {
    const { error } = await supabase
      .from('pipeline_runs')
      .update({ raw_erro: rawErrorText(diagnosis), raw_erro_categoria: diagnosis.categoria })
      .eq('pipeline_id', pipelineId)
      .eq('airbyte_job_id', jobId);
    if (error) console.error('Falha ao gravar raw_erro em pipeline_runs:', error.message);
  }
  const { error } = await supabase.from('alertas_ingestao').upsert(
    {
      id_empresa: idEmpresa,
      integracao_id: integracaoId,
      integracao_nome: integracaoNome,
      airbyte_job_id: jobId,
      categoria: diagnosis.categoria,
      severidade: diagnosis.severidade,
      mensagem: diagnosis.mensagem,
      detalhe: diagnosis.detalhe,
    },
    { onConflict: 'integracao_id,airbyte_job_id', ignoreDuplicates: true },
  );
  if (error) console.error('Falha ao gravar alerta de ingestão:', error.message);
}

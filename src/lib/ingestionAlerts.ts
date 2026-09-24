import { supabase } from './supabase';
import type { RawFailureDiagnosis } from './airbyteGateway';

// -----------------------------------------------------------------------------
// Alertas de falha da camada Raw (tabela alertas_ingestao, sql/015). Um alerta
// por sync que falhou no Airbyte, visível para toda a empresa na tela Execuções
// até alguém marcá-lo como resolvido. Gravados pelo gateway (auto-sync) e pelo
// Studio Gold (lineageExecution.ts) — ver server/rawFailurePolicy.ts.
// -----------------------------------------------------------------------------

export interface IngestionAlert {
  id: number;
  integracaoNome: string;
  airbyteJobId: number | null;
  categoria: RawFailureDiagnosis['categoria'];
  severidade: RawFailureDiagnosis['severidade'];
  mensagem: string;
  detalhe: string | null;
  criadoEm: string;
}

export const CATEGORY_LABEL: Record<RawFailureDiagnosis['categoria'], string> = {
  schema_incompativel: 'Schema incompatível',
  configuracao: 'Configuração',
  origem: 'Origem',
  destino: 'Destino',
  transitorio: 'Temporária',
  plataforma: 'Airbyte',
  desconhecido: 'Desconhecida',
};

/** A tabela ainda não existe no banco (migração sql/015 não aplicada). */
export function isMissingAlertsTable(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  const msg = `${e?.message ?? err ?? ''}`;
  return e?.code === 'PGRST205' || e?.code === '42P01' || (/alertas_ingestao/.test(msg) && /(schema cache|does not exist|could not find)/i.test(msg));
}

/** Texto gravado em pipeline_runs.raw_erro — mesmo formato de rawErrorText() no gateway. */
export function rawErrorText(d: RawFailureDiagnosis): string {
  return d.detalhe ? `${d.mensagem}\nAirbyte: ${d.detalhe}` : d.mensagem;
}

/** Alertas em aberto, mais recentes primeiro. O isolamento por empresa é feito pela RLS. */
export async function fetchOpenIngestionAlerts(): Promise<IngestionAlert[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('alertas_ingestao')
    .select('id, integracao_nome, airbyte_job_id, categoria, severidade, mensagem, detalhe, criado_em')
    .is('resolvido_em', null)
    .order('criado_em', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data || []).map((r) => ({
    id: Number(r.id),
    integracaoNome: String(r.integracao_nome),
    airbyteJobId: r.airbyte_job_id != null ? Number(r.airbyte_job_id) : null,
    categoria: (r.categoria in CATEGORY_LABEL ? r.categoria : 'desconhecido') as IngestionAlert['categoria'],
    severidade: r.severidade === 'alta' ? 'alta' : 'critica',
    mensagem: String(r.mensagem),
    detalhe: (r.detalhe as string) || null,
    criadoEm: String(r.criado_em),
  }));
}

export async function resolveIngestionAlert(id: number, resolvidoPor: string | null): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('alertas_ingestao')
    .update({ resolvido_em: new Date().toISOString(), resolvido_por: resolvidoPor })
    .eq('id', id);
  if (error) throw error;
}

/**
 * Registro da falha feito pelo Studio (sessão do usuário) — mesmo efeito de
 * recordRawFailure() no gateway: motivo em pipeline_runs (quando o pipeline está
 * persistido) + um alerta por job (índice único evita duplicar com o auto-sync).
 */
export async function recordRawFailure(args: {
  idEmpresa: number;
  integracaoId: number;
  integracaoNome: string;
  pipelineDbId: number | null;
  jobId: number;
  diagnosis: RawFailureDiagnosis;
}): Promise<void> {
  if (!supabase) return;
  const { idEmpresa, integracaoId, integracaoNome, pipelineDbId, jobId, diagnosis } = args;
  if (pipelineDbId) {
    const { error } = await supabase
      .from('pipeline_runs')
      .update({ raw_erro: rawErrorText(diagnosis), raw_erro_categoria: diagnosis.categoria })
      .eq('pipeline_id', pipelineDbId)
      .eq('airbyte_job_id', jobId);
    if (error) throw error;
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
  if (error) throw error;
}

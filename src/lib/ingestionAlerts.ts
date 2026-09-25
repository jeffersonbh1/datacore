import { supabase } from './supabase';
import type { RawFailureDiagnosis } from './airbyteGateway';

// -----------------------------------------------------------------------------
// Alertas das integrações (tabela alertas_ingestao, sql/015 + sql/016). Tudo que
// muda numa integração vira um alerta, que o engenheiro de dados marca como
// ciente/resolvido — e ele vai para o histórico:
//   falha_sync           sync da Raw falhou (gateway/Studio — server/rawFailurePolicy.ts)
//   mudanca_schema       schema da origem mudou (server/schemaChangeCheck.ts)
//   alteracao_integracao tabelas incluídas/removidas pelo Editar (AutoPipelineView)
//   falha_construcao     Bronze/Silver falhou no Studio (lineageExecution.ts)
// Exibidos por integração em Pipelines & Fluxos e, os abertos, na tela Execuções.
// -----------------------------------------------------------------------------

export type AlertTipo = 'falha_sync' | 'mudanca_schema' | 'alteracao_integracao' | 'falha_construcao';
export type AlertSeveridade = 'critica' | 'alta' | 'media' | 'info';

export interface IngestionAlert {
  id: number;
  integracaoId: number | null;
  integracaoNome: string;
  airbyteJobId: number | null;
  tipo: AlertTipo;
  categoria: string;
  severidade: AlertSeveridade;
  mensagem: string;
  detalhe: string | null;
  criadoEm: string;
  resolvidoEm: string | null;
  resolvidoPor: string | null;
  /** Tabela (stream da origem) do alerta, quando for de uma tabela específica (sql/017). */
  tabela: string | null;
  /** Enquanto aberto, bloqueia a atualização da tabela em Bronze/Silver/Gold (sql/017). */
  bloqueante: boolean;
}

export const TIPO_LABEL: Record<AlertTipo, string> = {
  falha_sync: 'Falha de sincronização',
  mudanca_schema: 'Mudança de schema',
  alteracao_integracao: 'Alteração da integração',
  falha_construcao: 'Falha de construção',
};

const CATEGORY_LABEL: Record<string, string> = {
  // falha_sync (RawFailureDiagnosis)
  schema_incompativel: 'Schema incompatível',
  schema_desatualizado: 'Schema desatualizado no Airbyte',
  configuracao: 'Configuração',
  origem: 'Origem',
  destino: 'Destino',
  transitorio: 'Temporária',
  plataforma: 'Airbyte',
  desconhecido: 'Desconhecida',
  // mudanca_schema
  tabela_nova: 'Tabela nova',
  tabela_removida: 'Tabela removida',
  coluna_nova: 'Coluna nova',
  coluna_removida: 'Coluna removida',
  tipo_alterado: 'Tipo alterado',
  chave_alterada: 'Chave primária alterada',
  // alteracao_integracao
  tabelas_incluidas: 'Tabelas incluídas',
  tabelas_removidas: 'Tabelas removidas',
  // falha_construcao
  bronze: 'Bronze',
  silver: 'Silver',
};

export const categoryLabel = (c: string): string => CATEGORY_LABEL[c] ?? c;

export const SEVERIDADE_STYLE: Record<AlertSeveridade, { label: string; cls: string; order: number }> = {
  critica: { label: 'Crítica', cls: 'bg-rose-50 text-rose-700 border-rose-200', order: 0 },
  alta: { label: 'Alta', cls: 'bg-amber-50 text-amber-700 border-amber-200', order: 1 },
  media: { label: 'Média', cls: 'bg-yellow-50 text-yellow-700 border-yellow-200', order: 2 },
  info: { label: 'Info', cls: 'bg-sky-50 text-sky-700 border-sky-200', order: 3 },
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

const TIPOS: AlertTipo[] = ['falha_sync', 'mudanca_schema', 'alteracao_integracao', 'falha_construcao'];
const SEVERIDADES: AlertSeveridade[] = ['critica', 'alta', 'media', 'info'];

// select('*'): antes da migração 016 a coluna `tipo` não existe — o alerta é tratado como falha_sync.
function mapRow(r: Record<string, unknown>): IngestionAlert {
  return {
    id: Number(r.id),
    integracaoId: r.integracao_id != null ? Number(r.integracao_id) : null,
    integracaoNome: String(r.integracao_nome ?? ''),
    airbyteJobId: r.airbyte_job_id != null ? Number(r.airbyte_job_id) : null,
    tipo: TIPOS.find((t) => t === r.tipo) ?? 'falha_sync',
    categoria: String(r.categoria ?? 'desconhecido'),
    severidade: SEVERIDADES.find((s) => s === r.severidade) ?? 'critica',
    mensagem: String(r.mensagem ?? ''),
    detalhe: (r.detalhe as string) || null,
    criadoEm: String(r.criado_em),
    resolvidoEm: (r.resolvido_em as string) || null,
    resolvidoPor: (r.resolvido_por as string) || null,
    tabela: (r.tabela as string) || null,
    bloqueante: r.bloqueante === true,
  };
}

/** integracaoId → (tabela → motivo): tabelas com alerta bloqueante em aberto. */
export type BlockedTables = Map<number, Map<string, string>>;

/**
 * Tabelas bloqueadas por mudança de schema (alerta bloqueante em aberto) em todas
 * as integrações da empresa (RLS). Antes da migração 017 (sem a coluna
 * `bloqueante`) não existe bloqueio: devolve vazio.
 */
export async function fetchBlockedTables(): Promise<BlockedTables> {
  const out: BlockedTables = new Map();
  if (!supabase) return out;
  const { data, error } = await supabase
    .from('alertas_ingestao')
    .select('integracao_id, tabela, mensagem, criado_em')
    .eq('bloqueante', true)
    .is('resolvido_em', null)
    .order('criado_em', { ascending: false });
  if (error) {
    if (/bloqueante|tabela/.test(error.message) && /does not exist|could not find|schema cache/i.test(error.message)) return out;
    throw error;
  }
  for (const r of data || []) {
    if (r.integracao_id == null || !r.tabela) continue;
    const id = Number(r.integracao_id);
    const byTable = out.get(id) ?? new Map<string, string>();
    if (!byTable.has(r.tabela)) byTable.set(r.tabela, String(r.mensagem));
    out.set(id, byTable);
  }
  return out;
}

/** Alertas em aberto da empresa (todas as integrações), mais recentes primeiro. Isolamento pela RLS. */
export async function fetchOpenIngestionAlerts(): Promise<IngestionAlert[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('alertas_ingestao')
    .select('*')
    .is('resolvido_em', null)
    .order('criado_em', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data || []).map(mapRow);
}

/** Alertas de uma integração: os abertos e o histórico (resolvidos, mais recentes primeiro). */
export async function fetchIntegrationAlerts(integracaoId: number, historyLimit = 100): Promise<{ open: IngestionAlert[]; history: IngestionAlert[] }> {
  if (!supabase) return { open: [], history: [] };
  const [open, history] = await Promise.all([
    supabase.from('alertas_ingestao').select('*').eq('integracao_id', integracaoId).is('resolvido_em', null)
      .order('criado_em', { ascending: false }),
    supabase.from('alertas_ingestao').select('*').eq('integracao_id', integracaoId).not('resolvido_em', 'is', null)
      .order('resolvido_em', { ascending: false }).limit(historyLimit),
  ]);
  if (open.error) throw open.error;
  if (history.error) throw history.error;
  return { open: (open.data || []).map(mapRow), history: (history.data || []).map(mapRow) };
}

export interface OpenAlertSummary { count: number; worst: AlertSeveridade }

/** Quantidade de alertas abertos e a pior severidade, por integração (badge em Pipelines & Fluxos). */
export async function fetchOpenAlertSummary(): Promise<Map<number, OpenAlertSummary>> {
  const out = new Map<number, OpenAlertSummary>();
  for (const a of await fetchOpenIngestionAlerts()) {
    if (a.integracaoId == null) continue;
    const cur = out.get(a.integracaoId);
    if (!cur) out.set(a.integracaoId, { count: 1, worst: a.severidade });
    else {
      cur.count += 1;
      if (SEVERIDADE_STYLE[a.severidade].order < SEVERIDADE_STYLE[cur.worst].order) cur.worst = a.severidade;
    }
  }
  return out;
}

/** Marca como ciente/resolvido — o alerta sai dos abertos e vai para o histórico. */
export async function resolveIngestionAlerts(ids: number[], resolvidoPor: string | null): Promise<void> {
  if (!supabase || ids.length === 0) return;
  const { error } = await supabase
    .from('alertas_ingestao')
    .update({ resolvido_em: new Date().toISOString(), resolvido_por: resolvidoPor })
    .in('id', ids);
  if (error) throw error;
}

export async function resolveIngestionAlert(id: number, resolvidoPor: string | null): Promise<void> {
  return resolveIngestionAlerts([id], resolvidoPor);
}

/**
 * Alerta genérico gravado pelo front (sessão do usuário): alteração da integração
 * pelo Editar e falha de construção no Studio. Integrações criadas nesta sessão
 * ainda têm id local — a linha é encontrada pela conexão do Airbyte.
 */
export async function recordIntegrationAlert(args: {
  idEmpresa: number;
  integration: { id: string | number; name: string; airbyteConnectionId?: string | null };
  tipo: Exclude<AlertTipo, 'falha_sync' | 'mudanca_schema'>;
  categoria: string;
  severidade: AlertSeveridade;
  mensagem: string;
  detalhe?: string | null;
}): Promise<void> {
  if (!supabase) return;
  const { idEmpresa, integration, tipo, categoria, severidade, mensagem, detalhe = null } = args;
  let integracaoId: number | null = /^\d+$/.test(String(integration.id)) ? Number(integration.id) : null;
  if (integracaoId === null && integration.airbyteConnectionId) {
    const { data } = await supabase.from('integracoes').select('id').eq('airbyte_connection_id', integration.airbyteConnectionId).maybeSingle();
    integracaoId = data ? Number(data.id) : null;
  }
  const { error } = await supabase.from('alertas_ingestao').insert({
    id_empresa: idEmpresa,
    integracao_id: integracaoId,
    integracao_nome: integration.name,
    tipo, categoria, severidade, mensagem, detalhe,
  });
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

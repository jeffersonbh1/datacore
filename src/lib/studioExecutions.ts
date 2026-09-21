import { supabase } from './supabase';

// -----------------------------------------------------------------------------
// Histórico das execuções feitas no Studio Visual ETL Gold (tabela
// studio_execucoes, sql/014). Uma linha por clique em "Executar" — fluxo inteiro ou
// tabela única —, com o resultado de cada tabela em `itens`. A tela Execuções lê
// daqui; o Studio Gold grava via ExecutionRecorder.
// -----------------------------------------------------------------------------

export type ExecItemLayer = 'raw' | 'bronze' | 'silver' | 'gold';
export type ExecScope = 'tabela' | 'fluxo';
export type ExecStatus = 'running' | 'success' | 'failed' | 'cancelled';

/** Resultado de uma tabela (ou, para layer 'raw', da sincronização de uma integração) numa execução. */
export interface ExecItem {
  layer: ExecItemLayer;
  /** Nome da tabela/modelo; para layer 'raw' é o nome da integração sincronizada. */
  name: string;
  integration: string | null;
  status: 'ok' | 'error' | 'skipped';
  rowsAffected: number | null;
  error: string | null;
  /** Só Gold: testes do dbt rodados junto com a construção. */
  tests: { total: number; failed: string[] } | null;
}

export interface StudioExecution {
  id: number;
  escopo: ExecScope;
  alvoNome: string;
  alvoCamada: ExecItemLayer;
  comSincronizacao: boolean;
  status: ExecStatus;
  itens: ExecItem[];
  executadoPor: string | null;
  iniciadoEm: string;
  finalizadoEm: string | null;
}

export interface ExecutionMeta {
  escopo: ExecScope;
  alvoNome: string;
  alvoCamada: ExecItemLayer;
  comSincronizacao: boolean;
  executadoPor: string | null;
}

const LAYERS: ExecItemLayer[] = ['raw', 'bronze', 'silver', 'gold'];
const ITEM_STATUSES = ['ok', 'error', 'skipped'] as const;
const EXEC_STATUSES: ExecStatus[] = ['running', 'success', 'failed', 'cancelled'];

/** Uma execução 'running' há mais que isto é tratada como interrompida (aba fechada no meio). */
export const STALE_RUNNING_MS = 45 * 60 * 1000;

/** A tabela ainda não existe no banco (migração sql/014 não aplicada). */
export function isMissingExecutionsTable(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  const msg = `${e?.message ?? err ?? ''}`;
  return e?.code === 'PGRST205' || e?.code === '42P01' || (/studio_execucoes/.test(msg) && /(schema cache|does not exist|could not find)/i.test(msg));
}

export const MISSING_TABLE_HINT = 'A tabela studio_execucoes ainda não existe no Supabase — rode sql/014_studio_execucoes.sql no SQL Editor para registrar as execuções aqui.';

const asString = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const asNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

/** `itens` vem de uma coluna JSONB: nunca confiar no formato — descarta o que não bate. */
export function parseItems(raw: unknown): ExecItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ExecItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const layer = LAYERS.find((l) => l === o.layer);
    const status = ITEM_STATUSES.find((s) => s === o.status);
    const name = asString(o.name);
    if (!layer || !status || !name) continue;
    const t = o.tests && typeof o.tests === 'object' ? (o.tests as Record<string, unknown>) : null;
    out.push({
      layer, name, status,
      integration: asString(o.integration),
      rowsAffected: asNumber(o.rowsAffected),
      error: asString(o.error),
      tests: t && asNumber(t.total) !== null
        ? { total: asNumber(t.total)!, failed: Array.isArray(t.failed) ? t.failed.filter((x): x is string => typeof x === 'string') : [] }
        : null,
    });
  }
  return out;
}

function mapRow(row: Record<string, unknown>): StudioExecution {
  return {
    id: Number(row.id),
    escopo: row.escopo === 'tabela' ? 'tabela' : 'fluxo',
    alvoNome: String(row.alvo_nome ?? ''),
    alvoCamada: LAYERS.find((l) => l === row.alvo_camada) ?? 'gold',
    comSincronizacao: Boolean(row.com_sincronizacao),
    status: EXEC_STATUSES.find((s) => s === row.status) ?? 'failed',
    itens: parseItems(row.itens),
    executadoPor: asString(row.executado_por),
    iniciadoEm: String(row.iniciado_em),
    finalizadoEm: row.finalizado_em ? String(row.finalizado_em) : null,
  };
}

/** Mais recentes primeiro. O isolamento por empresa é feito pela RLS da tabela. */
export async function fetchStudioExecutions(limit = 100): Promise<StudioExecution[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('studio_execucoes')
    .select('id, escopo, alvo_nome, alvo_camada, com_sincronizacao, status, itens, executado_por, iniciado_em, finalizado_em')
    .order('iniciado_em', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map(mapRow);
}

/** Uma execução 'running' que passou de STALE_RUNNING_MS não vai mais terminar. */
export function isStaleRunning(e: Pick<StudioExecution, 'status' | 'iniciadoEm'>, now = Date.now()): boolean {
  return e.status === 'running' && now - new Date(e.iniciadoEm).getTime() > STALE_RUNNING_MS;
}

/**
 * Grava uma execução do começo ao fim sem NUNCA atrapalhá-la: qualquer falha de gravação
 * (migração 014 não aplicada, rede, RLS) só é lembrada em `lastError` — quem executa segue.
 * As gravações são serializadas (uma cadeia de promises), então a atualização final nunca
 * é ultrapassada por uma anterior.
 */
export class ExecutionRecorder {
  private id: number | null = null;
  private items = new Map<string, ExecItem>();
  private chain: Promise<void> = Promise.resolve();
  /** Última falha de gravação (null se tudo foi gravado). */
  lastError: unknown = null;

  constructor(private readonly idEmpresa: number | null, private readonly meta: ExecutionMeta) {}

  get enabled(): boolean { return Boolean(supabase && this.idEmpresa); }

  private enqueue(fn: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(fn).catch((err) => { this.lastError = err; console.error('Erro ao registrar a execução:', err); });
    return this.chain;
  }

  start(): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    return this.enqueue(async () => {
      const { data, error } = await supabase!
        .from('studio_execucoes')
        .insert({
          id_empresa: this.idEmpresa,
          escopo: this.meta.escopo,
          alvo_nome: this.meta.alvoNome,
          alvo_camada: this.meta.alvoCamada,
          com_sincronizacao: this.meta.comSincronizacao,
          executado_por: this.meta.executadoPor,
          status: 'running',
          itens: [],
        })
        .select('id')
        .single();
      if (error) throw error;
      this.id = Number(data.id);
    });
  }

  /** Registra (ou substitui) o resultado de uma tabela e persiste o conjunto. */
  record(item: ExecItem): void {
    this.items.set(`${item.layer}:${item.integration ?? ''}:${item.name}`, item);
    if (!this.enabled) return;
    const snapshot = [...this.items.values()];
    this.enqueue(async () => {
      if (this.id === null) return; // o INSERT inicial falhou: nada a atualizar
      const { error } = await supabase!.from('studio_execucoes').update({ itens: snapshot }).eq('id', this.id);
      if (error) throw error;
    });
  }

  finish(status: Exclude<ExecStatus, 'running'>): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    const snapshot = [...this.items.values()];
    return this.enqueue(async () => {
      if (this.id === null) return;
      const { error } = await supabase!
        .from('studio_execucoes')
        .update({ status, itens: snapshot, finalizado_em: new Date().toISOString() })
        .eq('id', this.id);
      if (error) throw error;
    });
  }
}

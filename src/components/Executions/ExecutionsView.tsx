import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity, RefreshCw, CheckCircle, XCircle, Clock, ChevronDown,
  ChevronRight, ExternalLink, AlertCircle, Database, Boxes, Layers, FileText, X, Play, History, Loader2
} from 'lucide-react';
import { Pipeline, CanvasNode } from '../../types';
import { PipelineRunSummary, TableBuildResult, isGeneralLayerFailure } from '../../lib/pipelineBuilder';
import {
  fetchPipelineRunsForPipeline, upsertPipelineRuns, updatePipelineRunLayerStatus,
  insertTableRebuildAttempt, fetchTableRebuildHistory, TableRebuildAttempt,
} from '../../lib/supabase';
import { fetchConnectionJobs, buildBronzeLayer, buildSilverLayer, fetchRawTableCounts } from '../../lib/airbyteGateway';
import { StudioExecutionsSection } from './StudioExecutionsSection';

type Layer = 'bronze' | 'silver';

interface ExecutionsViewProps {
  pipelines: Pipeline[];
  /** true enquanto os pipelines persistidos ainda estão sendo buscados
   *  (Supabase + métricas reais do Airbyte) — evita mostrar "Nenhum pipeline
   *  com conexão real" antes da busca real terminar. */
  isLoading?: boolean;
  onNavigateToStudio: (pipelineId: string) => void;
  /** Necessária para reconciliar runs presos em "running"/"pending" com o
   *  status real do Airbyte (ver reconcileOpenRuns) — sem ela, a tela ainda
   *  lê o histórico normalmente, só não se auto-corrige. */
  idEmpresa?: number | null;
}

const RUN_STATUS_LABEL: Record<PipelineRunSummary['status'], string> = {
  pending: 'Na fila',
  running: 'Sincronizando',
  incomplete: 'Incompleto',
  failed: 'Falhou',
  succeeded: 'Sucesso',
  cancelled: 'Cancelado',
};

const OPEN_RUN_STATUSES: PipelineRunSummary['status'][] = ['pending', 'running'];

/** Execuções mostradas por página na tabela de histórico de cada pipeline. */
const RUNS_PER_PAGE = 12;

/** Quantos registros de histórico buscar do Supabase por pipeline — precisa ser
 *  bem maior que RUNS_PER_PAGE para a paginação ter mais de uma página de verdade. */
const HISTORY_FETCH_LIMIT = 100;

/**
 * Um run ainda está "em andamento" se a Raw não terminou, OU se já terminou
 * (com sucesso) mas uma camada que este pipeline realmente tem (Bronze/Silver
 * configurados com destino BigQuery) ainda não foi tentada ('not_applicable').
 * Sem checar se a camada existe de verdade, pipelines sem Bronze/Silver BigQuery
 * ficariam sendo repolled para sempre, já que 'not_applicable' nunca muda para eles.
 */
const TERMINAL_LAYER_STATUSES: PipelineRunSummary['bronzeStatus'][] = ['built', 'failed'];

function isRunOpen(pipeline: Pipeline, run: PipelineRunSummary | undefined): boolean {
  if (!run) return false;
  if (OPEN_RUN_STATUSES.includes(run.status)) return true;
  if (run.status !== 'succeeded') return false;
  const hasBronzeLayer = pipeline.nodes.some(n => n.type === 'bronze' && n.config.bigquery);
  const hasSilverLayer = pipeline.nodes.some(n => n.type === 'silver' && n.config.bigquery);
  if (hasBronzeLayer && !TERMINAL_LAYER_STATUSES.includes(run.bronzeStatus)) return true;
  if (hasSilverLayer && !TERMINAL_LAYER_STATUSES.includes(run.silverStatus)) return true;
  return false;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR');
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}min ${seconds}s` : `${seconds}s`;
}

function RawStatusBadge({ status }: { status: PipelineRunSummary['status'] }) {
  const cls = status === 'succeeded'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : status === 'failed'
    ? 'bg-rose-50 text-rose-700 border-rose-200'
    : status === 'running' || status === 'pending'
    ? 'bg-amber-50 text-amber-700 border-amber-200'
    : 'bg-slate-100 text-slate-600 border-slate-200';
  const Icon = status === 'succeeded' ? CheckCircle : status === 'failed' ? XCircle : Clock;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border font-mono font-medium ${cls}`}>
      <Icon className={`w-3 h-3 ${status === 'running' ? 'animate-spin' : ''}`} />
      {RUN_STATUS_LABEL[status]}
    </span>
  );
}

function LayerStatusBadge({ status }: { status: 'not_applicable' | 'running' | 'built' | 'failed' }) {
  if (status === 'not_applicable') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border font-mono font-medium bg-slate-100 text-slate-500 border-slate-200">
        <Clock className="w-3 h-3" /> Pendente
      </span>
    );
  }
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border font-mono font-medium bg-amber-50 text-amber-700 border-amber-200">
        <RefreshCw className="w-3 h-3 animate-spin" /> Construindo
      </span>
    );
  }
  const cls = status === 'built'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-rose-50 text-rose-700 border-rose-200';
  const Icon = status === 'built' ? CheckCircle : XCircle;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border font-mono font-medium ${cls}`}>
      <Icon className="w-3 h-3" /> {status === 'built' ? 'Construída' : 'Falhou'}
    </span>
  );
}

function LayerTablesList({
  label,
  layer,
  tables,
  onOpenLog,
  onRetry,
  isRetrying,
  canRetry,
}: {
  label: string;
  layer: Layer;
  tables: TableBuildResult[] | null;
  onOpenLog: (layer: string, result: TableBuildResult) => void;
  onRetry: (layer: Layer, table: TableBuildResult) => void;
  isRetrying: (layer: Layer, table: string) => boolean;
  canRetry: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">{label}</p>
      {!tables || tables.length === 0 ? (
        <p className="text-[11px] text-slate-400">Sem detalhe disponível para este run.</p>
      ) : (
        <ul className="space-y-1">
          {tables.map(t => {
            const retrying = isRetrying(layer, t.table);
            return (
              <li
                key={t.table}
                className="flex items-center justify-between gap-2 text-[11px] bg-white border border-slate-200 rounded px-2 py-1"
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  {t.status === 'ok'
                    ? <CheckCircle className="w-3 h-3 text-emerald-600 shrink-0" />
                    : <XCircle className="w-3 h-3 text-rose-600 shrink-0" />}
                  <span className="truncate text-slate-700">{t.table}</span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="font-mono text-slate-500">
                    {t.rowsAffected != null ? t.rowsAffected.toLocaleString('pt-BR') : '—'}
                  </span>
                  {t.status === 'error' && canRetry && (
                    <button
                      type="button"
                      onClick={() => onRetry(layer, t)}
                      disabled={retrying}
                      title={`Executar novamente só "${t.table}"`}
                      className="flex items-center gap-1 px-1.5 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded text-[10px] font-medium border border-indigo-200 transition cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <Play className={`w-3 h-3 ${retrying ? 'animate-pulse' : ''}`} /> {retrying ? 'Executando...' : 'Executar'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onOpenLog(label, t)}
                    title={`Ver log de "${t.table}"`}
                    className="flex items-center gap-1 px-1.5 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded text-[10px] font-medium border border-slate-200 transition cursor-pointer"
                  >
                    <FileText className="w-3 h-3" /> Log
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Nomes das tabelas desta integração, para listar sob a Raw — o Airbyte já as
 * sincroniza todas num único job (a API pública só devolve status agregado do
 * job, não por stream/tabela — ver GET /jobs/{jobId}), então a lista vem dos
 * nós Bronze (1:1 com as tabelas selecionadas na wizard), com fallback pra
 * Silver caso um pipeline não tenha nós Bronze por algum motivo.
 */
function getPipelineTableNames(pipeline: Pipeline): string[] {
  const bronzeTitles = pipeline.nodes.filter(n => n.type === 'bronze').map(n => n.title);
  if (bronzeTitles.length > 0) return bronzeTitles;
  return pipeline.nodes.filter(n => n.type === 'silver').map(n => n.title);
}

/**
 * Lista de tabelas da Raw para um pipeline — sem botão "Executar" (ao
 * contrário de Bronze/Silver): reexecutar a Raw significa disparar a conexão
 * inteira no Airbyte de novo, não uma tabela isolada. A contagem de registros
 * vem de um SELECT COUNT(*) ao vivo no BigQuery (fetchRawTableCounts) — a Raw
 * é sincronizada pelo Airbyte, não pelo dbt, então não existe um retrato por
 * execução como bronze_tables/silver_tables; por isso o mesmo resultado
 * aparece em qualquer run expandido deste pipeline (é sempre "agora").
 */
function RawTablesList({
  tables,
  loading,
  error,
  onOpenLog,
}: {
  tables: TableBuildResult[] | null;
  loading: boolean;
  error: string | null;
  onOpenLog: (layer: string, result: TableBuildResult) => void;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Raw</p>
      {loading ? (
        <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
          <RefreshCw className="w-3 h-3 animate-spin" /> Consultando contagens no BigQuery...
        </p>
      ) : error ? (
        <p className="text-[11px] text-rose-600">{error}</p>
      ) : !tables || tables.length === 0 ? (
        <p className="text-[11px] text-slate-400">Sem tabelas configuradas para este pipeline.</p>
      ) : (
        <>
          <ul className="space-y-1">
            {tables.map(t => (
              <li
                key={t.table}
                className="flex items-center justify-between gap-2 text-[11px] bg-white border border-slate-200 rounded px-2 py-1"
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  {t.status === 'ok'
                    ? <CheckCircle className="w-3 h-3 text-emerald-600 shrink-0" />
                    : <XCircle className="w-3 h-3 text-rose-600 shrink-0" />}
                  <span className="truncate text-slate-700">{t.table}</span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="font-mono text-slate-500">
                    {t.rowsAffected != null ? t.rowsAffected.toLocaleString('pt-BR') : '—'}
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpenLog('Raw', t)}
                    title={`Ver detalhe de "${t.table}"`}
                    className="flex items-center gap-1 px-1.5 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded text-[10px] font-medium border border-slate-200 transition cursor-pointer"
                  >
                    <FileText className="w-3 h-3" /> Log
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-slate-400 mt-1.5">
            Contagem atual da tabela no BigQuery — não é um retrato desta execução específica.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Auto-cura runs presos em 'pending'/'running' no nosso banco: consulta o
 * Airbyte de verdade e, se o job já terminou lá, grava o resultado real em
 * pipeline_runs antes de exibir. Existe porque a atualização "ao vivo" feita
 * pelo Studio (VisualCanvas.handleExecutePipeline) depende de uma aba do
 * navegador continuar rodando um polling em segundo plano até o fim — se o
 * usuário navegar, trocar de aba (o Chrome throttla timers em abas em
 * background) ou fechar a janela no meio, essa atualização nunca chega. Esta
 * tela vira, assim, a fonte de verdade que se autocorrige a cada refresh,
 * independente do que aconteceu no Studio.
 */
async function reconcileOpenRuns(
  pipeline: Pipeline,
  runs: PipelineRunSummary[],
  idEmpresa: number | null | undefined
): Promise<PipelineRunSummary[]> {
  const openRuns = runs.filter(r => OPEN_RUN_STATUSES.includes(r.status));
  if (openRuns.length === 0 || !pipeline.airbyteConnectionId || !idEmpresa || !pipeline.dbId) {
    return runs;
  }
  try {
    const realJobs = await fetchConnectionJobs(pipeline.airbyteConnectionId, 20);
    const realByJobId = new Map(realJobs.map(j => [j.jobId, j]));
    const finished = openRuns
      .map(r => realByJobId.get(r.airbyteJobId))
      .filter((j): j is NonNullable<typeof j> => Boolean(j) && j!.status !== 'pending' && j!.status !== 'running');
    if (finished.length === 0) return runs;
    await upsertPipelineRuns(idEmpresa, pipeline.dbId, finished);
    // Relê do banco para pegar os campos já calculados (duração em ms, etc.)
    // em vez de duplicar aqui o parsing que upsertPipelineRuns/mapPipelineRunRow já fazem.
    return await fetchPipelineRunsForPipeline(pipeline.dbId, Math.max(runs.length, HISTORY_FETCH_LIMIT));
  } catch (err) {
    console.error(`Erro ao reconciliar execuções com o Airbyte para "${pipeline.name}":`, err);
    return runs;
  }
}

export const ExecutionsView: React.FC<ExecutionsViewProps> = ({ pipelines, isLoading = false, onNavigateToStudio, idEmpresa }) => {
  const trackedPipelines = pipelines.filter(p => p.airbyteConnectionId);

  const [runsByPipeline, setRunsByPipeline] = useState<Record<string, PipelineRunSummary[]>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Chave "<pipelineId>:<airbyteJobId>" do run cujo detalhe por tabela está aberto.
  const [expandedRunKey, setExpandedRunKey] = useState<string | null>(null);
  // Página atual (0-based) da tabela de execuções de cada pipeline — RUNS_PER_PAGE
  // por vez, em vez do histórico inteiro numa lista só.
  const [runsPageByPipeline, setRunsPageByPipeline] = useState<Record<string, number>>({});
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [logModal, setLogModal] = useState<{
    layer: string; result: TableBuildResult; pipelineId: string; pipelineDbId: number;
  } | null>(null);
  const [logHistory, setLogHistory] = useState<{ loading: boolean; items: TableRebuildAttempt[]; error: string | null }>({
    loading: false, items: [], error: null,
  });
  const [fetchError, setFetchError] = useState<string | null>(null);
  // Chave "<pipelineId>:<airbyteJobId>:<layer>:<table>" da tabela sendo
  // reexecutada agora — controla o botão "Executar" individualmente por linha.
  const [retryingKeys, setRetryingKeys] = useState<Record<string, boolean>>({});
  // Contagens ao vivo das tabelas Raw por pipeline (não por run — ver RawTablesList).
  const [rawTablesByPipeline, setRawTablesByPipeline] = useState<Record<string, {
    loading: boolean; tables: TableBuildResult[]; error: string | null;
  }>>({});

  useEffect(() => {
    if (!logModal) {
      setLogHistory({ loading: false, items: [], error: null });
      return;
    }
    // A Raw não tem reexecução manual por tabela (dbt_table_rebuilds só aceita
    // layer 'bronze'/'silver' — ver sql/011) — nada a buscar.
    if (logModal.layer.toLowerCase() === 'raw') {
      setLogHistory({ loading: false, items: [], error: null });
      return;
    }
    let cancelled = false;
    setLogHistory({ loading: true, items: [], error: null });
    fetchTableRebuildHistory(logModal.pipelineDbId, logModal.layer.toLowerCase() as Layer, logModal.result.table)
      .then(items => { if (!cancelled) setLogHistory({ loading: false, items, error: null }); })
      .catch(err => {
        if (cancelled) return;
        setLogHistory({ loading: false, items: [], error: err instanceof Error ? err.message : 'Falha ao carregar histórico.' });
      });
    return () => { cancelled = true; };
  }, [logModal]);

  const loadRawTables = useCallback(async (pipeline: Pipeline) => {
    if (rawTablesByPipeline[pipeline.id] && (rawTablesByPipeline[pipeline.id].loading || rawTablesByPipeline[pipeline.id].tables.length > 0)) {
      return; // já carregado ou carregando — a contagem é a mesma pra qualquer run deste pipeline.
    }
    const bronzeNode = pipeline.nodes.find(n => n.type === 'bronze' && n.config.bigquery);
    const bq = bronzeNode?.config.bigquery;
    const tables = getPipelineTableNames(pipeline);
    if (!bq || tables.length === 0) return; // destino não-BigQuery, ou sem tabelas configuradas.

    setRawTablesByPipeline(prev => ({ ...prev, [pipeline.id]: { loading: true, tables: [], error: null } }));
    try {
      const { counts } = await fetchRawTableCounts({ projectId: bq.projectId, rawDataset: bq.rawDataset, tables, location: bq.location });
      setRawTablesByPipeline(prev => ({ ...prev, [pipeline.id]: { loading: false, tables: counts, error: null } }));
    } catch (err) {
      setRawTablesByPipeline(prev => ({
        ...prev,
        [pipeline.id]: { loading: false, tables: [], error: err instanceof Error ? err.message : 'Falha ao consultar contagens da Raw.' },
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawTablesByPipeline]);

  const handleRetryTable = useCallback(async (pipeline: Pipeline, run: PipelineRunSummary, layer: Layer, table: TableBuildResult) => {
    const key = `${pipeline.id}:${run.airbyteJobId}:${layer}:${table.table}`;
    if (retryingKeys[key] || !pipeline.dbId) return;

    const node = pipeline.nodes.find((n: CanvasNode) => n.type === layer && n.title === table.table);
    const bq = node?.config.bigquery;
    if (!bq) {
      setFetchError(`Não encontrei a configuração BigQuery do nó "${table.table}" (${layer}) no Studio — abra o pipeline lá antes de tentar de novo.`);
      return;
    }

    setRetryingKeys(prev => ({ ...prev, [key]: true }));
    let result: TableBuildResult;
    try {
      const { results } = layer === 'bronze'
        ? await buildBronzeLayer({ projectId: bq.projectId, rawDataset: bq.rawDataset, bronzeDataset: bq.bronzeDataset, tables: [table.table], sistema: bq.sistema, location: bq.location })
        : await buildSilverLayer({ projectId: bq.projectId, rawDataset: bq.rawDataset, bronzeDataset: bq.bronzeDataset, silverDataset: bq.silverDataset, tables: [table.table], sistema: bq.sistema, location: bq.location });
      const r = results[0];
      result = { table: table.table, status: r?.status === 'ok' ? 'ok' : 'error', rowsAffected: r?.rowsAffected ?? null, error: r?.status === 'ok' ? null : (r?.error || 'dbt build não retornou resultado para esta tabela.') };
    } catch (err) {
      result = { table: table.table, status: 'error', rowsAffected: null, error: err instanceof Error ? err.message : 'Falha ao executar o dbt build.' };
    }

    // Mescla só esta tabela no array já existente do run (as demais tabelas
    // desta camada não são retocadas) e recalcula o status geral da camada —
    // mantém a linha do run consistente, sem criar um run novo.
    const existing = (layer === 'bronze' ? run.bronzeTables : run.silverTables) || [];
    const merged = existing.some(t => t.table === table.table)
      ? existing.map(t => (t.table === table.table ? result : t))
      : [...existing, result];
    const overallStatus: 'built' | 'failed' = merged.every(t => t.status === 'ok') ? 'built' : 'failed';
    const failedOnes = merged.filter(t => t.status === 'error');
    const aggregateError = failedOnes.length ? failedOnes.map(t => `${t.table}: ${t.error}`).join(' | ') : undefined;

    try {
      await updatePipelineRunLayerStatus(pipeline.dbId, run.airbyteJobId, layer, overallStatus, aggregateError, merged);
    } catch (err) {
      console.error('Erro ao persistir status da camada após reexecução manual:', err);
    }
    if (idEmpresa) {
      try {
        await insertTableRebuildAttempt(idEmpresa, pipeline.dbId, layer, table.table, result);
      } catch (err) {
        console.error('Erro ao registrar histórico de reexecução manual:', err);
      }
    }

    setRunsByPipeline(prev => ({
      ...prev,
      [pipeline.id]: (prev[pipeline.id] || []).map(r => r.airbyteJobId !== run.airbyteJobId ? r : {
        ...r,
        ...(layer === 'bronze'
          ? { bronzeStatus: overallStatus, bronzeError: aggregateError || null, bronzeTables: merged }
          : { silverStatus: overallStatus, silverError: aggregateError || null, silverTables: merged }),
      }),
    }));
    setRetryingKeys(prev => { const next = { ...prev }; delete next[key]; return next; });
    // Se o log desta mesma tabela estiver aberto, atualiza a lista empilhada na hora.
    setLogModal(prev => (prev && prev.pipelineId === pipeline.id && prev.layer.toLowerCase() === layer && prev.result.table === table.table)
      ? { ...prev, result }
      : prev);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryingKeys, idEmpresa]);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      let firstError: string | null = null;
      const entries = await Promise.all(
        trackedPipelines
          .filter(p => p.dbId)
          .map(async p => {
            try {
              const runs = await fetchPipelineRunsForPipeline(p.dbId!, HISTORY_FETCH_LIMIT);
              const reconciled = await reconcileOpenRuns(p, runs, idEmpresa);
              return [p.id, reconciled] as const;
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(`Erro ao buscar execuções do pipeline "${p.name}":`, err);
              firstError = firstError || `Falha ao carregar "${p.name}": ${msg}`;
              return [p.id, []] as const;
            }
          })
      );
      setRunsByPipeline(Object.fromEntries(entries));
      setFetchError(firstError);
      setLastRefreshedAt(new Date());
    } finally {
      setIsRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackedPipelines.map(p => `${p.id}:${p.dbId}`).join(','), idEmpresa]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  // Enquanto algum pipeline tiver um run em andamento (Raw pendente/rodando, ou
  // Bronze/Silver ainda não tentados), reconsulta periodicamente — mesmo padrão
  // de polling já usado no Studio (VisualCanvas) para o nó "source".
  useEffect(() => {
    const hasOpenRun = trackedPipelines.some(p => isRunOpen(p, runsByPipeline[p.id]?.[0]));
    if (!hasOpenRun) return;
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runsByPipeline, refresh]);

  return (
    <div id="executions-view-container" className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <Activity className="w-4.5 h-4.5 text-indigo-600" />
            Execuções
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Acompanhamento real de cada camada (Raw no Airbyte, Bronze e Silver via dbt) por pipeline e, no
            bloco do Studio Visual ETL Gold, de tudo que foi executado por lá (inclusive tabelas isoladas e Gold) —
            sobrevive à navegação entre telas, ao contrário do progresso mostrado no Studio.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastRefreshedAt && (
            <span className="text-[11px] text-slate-400">
              Atualizado às {lastRefreshedAt.toLocaleTimeString('pt-BR')}
            </span>
          )}
          <button
            id="btn-refresh-executions"
            onClick={refresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-medium transition cursor-pointer shadow-2xs disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>
      </div>

      {fetchError && (
        <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="flex-1">{fetchError}</span>
          <button type="button" onClick={() => setFetchError(null)} className="text-rose-500 hover:text-rose-700 cursor-pointer">✕</button>
        </div>
      )}

      <StudioExecutionsSection refreshKey={lastRefreshedAt?.getTime() ?? 0} />

      {isLoading && trackedPipelines.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-16 text-center text-slate-500 space-y-2 shadow-sm">
          <Loader2 className="w-8 h-8 text-indigo-400 mx-auto animate-spin" />
          <h4 className="text-sm font-semibold text-slate-800">Carregando pipelines...</h4>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Buscando as integrações e pipelines persistidos da sua empresa.
          </p>
        </div>
      ) : trackedPipelines.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-16 text-center text-slate-500 space-y-2 shadow-sm">
          <Activity className="w-10 h-10 text-slate-300 mx-auto" />
          <h4 className="text-sm font-semibold text-slate-800">Nenhum pipeline com conexão real no Airbyte</h4>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Crie uma integração no Pipeline Automático para acompanhar suas execuções aqui.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {trackedPipelines.map(pipeline => {
            const runs = runsByPipeline[pipeline.id] || [];
            const latest = runs[0];
            const isExpanded = expandedId === pipeline.id;
            const noHistoryYet = !pipeline.dbId;
            const totalPages = Math.max(1, Math.ceil(runs.length / RUNS_PER_PAGE));
            const runsPage = Math.min(runsPageByPipeline[pipeline.id] || 0, totalPages - 1);
            const pageStart = runsPage * RUNS_PER_PAGE;
            const pagedRuns = runs.slice(pageStart, pageStart + RUNS_PER_PAGE);

            return (
              <div key={pipeline.id} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <button
                  type="button"
                  onClick={() => {
                    setExpandedId(isExpanded ? null : pipeline.id);
                    if (!isExpanded) setRunsPageByPipeline(prev => ({ ...prev, [pipeline.id]: 0 }));
                  }}
                  className="w-full flex items-center justify-between gap-4 p-4 text-left hover:bg-slate-50/60 transition cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">{pipeline.name}</p>
                      <p className="text-[11px] text-slate-500">
                        {noHistoryYet
                          ? 'Histórico indisponível nesta sessão — recarregue a página após criar a integração.'
                          : latest ? `Última execução: ${formatDateTime(latest.finalizadoEm || latest.iniciadoEm)}` : 'Nenhuma execução registrada ainda.'}
                      </p>
                    </div>
                  </div>

                  {latest && (
                    <div className="flex items-center gap-4 shrink-0">
                      <div className="hidden sm:flex items-center gap-1.5" title="Raw (Airbyte)">
                        <Database className="w-3.5 h-3.5 text-slate-400" />
                        <RawStatusBadge status={latest.status} />
                      </div>
                      <div className="hidden md:flex items-center gap-1.5" title="Bronze (dbt)">
                        <Layers className="w-3.5 h-3.5 text-slate-400" />
                        <LayerStatusBadge status={latest.bronzeStatus} />
                      </div>
                      <div className="hidden md:flex items-center gap-1.5" title="Silver (dbt)">
                        <Boxes className="w-3.5 h-3.5 text-slate-400" />
                        <LayerStatusBadge status={latest.silverStatus} />
                      </div>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onNavigateToStudio(pipeline.id); }}
                        className="flex items-center gap-1 px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-[11px] font-medium border border-indigo-200 transition cursor-pointer"
                      >
                        <ExternalLink className="w-3 h-3" /> Studio
                      </button>
                    </div>
                  )}
                </button>

                {isExpanded && (
                  <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3">
                    {runs.length === 0 ? (
                      <p className="text-xs text-slate-500 py-2">Nenhuma execução registrada ainda para este pipeline.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-slate-400 uppercase text-[10px] tracking-wider">
                              <th className="py-1.5 pr-1 font-medium w-5"></th>
                              <th className="py-1.5 pr-3 font-medium">Início</th>
                              <th className="py-1.5 pr-3 font-medium">Raw</th>
                              <th className="py-1.5 pr-3 font-medium">Bronze</th>
                              <th className="py-1.5 pr-3 font-medium">Silver</th>
                              <th className="py-1.5 pr-3 font-medium">Registros</th>
                              <th className="py-1.5 pr-3 font-medium">Duração</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pagedRuns.map(run => {
                              const runKey = `${pipeline.id}:${run.airbyteJobId}`;
                              const isRunExpanded = expandedRunKey === runKey;

                              return (
                                <React.Fragment key={run.airbyteJobId}>
                                  <tr
                                    className="border-t border-slate-200/70 hover:bg-slate-50/60 cursor-pointer"
                                    onClick={() => {
                                      setExpandedRunKey(isRunExpanded ? null : runKey);
                                      if (!isRunExpanded) loadRawTables(pipeline);
                                    }}
                                  >
                                    <td className="py-1.5 pr-1">
                                      {isRunExpanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                                    </td>
                                    <td className="py-1.5 pr-3 text-slate-600 whitespace-nowrap">{formatDateTime(run.iniciadoEm)}</td>
                                    <td className="py-1.5 pr-3"><RawStatusBadge status={run.status} /></td>
                                    <td className="py-1.5 pr-3"><LayerStatusBadge status={run.bronzeStatus} /></td>
                                    <td className="py-1.5 pr-3"><LayerStatusBadge status={run.silverStatus} /></td>
                                    <td className="py-1.5 pr-3 text-slate-600 font-mono">{run.recordsSynced ?? '—'}</td>
                                    <td className="py-1.5 pr-3 text-slate-600 font-mono">{formatDuration(run.durationMs)}</td>
                                  </tr>
                                  {isRunExpanded && (
                                    <tr className="border-t border-slate-200/70 bg-white">
                                      <td colSpan={7} className="p-3">
                                        {/* Erro GERAL (mesma causa em várias tabelas da mesma camada — ex.: queda de
                                            conexão com o BigQuery) fica num card preso a ESTA execução (data/hora da
                                            linha acima), não num banner solto no fim da lista referindo-se sempre à
                                            última execução. Erro por tabela (causas diferentes) não repete aqui — já
                                            fica no botão de log de cada tabela abaixo. */}
                                        {isGeneralLayerFailure(run.bronzeTables) && (
                                          <div className="mb-3 flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-800 text-[11px] rounded-lg px-2.5 py-1.5">
                                            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                            <span>
                                              <span className="font-semibold">Erro geral na Bronze em {formatDateTime(run.iniciadoEm)}: </span>
                                              {run.bronzeError}
                                            </span>
                                          </div>
                                        )}
                                        {isGeneralLayerFailure(run.silverTables) && (
                                          <div className="mb-3 flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-800 text-[11px] rounded-lg px-2.5 py-1.5">
                                            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                            <span>
                                              <span className="font-semibold">Erro geral na Silver em {formatDateTime(run.iniciadoEm)}: </span>
                                              {run.silverError}
                                            </span>
                                          </div>
                                        )}
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                          <RawTablesList
                                            tables={rawTablesByPipeline[pipeline.id]?.tables ?? null}
                                            loading={Boolean(rawTablesByPipeline[pipeline.id]?.loading)}
                                            error={rawTablesByPipeline[pipeline.id]?.error ?? null}
                                            onOpenLog={(layer, result) => setLogModal({ layer, result, pipelineId: pipeline.id, pipelineDbId: pipeline.dbId! })}
                                          />
                                          <LayerTablesList
                                            label="Bronze"
                                            layer="bronze"
                                            tables={run.bronzeTables}
                                            onOpenLog={(layer, result) => setLogModal({ layer, result, pipelineId: pipeline.id, pipelineDbId: pipeline.dbId! })}
                                            onRetry={(layer, table) => handleRetryTable(pipeline, run, layer, table)}
                                            isRetrying={(layer, table) => Boolean(retryingKeys[`${pipeline.id}:${run.airbyteJobId}:${layer}:${table}`])}
                                            canRetry={Boolean(pipeline.dbId)}
                                          />
                                          <LayerTablesList
                                            label="Silver"
                                            layer="silver"
                                            tables={run.silverTables}
                                            onOpenLog={(layer, result) => setLogModal({ layer, result, pipelineId: pipeline.id, pipelineDbId: pipeline.dbId! })}
                                            onRetry={(layer, table) => handleRetryTable(pipeline, run, layer, table)}
                                            isRetrying={(layer, table) => Boolean(retryingKeys[`${pipeline.id}:${run.airbyteJobId}:${layer}:${table}`])}
                                            canRetry={Boolean(pipeline.dbId)}
                                          />
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </React.Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {totalPages > 1 && (
                      <div className="flex items-center justify-between mt-2 text-[11px] text-slate-500">
                        <span>
                          Mostrando {pageStart + 1}–{Math.min(pageStart + RUNS_PER_PAGE, runs.length)} de {runs.length} execuções
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={runsPage === 0}
                            onClick={() => setRunsPageByPipeline(prev => ({ ...prev, [pipeline.id]: runsPage - 1 }))}
                            className="px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer font-medium"
                          >
                            Anterior
                          </button>
                          <span className="font-mono">Página {runsPage + 1} de {totalPages}</span>
                          <button
                            type="button"
                            disabled={runsPage >= totalPages - 1}
                            onClick={() => setRunsPageByPipeline(prev => ({ ...prev, [pipeline.id]: runsPage + 1 }))}
                            className="px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer font-medium"
                          >
                            Próxima
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {logModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2 min-w-0">
                <div className={`p-2 rounded-lg shrink-0 ${logModal.result.status === 'ok' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                  <FileText className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-900 truncate">{logModal.result.table}</h3>
                  <p className="text-[11px] text-slate-500">Camada {logModal.layer}</p>
                </div>
              </div>
              <button onClick={() => setLogModal(null)} className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-200 transition cursor-pointer shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4 text-xs max-h-[70vh] overflow-y-auto">
              <div>
                <p className="font-medium text-slate-700 mb-1.5">Resultado atual</p>
                <div className="flex items-center gap-4 mb-1.5">
                  <span className="flex items-center gap-1.5 text-slate-600">
                    <span className="font-medium">Status:</span>
                    {logModal.result.status === 'ok'
                      ? <span className="flex items-center gap-1 text-emerald-700"><CheckCircle className="w-3.5 h-3.5" /> OK</span>
                      : <span className="flex items-center gap-1 text-rose-700"><XCircle className="w-3.5 h-3.5" /> Erro</span>}
                  </span>
                  <span className="text-slate-600">
                    <span className="font-medium">Registros:</span>{' '}
                    <span className="font-mono">{logModal.result.rowsAffected != null ? logModal.result.rowsAffected.toLocaleString('pt-BR') : '—'}</span>
                  </span>
                </div>
                {logModal.result.error ? (
                  <pre className="bg-slate-950 text-slate-200 rounded-lg p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words max-h-64 overflow-y-auto select-text">
                    {logModal.result.error}
                  </pre>
                ) : (
                  <p className="text-slate-400 text-[11px]">Sem erros registrados para esta tabela.</p>
                )}
              </div>

              <div className="border-t border-slate-100 pt-3">
                <p className="font-medium text-slate-700 mb-1.5 flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-slate-400" />
                  Histórico de reexecuções manuais
                </p>
                {logModal.layer.toLowerCase() === 'raw' ? (
                  <p className="text-slate-400 text-[11px]">
                    Não se aplica à Raw — a sincronização é sempre da conexão inteira no Airbyte, não de uma tabela isolada.
                    Para atualizar, dispare uma nova sincronização pelo Studio.
                  </p>
                ) : logHistory.loading ? (
                  <p className="text-slate-400 text-[11px] flex items-center gap-1.5"><RefreshCw className="w-3 h-3 animate-spin" /> Carregando...</p>
                ) : logHistory.error ? (
                  <p className="text-rose-600 text-[11px]">{logHistory.error}</p>
                ) : logHistory.items.length === 0 ? (
                  <p className="text-slate-400 text-[11px]">Nenhuma reexecução manual desta tabela ainda — use o botão "Executar" na lista pra tentar de novo.</p>
                ) : (
                  <ul className="space-y-2">
                    {logHistory.items.map(item => (
                      <li key={item.id} className="bg-slate-50 border border-slate-200 rounded-lg p-2">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="flex items-center gap-1.5">
                            {item.status === 'ok'
                              ? <CheckCircle className="w-3 h-3 text-emerald-600" />
                              : <XCircle className="w-3 h-3 text-rose-600" />}
                            <span className="font-mono text-slate-500">{formatDateTime(item.executadoEm)}</span>
                          </span>
                          <span className="font-mono text-slate-500">
                            {item.rowsAffected != null ? `${item.rowsAffected.toLocaleString('pt-BR')} regs` : '—'}
                          </span>
                        </div>
                        {item.error && (
                          <pre className="bg-slate-950 text-slate-200 rounded p-2 text-[10px] leading-relaxed whitespace-pre-wrap break-words max-h-40 overflow-y-auto select-text">
                            {item.error}
                          </pre>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

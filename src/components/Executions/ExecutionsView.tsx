import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity, RefreshCw, CheckCircle, XCircle, Clock, ChevronDown,
  ChevronRight, ExternalLink, AlertCircle, Database, Boxes, Layers, FileText, X
} from 'lucide-react';
import { Pipeline } from '../../types';
import { PipelineRunSummary, TableBuildResult } from '../../lib/pipelineBuilder';
import { fetchPipelineRunsForPipeline, upsertPipelineRuns } from '../../lib/supabase';
import { fetchConnectionJobs } from '../../lib/airbyteGateway';

interface ExecutionsViewProps {
  pipelines: Pipeline[];
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
  tables,
  onOpenLog,
}: {
  label: string;
  tables: TableBuildResult[] | null;
  onOpenLog: (layer: string, result: TableBuildResult) => void;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">{label}</p>
      {!tables || tables.length === 0 ? (
        <p className="text-[11px] text-slate-400">Sem detalhe disponível para este run.</p>
      ) : (
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
                  onClick={() => onOpenLog(label, t)}
                  title={`Ver log de "${t.table}"`}
                  className="flex items-center gap-1 px-1.5 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded text-[10px] font-medium border border-slate-200 transition cursor-pointer"
                >
                  <FileText className="w-3 h-3" /> Log
                </button>
              </span>
            </li>
          ))}
        </ul>
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
    return await fetchPipelineRunsForPipeline(pipeline.dbId, Math.max(runs.length, 10));
  } catch (err) {
    console.error(`Erro ao reconciliar execuções com o Airbyte para "${pipeline.name}":`, err);
    return runs;
  }
}

export const ExecutionsView: React.FC<ExecutionsViewProps> = ({ pipelines, onNavigateToStudio, idEmpresa }) => {
  const trackedPipelines = pipelines.filter(p => p.airbyteConnectionId);

  const [runsByPipeline, setRunsByPipeline] = useState<Record<string, PipelineRunSummary[]>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Chave "<pipelineId>:<airbyteJobId>" do run cujo detalhe por tabela está aberto.
  const [expandedRunKey, setExpandedRunKey] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [logModal, setLogModal] = useState<{ layer: string; result: TableBuildResult } | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      let firstError: string | null = null;
      const entries = await Promise.all(
        trackedPipelines
          .filter(p => p.dbId)
          .map(async p => {
            try {
              const runs = await fetchPipelineRunsForPipeline(p.dbId!, 10);
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
            Acompanhamento real de cada camada (Raw no Airbyte, Bronze e Silver via dbt) por pipeline —
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

      {trackedPipelines.length === 0 ? (
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

            return (
              <div key={pipeline.id} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : pipeline.id)}
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
                            {runs.map(run => {
                              const runKey = `${pipeline.id}:${run.airbyteJobId}`;
                              const isRunExpanded = expandedRunKey === runKey;

                              return (
                                <React.Fragment key={run.airbyteJobId}>
                                  <tr
                                    className="border-t border-slate-200/70 hover:bg-slate-50/60 cursor-pointer"
                                    onClick={() => setExpandedRunKey(isRunExpanded ? null : runKey)}
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
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                          <LayerTablesList label="Bronze" tables={run.bronzeTables} onOpenLog={(layer, result) => setLogModal({ layer, result })} />
                                          <LayerTablesList label="Silver" tables={run.silverTables} onOpenLog={(layer, result) => setLogModal({ layer, result })} />
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

                    {(runs[0]?.bronzeError || runs[0]?.silverError) && (
                      <div className="mt-2 flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-800 text-[11px] rounded-lg px-2.5 py-1.5">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>{runs[0].bronzeError || runs[0].silverError}</span>
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

            <div className="p-4 space-y-3 text-xs">
              <div className="flex items-center gap-4">
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

              <div>
                <p className="font-medium text-slate-700 mb-1">Log</p>
                {logModal.result.error ? (
                  <pre className="bg-slate-950 text-slate-200 rounded-lg p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words max-h-64 overflow-y-auto select-text">
                    {logModal.result.error}
                  </pre>
                ) : (
                  <p className="text-slate-400 text-[11px]">Sem erros registrados para esta tabela.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Maximize2, Play, RefreshCw, Workflow, X, ZoomIn, ZoomOut } from 'lucide-react';
import { Pipeline } from '../../types';
import {
  LAYER_LABEL, NODE_H, NODE_W, fetchLineage, focusOn, indexLineage, layoutGraph, nodesOfLayer,
  type Lineage, type LineageLayer, type LineageNode,
} from '../../lib/lineage';
import { blockedNodesInPlan, buildPlan, type ExecPlan, type ExecScope, type RunState } from '../../lib/lineageExecution';
import { fetchBlockedTables } from '../../lib/ingestionAlerts';
import { useExecutionJobs } from '../Executions/ExecutionJobsProvider';
import { DbtModelEditor } from './DbtModelEditor';
import { ExecutePlanModal } from './ExecutePlanModal';
import { LAYER_STYLE, LineageGraph } from './LineageGraph';
import { NodeDetailPanel } from './NodeDetailPanel';
import { TableCombobox } from './TableCombobox';

interface StudioGoldViewProps {
  pipelines: Pipeline[];
  idEmpresa: number | null;
  /** Perfis que podem executar (sincronizar/construir). */
  canExecute: boolean;
  /** Nome de quem executa, gravado no histórico da tela Execuções. */
  userName?: string | null;
}

const PICKER_LAYERS: Array<Extract<LineageLayer, 'raw' | 'bronze' | 'silver' | 'gold'>> = ['raw', 'bronze', 'silver', 'gold'];
const NO_STATES: Map<string, RunState> = new Map();

export const StudioGoldView: React.FC<StudioGoldViewProps> = ({ pipelines, idEmpresa, canExecute, userName = null }) => {
  const [lineage, setLineage] = useState<Lineage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  /** Modelo aberto no editor dbt em tela cheia (visualizar/editar/executar). */
  const [editingNode, setEditingNode] = useState<LineageNode | null>(null);
  /** Execução (em segundo plano) cujo andamento pinta o grafo — some ao escolher outra tabela. */
  const [statesJobId, setStatesJobId] = useState<string | null>(null);

  // Confirmação da execução. A execução em si roda em segundo plano, no gerenciador do app
  // (sino do cabeçalho): sobrevive a esta tela ser fechada.
  const [plan, setPlan] = useState<ExecPlan | null>(null);
  const [includeSync, setIncludeSync] = useState(true);
  const { jobs, store } = useExecutionJobs();
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      setLineage(await fetchLineage());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar a linhagem.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Uma execução terminou (mesmo em outra tela): recarrega linhas/“construída”/última atualização.
  const lastFinishedAt = useMemo(() => jobs.reduce((m, j) => Math.max(m, j.finishedAt ?? 0), 0), [jobs]);
  const seenFinishedAt = useRef(lastFinishedAt);
  useEffect(() => {
    if (lastFinishedAt > seenFinishedAt.current) { seenFinishedAt.current = lastFinishedAt; load(true); }
  }, [lastFinishedAt, load]);

  // Estados da última execução escolhida (para manter as cores de sucesso/erro após terminar) — some ao focar outra tabela.
  const selectedJobStates = useMemo(() => (statesJobId ? jobs.find((j) => j.id === statesJobId)?.runStates : undefined) ?? NO_STATES, [jobs, statesJobId]);
  // Execuções em andamento agora (de qualquer origem — inclusive iniciadas antes de focar esta tela) pintam
  // sempre que o nó estiver visível, mesmo trocando de tabela em foco: a animação não deve depender do
  // usuário ter ficado olhando para o job que a iniciou.
  const liveRunStates = useMemo(() => {
    const running = jobs.filter((j) => j.phase === 'running');
    if (running.length === 0) return NO_STATES;
    const m = new Map<string, RunState>();
    running.forEach((j) => j.runStates.forEach((state, id) => m.set(id, state)));
    return m;
  }, [jobs]);
  const runStates = useMemo(() => {
    if (liveRunStates.size === 0) return selectedJobStates;
    return new Map([...selectedJobStates, ...liveRunStates]);
  }, [selectedJobStates, liveRunStates]);

  const index = useMemo(() => (lineage ? indexLineage(lineage) : null), [lineage]);
  const focus = useMemo(() => (index && focusId && index.byId.has(focusId) ? focusOn(index, focusId) : null), [index, focusId]);
  const layout = useMemo(() => (index && focus ? layoutGraph(index, focus.ids) : null), [index, focus]);
  const edges = useMemo(() => (lineage && focus ? lineage.edges.filter((e) => focus.ids.has(e.source) && focus.ids.has(e.target)) : []), [lineage, focus]);
  const focusNode = focus && index ? index.byId.get(focus.id)! : null;
  const activeNode = activeId && index ? index.byId.get(activeId) ?? null : null;
  // O alvo da execução pode não ser a tabela em foco (o botão "Executar esta tabela" vale para qualquer nó do painel).
  const planTarget = plan && index ? index.byId.get(plan.focusId) ?? null : null;

  // Tabelas do plano bloqueadas por mudança de schema: com alguma, o botão Executar
  // fica desabilitado. runPlan confere de novo na hora (e após a verificação de schema).
  const [planBlocked, setPlanBlocked] = useState<Array<{ name: string; reason: string }>>([]);
  const [blocksStatus, setBlocksStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  useEffect(() => {
    setPlanBlocked([]);
    setBlocksStatus('loading');
    if (!plan || !index) return;
    let cancelled = false;
    fetchBlockedTables()
      .then((blocks) => {
        if (cancelled) return;
        setPlanBlocked([...blockedNodesInPlan(plan, index, blocks).values()]);
        setBlocksStatus('ok');
      })
      .catch(() => { if (!cancelled) setBlocksStatus('error'); });
    return () => { cancelled = true; };
  }, [plan, index]);

  const options = useMemo(() => {
    const out = {} as Record<(typeof PICKER_LAYERS)[number], LineageNode[]>;
    for (const l of PICKER_LAYERS) out[l] = lineage ? nodesOfLayer(lineage, l) : [];
    return out;
  }, [lineage]);

  const pick = (id: string) => {
    setFocusId(id || null);
    setActiveId(id || null);
    setStatesJobId(null);
  };

  // Ao focar uma tabela, centraliza-a na área do grafo.
  useEffect(() => {
    if (!focus || !layout || !scrollRef.current) return;
    const pos = layout.positions.get(focus.id);
    const box = scrollRef.current;
    if (!pos) return;
    box.scrollTo({
      left: Math.max(0, (pos.x + NODE_W / 2) * zoom - box.clientWidth / 2),
      top: Math.max(0, (pos.y + NODE_H / 2) * zoom - box.clientHeight / 2),
      behavior: 'smooth',
    });
    // Só reposiciona quando o foco muda (não a cada zoom).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.id, layout]);

  const fitToScreen = () => {
    if (!layout || !scrollRef.current) return;
    const box = scrollRef.current;
    setZoom(Math.max(0.4, Math.min(1, Math.min((box.clientWidth - 16) / layout.width, (box.clientHeight - 16) / layout.height))));
  };

  // ---- Execução
  const canRun = canExecute && !!focusNode && focusNode.layer !== 'source';
  /** 'fluxo' = até a tabela (com tudo que a alimenta); 'tabela' = só ela.
   *  `fullRefresh`: equivalente ao "Do zero" do Studio Visual ETL — reconstrói Bronze/Silver do zero. */
  const openPlan = (targetId: string, scope: ExecScope, fullRefresh = false) => {
    if (!index || !lineage || !index.byId.has(targetId)) return;
    const next = buildPlan(index, targetId, lineage.integrations, pipelines, scope, fullRefresh);
    setPlan(next);
    setIncludeSync(scope === 'fluxo' && next.integrations.some((i) => i.pipeline?.airbyteConnectionId || i.integration.airbyteConnectionId));
  };

  /** Confirmado: a execução vai para o segundo plano (sino do cabeçalho) e a janela de confirmação fecha. */
  const startRun = () => {
    if (!plan || !index) return;
    const canSyncAny = plan.integrations.some((i) => i.pipeline?.airbyteConnectionId || i.integration.airbyteConnectionId);
    const jobId = store.start({ plan, index, idEmpresa, userName, includeSync: plan.scope === 'fluxo' && includeSync && canSyncAny });
    setStatesJobId(jobId);
    setPlan(null);
  };

  const summary = useMemo(() => {
    if (!lineage) return [];
    return (['source', 'raw', 'bronze', 'silver', 'gold'] as LineageLayer[]).map((l) => {
      const ns = lineage.nodes.filter((n) => n.layer === l);
      return { layer: l, total: ns.length, built: ns.filter((n) => n.built).length };
    });
  }, [lineage]);

  return (
    <div className="flex flex-col gap-3 h-[calc(100vh-9rem)] min-h-[560px]">
      <header className="bg-white border border-slate-200 rounded-xl shadow-sm px-5 py-3.5 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2"><Workflow className="w-4.5 h-4.5 text-indigo-600" /> Studio Visual ETL Gold</h2>
            <p className="text-xs text-slate-500 mt-0.5">Escolha uma tabela e veja o fluxo inteiro: de onde o dado vem e para onde ele vai, mesmo entre integrações diferentes.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {focus && (
              <>
                <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden">
                  <button type="button" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(2)))} className="p-1.5 hover:bg-slate-50 cursor-pointer" aria-label="Diminuir zoom"><ZoomOut className="w-3.5 h-3.5 text-slate-600" /></button>
                  <span className="text-[11px] font-mono text-slate-500 w-10 text-center">{Math.round(zoom * 100)}%</span>
                  <button type="button" onClick={() => setZoom((z) => Math.min(1.4, +(z + 0.1).toFixed(2)))} className="p-1.5 hover:bg-slate-50 cursor-pointer" aria-label="Aumentar zoom"><ZoomIn className="w-3.5 h-3.5 text-slate-600" /></button>
                  <button type="button" onClick={fitToScreen} className="p-1.5 border-l border-slate-200 hover:bg-slate-50 cursor-pointer" aria-label="Ajustar à tela" title="Ajustar à tela"><Maximize2 className="w-3.5 h-3.5 text-slate-600" /></button>
                </div>
                <button type="button" onClick={() => pick('')} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50 cursor-pointer"><X className="w-3.5 h-3.5" /> Limpar</button>
              </>
            )}
            <button type="button" onClick={() => load()} disabled={loading} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50 disabled:opacity-50 cursor-pointer" title="Recarregar a linhagem e o estado das tabelas no BigQuery">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Atualizar
            </button>
            <button
              type="button"
              onClick={() => focus && openPlan(focus.id, 'fluxo')}
              disabled={!canRun}
              title={!canExecute ? 'Seu perfil não pode executar pipelines.' : !focusNode ? 'Escolha uma tabela para executar o fluxo até ela.' : focusNode.layer === 'source' ? 'Escolha uma tabela Raw, Bronze, Silver ou Gold.' : 'Executa tudo que alimenta esta tabela'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white cursor-pointer transition"
            >
              <Play className="w-3.5 h-3.5" /> Executar fluxo até aqui
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {PICKER_LAYERS.map((layer) => (
            <TableCombobox
              key={layer}
              label={`Tabela ${LAYER_LABEL[layer]}`}
              options={options[layer]}
              value={focusNode?.layer === layer ? focusNode.id : null}
              onChange={pick}
              placeholder={`Buscar tabela ${LAYER_LABEL[layer]}…`}
              disabled={loading}
            />
          ))}
        </div>
      </header>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-3">
        <section className="flex-1 min-w-0 min-h-0 bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col overflow-hidden">
          {focus && (
            <div className="flex items-center gap-4 px-4 py-2 border-b border-slate-100 text-[11px] text-slate-500 flex-wrap">
              <span className="flex items-center gap-1.5"><span className="w-5 h-0.5 rounded bg-indigo-500" /> de onde o dado vem ({focus.upstream.size})</span>
              <span className="flex items-center gap-1.5"><span className="w-5 h-0.5 rounded bg-emerald-500" /> para onde o dado vai ({focus.downstream.size})</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded ring-2 ring-indigo-300 bg-white" /> tabela escolhida</span>
            </div>
          )}

          <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto bg-[#f8fafc]" style={{ backgroundImage: 'radial-gradient(#e2e8f0 1px, transparent 1px)', backgroundSize: '22px 22px' }}>
            {loading && !lineage ? (
              <div className="h-full flex items-center justify-center text-sm text-slate-500 gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Montando a linhagem…</div>
            ) : error ? (
              <div className="h-full flex items-center justify-center p-6">
                <div className="max-w-md rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 space-y-2">
                  <p className="font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Não foi possível carregar a linhagem</p>
                  <p className="text-xs break-words">{error}</p>
                  <button type="button" onClick={() => load()} className="text-xs font-semibold text-red-700 underline cursor-pointer">Tentar de novo</button>
                </div>
              </div>
            ) : focus && layout && index ? (
              <LineageGraph index={index} edges={edges} focus={focus} layout={layout} activeId={activeId} runStates={runStates} zoom={zoom} onSelectNode={setActiveId} onOpenEditor={setEditingNode} />
            ) : lineage ? (
              <div className="h-full flex flex-col items-center justify-center text-center gap-5 p-6">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center"><Workflow className="w-6 h-6" /></div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Escolha uma tabela para ver a linhagem</h3>
                  <p className="text-xs text-slate-500 mt-1 max-w-md">Selecione uma tabela Raw, Bronze, Silver ou Gold acima. Vou mostrar todo o caminho até ela e tudo que depende dela — mesmo que passe por outra integração.</p>
                </div>
                <div className="flex gap-2 flex-wrap justify-center">
                  {summary.map((s) => (
                    <div key={s.layer} className={`rounded-xl border px-3.5 py-2 text-left ${LAYER_STYLE[s.layer].card}`}>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{LAYER_LABEL[s.layer]}</p>
                      <p className="text-sm font-bold text-slate-900">{s.total}</p>
                      {s.layer !== 'source' && <p className="text-[10px] text-slate-500">{s.built} construída(s)</p>}
                    </div>
                  ))}
                </div>
                {options.gold.length > 0 ? (
                  <div className="max-w-2xl">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Modelos Gold</p>
                    <div className="flex gap-1.5 flex-wrap justify-center">
                      {options.gold.slice(0, 16).map((n) => (
                        <button key={n.id} type="button" onClick={() => pick(n.id)} className="px-2.5 py-1 rounded-full text-xs border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 cursor-pointer">{n.name}</button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 max-w-md">Ainda não há modelos Gold. Peça um em <strong>Converse com os dados</strong> e salve-o: ele aparece aqui, ligado às Silvers de que depende.</p>
                )}
              </div>
            ) : null}
          </div>
        </section>

        {activeNode && index && (
          <NodeDetailPanel
            node={activeNode}
            index={index}
            isFocus={activeNode.id === focus?.id}
            onFocus={pick}
            onExecute={(id) => openPlan(id, 'tabela')}
            canExecute={canExecute}
            executeHint={canExecute ? undefined : 'Seu perfil não pode executar pipelines.'}
            isExecuting={jobs.some((j) => j.phase === 'running' && j.targetId === activeNode.id)}
            onOpenEditor={setEditingNode}
            onClose={() => setActiveId(null)}
          />
        )}
      </div>

      {editingNode && (
        <DbtModelEditor
          node={editingNode}
          canEdit={canExecute}
          editHint={canExecute ? undefined : 'Seu perfil não pode editar pipelines.'}
          isExecuting={jobs.some((j) => j.phase === 'running' && j.targetId === editingNode.id)}
          onExecute={(id) => openPlan(id, 'tabela')}
          onExecuteFullRefresh={(id) => openPlan(id, 'tabela', true)}
          onClose={() => setEditingNode(null)}
        />
      )}

      {plan && planTarget && (
        <ExecutePlanModal
          plan={plan}
          targetName={planTarget.name}
          targetLayer={planTarget.layer}
          phase="confirm"
          log={[]}
          result={null}
          includeSync={includeSync}
          onIncludeSyncChange={setIncludeSync}
          canSyncAny={plan.integrations.some((i) => i.pipeline?.airbyteConnectionId || i.integration.airbyteConnectionId)}
          cancelling={false}
          blockedReason={jobs.some((j) => j.phase === 'running' && j.targetId === plan.focusId)
            ? 'Esta tabela já está sendo executada agora. Aguarde terminar — acompanhe pelo sino no canto superior direito.'
            : null}
          onStart={startRun}
          onCancelRun={() => {}}
          onClose={() => setPlan(null)}
          onScopeChange={(scope) => openPlan(plan.focusId, scope, Boolean(plan.fullRefresh))}
          blocked={planBlocked}
          blocksStatus={blocksStatus}
        />
      )}
    </div>
  );
};

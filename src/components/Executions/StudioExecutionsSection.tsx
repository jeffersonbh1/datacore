import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle, ChevronDown, ChevronRight, Clock, Loader2, MinusCircle, RefreshCw, Workflow, XCircle } from 'lucide-react';
import {
  MISSING_TABLE_HINT, fetchStudioExecutions, isMissingExecutionsTable, isStaleRunning,
  type ExecItem, type ExecItemLayer, type StudioExecution,
} from '../../lib/studioExecutions';
import { LAYER_LABEL } from '../../lib/lineage';
import { LAYER_STYLE } from '../StudioGold/LineageGraph';

// -----------------------------------------------------------------------------
// Execuções feitas no Studio Visual ETL Gold — fluxo inteiro ou tabela única, com ou
// sem sincronização no Airbyte, em qualquer camada (inclusive Gold). É o histórico
// completo do que foi executado pela tela, com o resultado de cada tabela. Vem da
// tabela studio_execucoes (sql/014), gravada pelo Studio Gold enquanto executa —
// então uma execução em andamento já aparece aqui, mesmo se o usuário trocar de tela.
// -----------------------------------------------------------------------------

const PAGE = 10;
const POLL_MS = 4000;
const LAYER_ORDER: ExecItemLayer[] = ['raw', 'bronze', 'silver', 'gold'];

const formatDateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');

function formatDuration(ms: number | null): string {
  if (ms === null || ms < 0) return '—';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  return m > 0 ? `${m}min ${total % 60}s` : `${total}s`;
}

type DisplayStatus = 'running' | 'success' | 'failed' | 'cancelled' | 'interrupted';
const displayStatus = (e: StudioExecution): DisplayStatus => (isStaleRunning(e) ? 'interrupted' : e.status);

const STATUS_STYLE: Record<DisplayStatus, { cls: string; label: string }> = {
  running: { cls: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Em andamento' },
  success: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Sucesso' },
  failed: { cls: 'bg-rose-50 text-rose-700 border-rose-200', label: 'Falhou' },
  cancelled: { cls: 'bg-slate-100 text-slate-600 border-slate-200', label: 'Cancelada' },
  interrupted: { cls: 'bg-slate-100 text-slate-600 border-slate-200', label: 'Interrompida' },
};

function StatusBadge({ status }: { status: DisplayStatus }) {
  const { cls, label } = STATUS_STYLE[status];
  const Icon = status === 'success' ? CheckCircle : status === 'failed' ? XCircle : status === 'running' ? RefreshCw : Clock;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border font-mono font-medium whitespace-nowrap ${cls}`}>
      <Icon className={`w-3 h-3 ${status === 'running' ? 'animate-spin' : ''}`} /> {label}
    </span>
  );
}

function ItemStatusIcon({ status }: { status: ExecItem['status'] }) {
  if (status === 'ok') return <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />;
  if (status === 'error') return <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />;
  return <MinusCircle className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
}

/** "Fluxo até X (com sincronização)" / "Tabela X". */
function scopeLabel(e: StudioExecution): string {
  return e.escopo === 'tabela' ? 'Tabela' : e.comSincronizacao ? 'Fluxo + sync' : 'Fluxo';
}

function summarize(items: ExecItem[]) {
  const tables = items.filter((i) => i.layer !== 'raw');
  return {
    ok: tables.filter((i) => i.status === 'ok').length,
    error: items.filter((i) => i.status === 'error').length,
    skipped: items.filter((i) => i.status === 'skipped').length,
  };
}

function ItemsList({ execution }: { execution: StudioExecution }) {
  const items = useMemo(
    () => [...execution.itens].sort((a, b) => LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer)),
    [execution.itens],
  );
  const stale = isStaleRunning(execution);

  if (items.length === 0) {
    return (
      <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
        {execution.status === 'running' && !stale
          ? <><Loader2 className="w-3 h-3 animate-spin" /> Aguardando o primeiro resultado…</>
          : 'Nenhum resultado por tabela foi registrado para esta execução.'}
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {items.map((it) => (
        <li key={`${it.layer}:${it.integration ?? ''}:${it.name}`} className="bg-white border border-slate-200 rounded px-2.5 py-1.5 text-[11px]">
          <div className="flex items-start justify-between gap-3">
            <span className="flex items-start gap-1.5 min-w-0">
              <ItemStatusIcon status={it.status} />
              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 mt-px ${LAYER_STYLE[it.layer].badge}`}>{LAYER_LABEL[it.layer]}</span>
              <span className="min-w-0">
                <span className="font-mono text-slate-800 break-all">{it.layer === 'raw' ? `Sincronização — ${it.name}` : it.name}</span>
                {it.integration && it.layer !== 'raw' && <span className="text-slate-400"> · {it.integration}</span>}
              </span>
            </span>
            <span className="flex items-center gap-3 shrink-0 font-mono text-slate-500">
              {it.tests && (
                <span className={it.tests.failed.length ? 'text-amber-700' : 'text-emerald-700'} title={it.tests.failed.length ? `Falharam: ${it.tests.failed.join(', ')}` : 'Todos os testes passaram'}>
                  testes {it.tests.total - it.tests.failed.length}/{it.tests.total}
                </span>
              )}
              <span>{it.rowsAffected !== null ? `${it.rowsAffected.toLocaleString('pt-BR')} ${it.layer === 'raw' ? 'regs sync.' : 'linhas'}` : it.status === 'skipped' ? 'não executada' : '—'}</span>
            </span>
          </div>
          {it.tests && it.tests.failed.length > 0 && (
            <p className="mt-1 text-amber-700 break-all">Testes que falharam: {it.tests.failed.join(', ')}</p>
          )}
          {it.error && (
            <pre className={`mt-1.5 rounded p-2 text-[10px] leading-relaxed whitespace-pre-wrap break-words max-h-40 overflow-y-auto select-text ${it.status === 'skipped' ? 'bg-slate-100 text-slate-600' : 'bg-slate-950 text-slate-200'}`}>{it.error}</pre>
          )}
        </li>
      ))}
    </ul>
  );
}

interface StudioExecutionsSectionProps {
  /** Muda a cada atualização da tela Execuções — recarrega o histórico junto. */
  refreshKey: number;
}

export const StudioExecutionsSection: React.FC<StudioExecutionsSectionProps> = ({ refreshKey }) => {
  const [executions, setExecutions] = useState<StudioExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [visible, setVisible] = useState(PAGE);
  const [open, setOpen] = useState(true);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setExecutions(await fetchStudioExecutions());
      setError(null);
      setMissing(false);
    } catch (err) {
      if (isMissingExecutionsTable(err)) { setMissing(true); setError(null); }
      else setError(err instanceof Error ? err.message : (err as { message?: string })?.message ?? 'Falha ao carregar as execuções do Studio.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Só a primeira carga mostra "carregando…"; as seguintes (Atualizar, refresh periódico da tela) são silenciosas.
  const loadedOnce = useRef(false);
  useEffect(() => {
    load(loadedOnce.current).finally(() => { loadedOnce.current = true; });
  }, [load, refreshKey]);

  // Enquanto houver execução em andamento (de verdade, não abandonada), reconsulta.
  const hasRunning = executions.some((e) => e.status === 'running' && !isStaleRunning(e));
  useEffect(() => {
    if (!hasRunning) return;
    const t = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(t);
  }, [hasRunning, load]);

  const shown = executions.slice(0, visible);

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden" aria-label="Execuções do Studio Visual ETL Gold">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between gap-4 p-4 text-left hover:bg-slate-50/60 transition cursor-pointer">
        <div className="flex items-center gap-3 min-w-0">
          {open ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 flex items-center gap-2"><Workflow className="w-4 h-4 text-indigo-600" /> Studio Visual ETL Gold</p>
            <p className="text-[11px] text-slate-500">
              Tudo que foi executado pelo Studio — o fluxo inteiro ou uma única tabela, em qualquer camada (inclusive Gold), com o resultado de cada tabela.
            </p>
          </div>
        </div>
        <span className="text-[11px] text-slate-400 shrink-0">
          {loading ? 'carregando…' : missing ? '' : `${executions.length} execuç${executions.length === 1 ? 'ão' : 'ões'}`}
          {hasRunning && <span className="ml-2 text-amber-600 font-medium">· em andamento</span>}
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3 space-y-3">
          {missing && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-lg px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> <span>{MISSING_TABLE_HINT}</span>
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-lg px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> <span className="break-words">{error}</span>
            </div>
          )}

          {!missing && !error && !loading && executions.length === 0 && (
            <p className="text-xs text-slate-500 py-2">
              Nenhuma execução registrada ainda. Use “Executar esta tabela” ou “Executar fluxo até aqui” no Studio Visual ETL Gold e o resultado aparece aqui.
            </p>
          )}

          {shown.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-400 uppercase text-[10px] tracking-wider">
                    <th className="py-1.5 pr-1 font-medium w-5"></th>
                    <th className="py-1.5 pr-3 font-medium">Início</th>
                    <th className="py-1.5 pr-3 font-medium">Execução</th>
                    <th className="py-1.5 pr-3 font-medium">Tabela</th>
                    <th className="py-1.5 pr-3 font-medium">Resultado</th>
                    <th className="py-1.5 pr-3 font-medium">Status</th>
                    <th className="py-1.5 pr-3 font-medium">Duração</th>
                    <th className="py-1.5 pr-3 font-medium">Por</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((e) => {
                    const isOpen = expandedId === e.id;
                    const st = displayStatus(e);
                    const s = summarize(e.itens);
                    const duration = e.finalizadoEm ? new Date(e.finalizadoEm).getTime() - new Date(e.iniciadoEm).getTime() : null;
                    return (
                      <React.Fragment key={e.id}>
                        <tr className="border-t border-slate-200/70 hover:bg-slate-50/60 cursor-pointer" onClick={() => setExpandedId(isOpen ? null : e.id)}>
                          <td className="py-1.5 pr-1">{isOpen ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}</td>
                          <td className="py-1.5 pr-3 text-slate-600 whitespace-nowrap">{formatDateTime(e.iniciadoEm)}</td>
                          <td className="py-1.5 pr-3 whitespace-nowrap">
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${e.escopo === 'tabela' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-indigo-50 text-indigo-800 border-indigo-200'}`}>{scopeLabel(e)}</span>
                          </td>
                          <td className="py-1.5 pr-3 min-w-0">
                            <span className="flex items-center gap-1.5 min-w-0">
                              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ${LAYER_STYLE[e.alvoCamada].badge}`}>{LAYER_LABEL[e.alvoCamada]}</span>
                              <span className="font-mono text-slate-800 truncate max-w-[22rem]" title={e.alvoNome}>{e.alvoNome}</span>
                            </span>
                          </td>
                          <td className="py-1.5 pr-3 text-slate-600 whitespace-nowrap">
                            {e.itens.length === 0 ? '—' : (
                              <>
                                <span className="text-emerald-700">{s.ok} ok</span>
                                {s.error > 0 && <span className="text-rose-700"> · {s.error} falha{s.error > 1 ? 's' : ''}</span>}
                                {s.skipped > 0 && <span className="text-slate-400"> · {s.skipped} não executada{s.skipped > 1 ? 's' : ''}</span>}
                              </>
                            )}
                          </td>
                          <td className="py-1.5 pr-3"><StatusBadge status={st} /></td>
                          <td className="py-1.5 pr-3 text-slate-600 font-mono whitespace-nowrap">{formatDuration(duration)}</td>
                          <td className="py-1.5 pr-3 text-slate-500 truncate max-w-[10rem]" title={e.executadoPor ?? ''}>{e.executadoPor ?? '—'}</td>
                        </tr>
                        {isOpen && (
                          <tr className="border-t border-slate-200/70 bg-white">
                            <td colSpan={8} className="p-3">
                              <ItemsList execution={e} />
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

          {executions.length > visible && (
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>Mostrando {shown.length} de {executions.length} execuções</span>
              <button type="button" onClick={() => setVisible((v) => v + PAGE)} className="px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-100 cursor-pointer font-medium">Mostrar mais</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

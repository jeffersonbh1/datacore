import React, { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, MinusCircle, Play, X } from 'lucide-react';
import { ExecutionJobStore, isRunning, isUnseen, type ExecJob, type ExecToast, type ToastKind } from '../../lib/executionJobs';
import { ExecutePlanModal } from '../StudioGold/ExecutePlanModal';

// -----------------------------------------------------------------------------
// Liga o gerenciador de execuções em segundo plano (src/lib/executionJobs.ts) à
// interface: um store por sessão no nível do app, os avisos rápidos que aparecem ao
// iniciar/terminar uma execução e a janela de detalhe ("Executar tabela …") que abre
// ao clicar numa notificação do sino — de qualquer tela do sistema.
// -----------------------------------------------------------------------------

interface JobsContextValue {
  store: ExecutionJobStore;
  openJob: (jobId: string) => void;
}

const JobsContext = createContext<JobsContextValue | null>(null);

export function useExecutionJobs() {
  const ctx = useContext(JobsContext);
  if (!ctx) throw new Error('useExecutionJobs precisa estar dentro de <ExecutionJobsProvider>.');
  const state = useSyncExternalStore(ctx.store.subscribe, ctx.store.getSnapshot);
  return {
    store: ctx.store,
    jobs: state.jobs,
    toasts: state.toasts,
    openJob: ctx.openJob,
    runningCount: state.jobs.filter(isRunning).length,
    unseenJobs: state.jobs.filter(isUnseen),
  };
}

const TOAST_STYLE: Record<ToastKind, { box: string; icon: React.ReactNode }> = {
  started: { box: 'border-indigo-200 bg-indigo-50 text-indigo-900', icon: <Play className="w-4 h-4 text-indigo-600" /> },
  success: { box: 'border-emerald-200 bg-emerald-50 text-emerald-900', icon: <CheckCircle2 className="w-4 h-4 text-emerald-600" /> },
  failed: { box: 'border-rose-200 bg-rose-50 text-rose-900', icon: <AlertTriangle className="w-4 h-4 text-rose-600" /> },
  cancelled: { box: 'border-slate-200 bg-white text-slate-800', icon: <MinusCircle className="w-4 h-4 text-slate-500" /> },
};

const Toasts: React.FC<{ toasts: ExecToast[]; onOpen: (t: ExecToast) => void; onDismiss: (id: number) => void }> = ({ toasts, onOpen, onDismiss }) => {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-12 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] space-y-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          onClick={() => onOpen(t)}
          className={`flex items-start gap-2.5 rounded-xl border shadow-lg p-3 text-xs cursor-pointer ${TOAST_STYLE[t.kind].box}`}
        >
          <span className="mt-0.5 shrink-0">{TOAST_STYLE[t.kind].icon}</span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold break-all">{t.title}</p>
            <p className="mt-0.5 opacity-90">{t.text}</p>
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDismiss(t.id); }}
            className="p-0.5 opacity-60 hover:opacity-100 cursor-pointer shrink-0"
            aria-label="Dispensar aviso"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};

export const ExecutionJobsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const storeRef = useRef<ExecutionJobStore | null>(null);
  if (!storeRef.current) storeRef.current = new ExecutionJobStore();
  const store = storeRef.current;
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [openJobId, setOpenJobId] = useState<string | null>(null);

  const openJob = useCallback((jobId: string) => setOpenJobId(jobId), []);
  const openJobObj: ExecJob | null = openJobId ? state.jobs.find((j) => j.id === openJobId) ?? null : null;

  // O detalhe aberto de uma execução que já terminou conta como "visto" (some do contador do sino).
  useEffect(() => {
    if (openJobObj && openJobObj.phase === 'done' && !openJobObj.seen) store.markSeen(openJobObj.id);
  }, [openJobObj, store]);

  // A execução é orquestrada por ESTA aba do navegador: fechar/recarregar a página a interrompe.
  const runningCount = state.jobs.filter(isRunning).length;
  useEffect(() => {
    if (runningCount === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [runningCount]);

  return (
    <JobsContext.Provider value={{ store, openJob }}>
      {children}

      <Toasts
        toasts={state.toasts}
        onOpen={(t) => { openJob(t.jobId); store.dismissToast(t.id); }}
        onDismiss={(id) => store.dismissToast(id)}
      />

      {openJobObj && (
        <ExecutePlanModal
          plan={openJobObj.plan}
          targetName={openJobObj.targetName}
          targetLayer={openJobObj.targetLayer}
          phase={openJobObj.phase}
          log={openJobObj.log}
          result={openJobObj.result}
          includeSync={openJobObj.withSync}
          onIncludeSyncChange={() => {}}
          canSyncAny={openJobObj.withSync}
          cancelling={openJobObj.cancelling}
          onStart={() => {}}
          onCancelRun={() => store.cancel(openJobObj.id)}
          onClose={() => setOpenJobId(null)}
        />
      )}
    </JobsContext.Provider>
  );
};

/** Ícone de carregando reutilizado pelo sino. */
export const RunningSpinner: React.FC<{ className?: string }> = ({ className = 'w-3 h-3' }) => <Loader2 className={`${className} animate-spin`} />;

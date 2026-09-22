import React, { useEffect, useRef, useState } from 'react';
import { Bell, CheckCircle2, MinusCircle, XCircle } from 'lucide-react';
import { formatElapsed, isRunning, isUnseen, type ExecJob } from '../../lib/executionJobs';
import { RunningSpinner, useExecutionJobs } from './ExecutionJobsProvider';

// -----------------------------------------------------------------------------
// Sino de notificações do cabeçalho (no estilo do console do GCP). Sinaliza que há
// execução em andamento, lista as execuções da sessão e, ao clicar em uma, abre a
// janela de detalhe (o log). As execuções rodam em segundo plano — o usuário pode
// usar qualquer outra tela enquanto elas acontecem.
// -----------------------------------------------------------------------------

function JobIcon({ job }: { job: ExecJob }) {
  if (isRunning(job)) return <RunningSpinner className="w-4 h-4 text-indigo-600" />;
  if (job.result?.cancelled) return <MinusCircle className="w-4 h-4 text-slate-400" />;
  return job.result?.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <XCircle className="w-4 h-4 text-rose-600" />;
}

function jobSubtitle(job: ExecJob): string {
  if (isRunning(job)) {
    if (job.cancelling) return 'Cancelando após o passo atual…';
    const last = job.log[job.log.length - 1];
    return last ? last.message : 'Iniciando…';
  }
  const took = job.finishedAt ? ` em ${formatElapsed(job.finishedAt - job.startedAt)}` : '';
  if (job.result?.cancelled) return `Cancelada${took}`;
  return job.result?.ok ? `Concluída com sucesso${took}` : `Terminou com falhas${took}`;
}

export const ExecutionBell: React.FC = () => {
  const { jobs, store, openJob, runningCount, unseenJobs } = useExecutionJobs();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const unseen = unseenJobs.length;
  const anyUnseenFailed = unseenJobs.some((j) => !j.result?.ok && !j.result?.cancelled);
  const hasFinished = jobs.some((j) => !isRunning(j));
  const label = runningCount > 0
    ? `Notificações — ${runningCount} execução${runningCount > 1 ? 'ões' : ''} em andamento`
    : unseen > 0 ? `Notificações — ${unseen} nova${unseen > 1 ? 's' : ''}` : 'Notificações';

  return (
    <div className="relative" ref={rootRef}>
      <button
        id="btn-header-notifications"
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className={`relative p-2 rounded-lg border transition cursor-pointer ${
          runningCount > 0 ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : open ? 'border-slate-200 bg-slate-100 text-slate-700' : 'border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700'
        }`}
      >
        <Bell className={`w-[18px] h-[18px] ${runningCount > 0 ? 'animate-pulse' : ''}`} />
        {runningCount > 0 ? (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-indigo-600 text-white text-[9px] font-bold flex items-center justify-center gap-0.5 shadow">
            <RunningSpinner className="w-2.5 h-2.5" />{runningCount}
          </span>
        ) : unseen > 0 ? (
          <span className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-white text-[10px] font-bold flex items-center justify-center shadow ${anyUnseenFailed ? 'bg-rose-600' : 'bg-emerald-600'}`}>
            {unseen}
          </span>
        ) : null}
      </button>

      {open && (
        <div role="dialog" aria-label="Notificações" className="absolute right-0 top-full mt-2 w-[22rem] max-w-[calc(100vw-1.5rem)] bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden z-50">
          <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-slate-100 bg-slate-50">
            <p className="text-xs font-bold text-slate-800">Notificações</p>
            {hasFinished && (
              <button type="button" onClick={() => store.clearFinished()} className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer">
                Limpar concluídas
              </button>
            )}
          </div>

          {jobs.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-slate-500 space-y-1">
              <Bell className="w-6 h-6 text-slate-300 mx-auto" />
              <p className="font-medium text-slate-700">Nenhuma execução nesta sessão</p>
              <p>As execuções iniciadas no Studio Visual ETL Gold aparecem aqui e rodam em segundo plano.</p>
            </div>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto divide-y divide-slate-100">
              {jobs.map((j) => (
                <li key={j.id}>
                  <button
                    type="button"
                    onClick={() => { openJob(j.id); setOpen(false); }}
                    className={`w-full text-left px-3.5 py-2.5 flex items-start gap-2.5 hover:bg-slate-50 cursor-pointer ${isUnseen(j) ? 'bg-indigo-50/40' : ''}`}
                  >
                    <span className="mt-0.5 shrink-0"><JobIcon job={j} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-slate-900 break-all">{j.title}</span>
                      <span className={`block text-[11px] mt-0.5 line-clamp-2 break-words ${!isRunning(j) && !j.result?.ok && !j.result?.cancelled ? 'text-rose-700' : 'text-slate-500'}`}>{jobSubtitle(j)}</span>
                      <span className="block text-[10px] text-slate-400 mt-0.5">
                        {new Date(j.startedAt).toLocaleTimeString('pt-BR')}{j.withSync ? ' · com sincronização' : ''}
                      </span>
                    </span>
                    {isUnseen(j) && <span className="w-2 h-2 rounded-full bg-indigo-500 mt-1.5 shrink-0" aria-label="Não vista" />}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="px-3.5 py-2 border-t border-slate-100 bg-slate-50 text-[10px] text-slate-500">
            O histórico completo fica na tela Execuções.
          </div>
        </div>
      )}
    </div>
  );
};

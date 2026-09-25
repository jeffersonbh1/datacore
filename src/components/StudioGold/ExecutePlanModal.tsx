import React from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Lock, Play, X } from 'lucide-react';
import type { ExecPlan } from '../../lib/lineageExecution';
import type { RunLogEntry } from '../../lib/executionJobs';

/** Rótulo do tipo de tabela do alvo, para o resumo do plano de "executar só esta tabela". */
const LAYER_NOUN: Record<string, string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };

interface ExecutePlanModalProps {
  plan: ExecPlan;
  targetName: string;
  /** Camada do alvo (bronze | silver | gold), usada no resumo do escopo "tabela". */
  targetLayer: string;
  phase: 'confirm' | 'running' | 'done';
  log: RunLogEntry[];
  result: { ok: boolean; cancelled: boolean } | null;
  includeSync: boolean;
  onIncludeSyncChange: (v: boolean) => void;
  canSyncAny: boolean;
  cancelling: boolean;
  onStart: () => void;
  onCancelRun: () => void;
  onClose: () => void;
  /** Na confirmação: motivo pelo qual não dá para iniciar agora (ex.: a mesma tabela já está executando). */
  blockedReason?: string | null;
  /** Caixa "Executar fluxo até aqui": marcada = 'fluxo' (tudo que alimenta a tabela, até a camada dela);
   *  desmarcada = 'tabela' (só ela). Omitido = sem a caixa. */
  onScopeChange?: (scope: ExecPlan['scope']) => void;
  /** Tabelas do plano bloqueadas por mudança de schema (alerta bloqueante aberto) — impedem a execução. */
  blocked?: Array<{ name: string; reason: string }>;
  /** Consulta dos bloqueios: enquanto 'loading' ou em 'error', não dá para executar. */
  blocksStatus?: 'loading' | 'ok' | 'error';
}

const LOG_STYLE: Record<RunLogEntry['level'], string> = {
  info: 'text-slate-700',
  warn: 'text-amber-700',
  error: 'text-red-700',
};

export const ExecutePlanModal: React.FC<ExecutePlanModalProps> = ({
  plan, targetName, targetLayer, phase, log, result, includeSync, onIncludeSyncChange, canSyncAny, cancelling, onStart, onCancelRun, onClose, blockedReason = null, onScopeChange, blocked = [], blocksStatus = 'ok',
}) => {
  const executionBlocked = blocked.length > 0 || blocksStatus !== 'ok';
  const single = plan.scope === 'tabela';
  const bronzeCount = plan.integrations.reduce((n, i) => n + i.bronze.length, 0);
  const silverCount = plan.integrations.reduce((n, i) => n + i.silver.length, 0);
  const goldBuildable = plan.gold.filter((g) => !g.blocked);
  const goldBlocked = plan.gold.filter((g) => g.blocked);
  const nothingToRun = bronzeCount + silverCount + plan.gold.length === 0 && !(!single && includeSync && canSyncAny);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true" aria-label={single ? 'Executar tabela' : 'Executar fluxo'}>
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl border border-slate-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="min-w-0 text-base font-bold text-slate-900 flex items-center flex-wrap gap-x-2">
            <Play className="w-4 h-4 text-indigo-600 shrink-0" /> <span>{single ? 'Executar tabela' : 'Executar fluxo até'}</span> <span className="font-mono text-sm break-all">{targetName}</span>
            {plan.fullRefresh && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 text-[10px] font-bold uppercase tracking-wider">full-refresh</span>}
          </h3>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer" aria-label="Fechar"><X className="w-4 h-4" /></button>
        </div>

        {phase === 'confirm' ? (
          <div className="p-5 space-y-4">
            {onScopeChange && (
              <label className="flex items-start gap-2 rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!single}
                  onChange={(e) => onScopeChange(e.target.checked ? 'fluxo' : 'tabela')}
                  className="mt-0.5"
                />
                <span>
                  <strong>Executar fluxo até aqui.</strong> Executa tudo que alimenta esta tabela, camada por camada, até a
                  camada {LAYER_NOUN[targetLayer] ?? targetLayer}. Desmarcado, executa só esta tabela.
                </span>
              </label>
            )}

            {single ? (
              <>
                <p className="text-xs text-slate-600">
                  Vai executar de verdade <strong>só esta tabela</strong>, a partir do que já está construído nas camadas anteriores. Nada do que a alimenta é sincronizado nem reconstruído.
                  {plan.fullRefresh && <> Com <strong>--full-refresh</strong>: reconstrói do zero, mesmo sendo incremental.</>}
                </p>
                <ol className="space-y-2 text-xs text-slate-800">
                  <li className="flex gap-2"><span className="font-bold text-slate-400 w-4">1.</span>
                    <span>Construir {LAYER_NOUN[targetLayer] ?? targetLayer} — <span className="font-mono break-all">{targetName}</span>{targetLayer === 'gold' ? ' (e rodar os testes do dbt)' : ''}</span></li>
                </ol>
                {plan.unbuiltInputs.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 space-y-1">
                    <p className="font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Entrada ainda não construída no BigQuery</p>
                    <p>{plan.unbuiltInputs.map((n) => <span key={n} className="font-mono break-all block">{n}</span>)}</p>
                    <p>A construção tende a falhar. Para atualizar também o que alimenta esta tabela, marque “Executar fluxo até aqui”.</p>
                  </div>
                )}
              </>
            ) : (
              <>
            <p className="text-xs text-slate-600">Vai executar de verdade, nesta ordem, tudo o que alimenta esta tabela (inclusive em outras integrações):</p>
            <ol className="space-y-2 text-xs text-slate-800">
              <li className="flex gap-2"><span className="font-bold text-slate-400 w-4">1.</span>
                <span>Sincronizar a origem no Airbyte — {plan.integrations.filter((i) => i.pipeline?.airbyteConnectionId || i.integration.airbyteConnectionId).length} integração(ões): {plan.integrations.map((i) => i.integration.nome).join(', ') || '—'}</span></li>
              <li className="flex gap-2"><span className="font-bold text-slate-400 w-4">2.</span><span>Construir Bronze — {bronzeCount} tabela(s)</span></li>
              <li className="flex gap-2"><span className="font-bold text-slate-400 w-4">3.</span><span>Construir Silver — {silverCount} tabela(s)</span></li>
              <li className="flex gap-2"><span className="font-bold text-slate-400 w-4">4.</span><span>Construir Gold (e rodar os testes do dbt) — {goldBuildable.length} modelo(s){goldBuildable.length ? `: ${goldBuildable.map((g) => g.name).join(', ')}` : ''}</span></li>
            </ol>
              </>
            )}

            {blocked.length > 0 && (
              <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-900 space-y-1">
                <p className="font-semibold flex items-center gap-1.5"><Lock className="w-4 h-4" /> Execução bloqueada — {blocked.length} tabela(s) deste fluxo têm mudança de schema pendente</p>
                {blocked.map((b) => <p key={b.name}><span className="font-mono break-all">{b.name}</span>: {b.reason}.</p>)}
                <p>Nada pode ser executado enquanto houver bloqueio — Raw, Bronze, Silver e Gold não são atualizados. Resolva os alertas da integração em Pipelines &amp; Fluxos (“Resolvido — liberar”) para executar.</p>
              </div>
            )}
            {blocksStatus === 'loading' && (
              <p className="text-xs text-slate-500 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Verificando bloqueios por mudança de schema…</p>
            )}
            {blocksStatus === 'error' && (
              <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-900 flex items-start gap-1.5">
                <Lock className="w-4 h-4 shrink-0" /> <span>Não foi possível verificar os bloqueios por mudança de schema — a execução fica bloqueada por segurança. Feche e tente de novo.</span>
              </div>
            )}

            {goldBlocked.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 space-y-1">
                <p className="font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {goldBlocked.length} Gold não pode(m) ser construído(s) agora</p>
                {goldBlocked.map((g) => <p key={g.nodeId}><span className="font-mono">{g.name}</span>: {g.blocked}</p>)}
              </div>
            )}

            {!single && (
            <label className={`flex items-start gap-2 rounded-lg border p-3 text-xs ${canSyncAny ? 'border-slate-200 bg-slate-50 text-slate-700 cursor-pointer' : 'border-slate-100 bg-slate-50 text-slate-400'}`}>
              <input type="checkbox" checked={includeSync && canSyncAny} disabled={!canSyncAny} onChange={(e) => onIncludeSyncChange(e.target.checked)} className="mt-0.5" />
              <span>
                <strong>Sincronizar a origem no Airbyte antes.</strong> Desmarque para reconstruir só Bronze/Silver/Gold a partir do que já está na Raw (mais rápido; a execução aparece na tela Execuções, sem o job do Airbyte).
                {!canSyncAny && ' Nenhuma integração deste fluxo tem conexão real no Airbyte.'}
              </span>
            </label>
            )}

            <p className="text-xs text-slate-500">{single
              ? 'O resultado fica registrado na tela Execuções.'
              : 'Cada camada só roda para o que deu certo na anterior, e um Gold só é construído se tudo que ele consome estiver íntegro. O resultado fica registrado na tela Execuções.'}</p>

            <p className="text-xs text-slate-500">A execução roda em segundo plano: depois de iniciar você pode usar o resto do sistema e acompanhar pelo sino no canto superior direito.</p>

            {blockedReason && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" /> <span>{blockedReason}</span>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer">Cancelar</button>
              <button type="button" disabled={nothingToRun || Boolean(blockedReason) || executionBlocked} title={blocked.length > 0 ? 'Execução bloqueada por mudança de schema — resolva os alertas da integração' : undefined} onClick={onStart} className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-lg text-xs font-semibold cursor-pointer transition">
                <Play className="w-3.5 h-3.5" /> Executar
              </button>
            </div>
          </div>
        ) : (
          <div className="p-5 space-y-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 max-h-72 overflow-y-auto space-y-1" aria-live="polite">
              {log.length === 0 && <p className="text-xs text-slate-400">Iniciando…</p>}
              {log.map((l) => (
                <p key={l.id} className={`text-xs ${LOG_STYLE[l.level]}`}><span className="text-slate-400 font-mono mr-1.5">{l.at}</span>{l.message}</p>
              ))}
            </div>
            {phase === 'running' ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-slate-500 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {cancelling ? 'Cancelando após o passo atual…' : 'Executando em segundo plano — pode fechar esta janela.'}</p>
                <button type="button" disabled={cancelling} onClick={onCancelRun} className="px-3 py-1.5 border border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer">Cancelar execução</button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <p className={`text-xs font-semibold flex items-center gap-1.5 ${result?.ok ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {result?.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                  {result?.cancelled ? 'Execução cancelada.' : result?.ok ? 'Execução concluída.' : 'Execução terminou com falhas — veja o registro acima.'}
                </p>
                <button type="button" onClick={onClose} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold cursor-pointer">Fechar</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

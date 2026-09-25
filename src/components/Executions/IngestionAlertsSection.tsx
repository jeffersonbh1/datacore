import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, ChevronDown, ChevronRight, Loader2, Lock } from 'lucide-react';
import {
  SEVERIDADE_STYLE, TIPO_LABEL, categoryLabel, fetchOpenIngestionAlerts, isMissingAlertsTable, resolveIngestionAlert,
  type IngestionAlert,
} from '../../lib/ingestionAlerts';

// -----------------------------------------------------------------------------
// Alertas em aberto de todas as integrações (tabela alertas_ingestao, sql/015 +
// sql/016): falhas de sync, mudanças de schema, alterações e falhas de construção.
// Some da lista quando alguém marca como resolvido (vai para o histórico da
// integração em Pipelines & Fluxos). Não aparece nada quando não há alerta.
// -----------------------------------------------------------------------------

const POLL_MS = 30000;

function AlertRow({ alert, onResolve, canResolve }: { alert: IngestionAlert; onResolve: () => Promise<void>; canResolve: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const sev = SEVERIDADE_STYLE[alert.severidade];
  const critical = alert.severidade === 'critica';

  return (
    <li className="px-4 py-3 border-t border-rose-100 first:border-t-0">
      <div className="flex items-start gap-3">
        <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${critical ? 'text-rose-600' : alert.severidade === 'alta' ? 'text-amber-600' : 'text-slate-400'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-900">{alert.integracaoNome}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded border font-mono ${sev.cls}`}>
              {TIPO_LABEL[alert.tipo]} · {categoryLabel(alert.categoria)}
            </span>
            {alert.bloqueante && (
              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-bold bg-rose-600 text-white border-rose-700" title="Enquanto aberto, Bronze/Silver/Gold desta tabela não são atualizados">
                <Lock className="w-3 h-3" /> Bloqueando atualização
              </span>
            )}
            <span className="text-[11px] text-slate-400">
              {new Date(alert.criadoEm).toLocaleString('pt-BR')}{alert.airbyteJobId ? ` · job ${alert.airbyteJobId}` : ''}
            </span>
          </div>
          <p className="text-xs text-slate-700 mt-1">{alert.mensagem}</p>
          {alert.detalhe && (
            <button
              onClick={() => setOpen((v) => !v)}
              className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 cursor-pointer"
            >
              {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Detalhe
            </button>
          )}
          {open && alert.detalhe && (
            <pre className="mt-1 text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded p-2 whitespace-pre-wrap break-words">{alert.detalhe}</pre>
          )}
        </div>
        {canResolve && (
          <button
            disabled={busy}
            onClick={async () => { setBusy(true); try { await onResolve(); } finally { setBusy(false); } }}
            className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-md text-[11px] font-medium cursor-pointer disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
            Ciente/Resolvido
          </button>
        )}
      </div>
    </li>
  );
}

export const IngestionAlertsSection: React.FC<{ refreshKey: number; userName: string | null; canResolve: boolean }> = ({ refreshKey, userName, canResolve }) => {
  const [alerts, setAlerts] = useState<IngestionAlert[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAlerts(await fetchOpenIngestionAlerts());
      setError(null);
    } catch (err) {
      // Migração 015 ainda não aplicada: a seção simplesmente não aparece.
      if (isMissingAlertsTable(err)) { setAlerts([]); setError(null); return; }
      setError(err instanceof Error ? err.message : 'Falha ao carregar os alertas.');
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load, refreshKey]);

  if (error) {
    return <p className="text-[11px] text-rose-600">Alertas de ingestão: {error}</p>;
  }
  if (alerts.length === 0) return null;

  return (
    <div id="ingestion-alerts" className="bg-white border border-rose-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 bg-rose-50 border-b border-rose-200 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-rose-600" />
        <h3 className="text-xs font-semibold text-rose-800">
          {alerts.length} alerta{alerts.length > 1 ? 's' : ''} de integração em aberto
        </h3>
        <span className="text-[11px] text-rose-700/80">
          — o histórico de cada integração fica em Pipelines &amp; Fluxos.
        </span>
      </div>
      <ul>
        {alerts.map((a) => (
          <AlertRow
            key={a.id}
            alert={a}
            canResolve={canResolve}
            onResolve={async () => {
              await resolveIngestionAlert(a.id, userName);
              setAlerts((prev) => prev.filter((x) => x.id !== a.id));
            }}
          />
        ))}
      </ul>
    </div>
  );
};

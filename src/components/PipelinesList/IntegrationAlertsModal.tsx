import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, ChevronDown, ChevronRight, History, Loader2, Lock, RefreshCw, ScanSearch, X } from 'lucide-react';
import {
  SEVERIDADE_STYLE, TIPO_LABEL, categoryLabel, fetchIntegrationAlerts, isMissingAlertsTable, resolveIngestionAlerts,
  type IngestionAlert,
} from '../../lib/ingestionAlerts';
import { checkSchemaChanges } from '../../lib/airbyteGateway';

// -----------------------------------------------------------------------------
// Alertas de UMA integração (ícone de alerta em Pipelines & Fluxos): tabela dos
// alertas em aberto — o engenheiro de dados marca como ciente/resolvido — e,
// abaixo, o histórico com quem resolveu e quando. "Verificar agora" compara o
// schema atual da origem com a última foto (server/schemaChangeCheck.ts).
// -----------------------------------------------------------------------------

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');

function SeverityBadge({ alert: a }: { alert: IngestionAlert }) {
  const s = SEVERIDADE_STYLE[a.severidade];
  return (
    <div className="flex flex-col items-start gap-1">
      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold whitespace-nowrap ${s.cls}`}>{s.label}</span>
      {a.bloqueante && (
                            <span className="ml-1 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-bold bg-rose-600 text-white border-rose-700 whitespace-nowrap" title={a.tabela ? 'Enquanto aberto, Bronze/Silver/Gold desta tabela não são atualizados' : 'Falha na sincronização da Raw: enquanto aberto, Bronze/Silver/Gold das tabelas de carga full desta integração não são atualizados (a Raw pode ter uma carga parcial)'}>
                              <Lock className="w-3 h-3" /> {a.resolvidoEm ? 'Bloqueou' : 'Bloqueando atualização'}
                            </span>
                          )}
    </div>
  );
}

function MessageCell({ alert }: { alert: IngestionAlert }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold text-slate-800">{TIPO_LABEL[alert.tipo]} · {categoryLabel(alert.categoria)}</div>
      <p className="text-xs text-slate-700 mt-0.5">{alert.mensagem}</p>
      {alert.detalhe && (
        <>
          <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 cursor-pointer">
            {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />} Detalhe
          </button>
          {open && <pre className="mt-1 text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded p-2 whitespace-pre-wrap break-words">{alert.detalhe}</pre>}
        </>
      )}
    </div>
  );
}

interface Props {
  integracaoId: number;
  integracaoNome: string;
  airbyteConnectionId: string | null;
  userName: string | null;
  canResolve: boolean;
  onClose: () => void;
  /** Avisa a lista para atualizar o contador de alertas abertos. */
  onChanged: () => void;
}

export const IntegrationAlertsModal: React.FC<Props> = ({ integracaoId, integracaoNome, airbyteConnectionId, userName, canResolve, onClose, onChanged }) => {
  const [open, setOpen] = useState<IngestionAlert[]>([]);
  const [history, setHistory] = useState<IngestionAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [resolving, setResolving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchIntegrationAlerts(integracaoId);
      setOpen(r.open);
      setHistory(r.history);
      setSelected((prev) => new Set([...prev].filter((id) => r.open.some((a) => a.id === id))));
      setError(null);
    } catch (err) {
      setError(isMissingAlertsTable(err)
        ? 'A tabela de alertas ainda não existe no Supabase — rode sql/015 e sql/016 no SQL Editor.'
        : err instanceof Error ? err.message : 'Falha ao carregar os alertas.');
    } finally {
      setLoading(false);
    }
  }, [integracaoId]);

  useEffect(() => { void load(); }, [load]);

  const resolve = async (ids: number[]) => {
    if (ids.length === 0) return;
    setResolving(true);
    try {
      await resolveIngestionAlerts(ids, userName);
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao marcar como ciente/resolvido.');
    } finally {
      setResolving(false);
    }
  };

  const runCheck = async () => {
    if (!airbyteConnectionId) return;
    setChecking(true);
    setCheckMessage(null);
    try {
      const r = await checkSchemaChanges(airbyteConnectionId);
      const base = r.baseline
        ? 'Primeira verificação: o schema atual da origem foi registrado como referência. A partir de agora, qualquer mudança vira alerta.'
        : r.alerts.length
          ? `${r.alerts.length} mudança(s) de schema encontrada(s) — veja os alertas abaixo.`
          : 'Nenhuma mudança de schema desde a última verificação.';
      setCheckMessage(r.catalogoAtualizado
        ? `${base} O catálogo da conexão no Airbyte foi atualizado com o schema atual.`
        : `${base} Atenção: o catálogo da conexão no Airbyte NÃO foi atualizado (${r.catalogoErro}) — se a origem mudou, o próximo sync pode falhar.`);
      await load();
      onChanged();
    } catch (err) {
      setCheckMessage(`Falha ao verificar: ${err instanceof Error ? err.message : 'erro desconhecido'}`);
    } finally {
      setChecking(false);
    }
  };

  const allSelected = open.length > 0 && selected.size === open.length;
  const toggle = (id: number) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true" aria-label={`Alertas da integração ${integracaoNome}`}>
      <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-2xl border border-slate-200">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" /> Alertas da integração
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 break-words">{integracaoNome}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {airbyteConnectionId && (
              <button
                type="button"
                onClick={runCheck}
                disabled={checking}
                title="Compara o schema atual da origem com a última verificação (leva de 15 a 40 segundos)"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-medium cursor-pointer disabled:opacity-50"
              >
                {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanSearch className="w-3.5 h-3.5" />}
                {checking ? 'Verificando a origem…' : 'Verificar schema agora'}
              </button>
            )}
            <button type="button" onClick={() => void load()} title="Atualizar" className="p-1.5 text-slate-500 hover:text-slate-800 rounded cursor-pointer">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button type="button" onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 rounded cursor-pointer" aria-label="Fechar"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="overflow-y-auto p-5 space-y-6">
          {checkMessage && <div className="text-xs rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-900 p-3">{checkMessage}</div>}
          {error && <div className="text-xs rounded-lg border border-rose-200 bg-rose-50 text-rose-800 p-3">{error}</div>}

          {/* ---- Em aberto */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-bold text-slate-900">Em aberto ({open.length})</h4>
              {canResolve && open.length > 0 && (
                <button
                  type="button"
                  disabled={resolving || selected.size === 0}
                  onClick={() => void resolve([...selected])}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold cursor-pointer disabled:bg-slate-300 disabled:cursor-not-allowed"
                >
                  {resolving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                  Marcar {selected.size || ''} como ciente/resolvido
                </button>
              )}
            </div>
            {open.some((a) => a.bloqueante) && (
              <div className="text-xs rounded-lg border border-rose-200 bg-rose-50 text-rose-800 p-3 flex items-start gap-2">
                <Lock className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  <strong>Atualização bloqueada</strong> para {[
                    ...new Set(open.filter((a) => a.bloqueante && a.tabela).map((a) => a.tabela as string)),
                    ...(open.some((a) => a.bloqueante && !a.tabela) ? ['as tabelas de carga full (falha na sincronização da Raw — pode haver carga parcial)'] : []),
                  ].join(', ')}:
                  Bronze, Silver e Gold dessas tabelas não são atualizados enquanto os alertas marcados com
                  “Bloqueando atualização” estiverem abertos. Corrija e marque como ciente/resolvido para liberar na próxima execução.
                </span>
              </div>
            )}
            {loading && open.length === 0 ? (
              <p className="text-xs text-slate-500 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando…</p>
            ) : open.length === 0 ? (
              <p className="text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg p-4 text-center">Nenhum alerta em aberto nesta integração.</p>
            ) : (
              <div className="border border-slate-200 rounded-xl overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      {canResolve && (
                        <th className="px-3 py-2 w-8">
                          <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(open.map((a) => a.id)))} aria-label="Selecionar todos" />
                        </th>
                      )}
                      <th className="px-3 py-2 whitespace-nowrap">Data</th>
                      <th className="px-3 py-2">Severidade</th>
                      <th className="px-3 py-2">Alerta</th>
                      {canResolve && <th className="px-3 py-2" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {open.map((a) => (
                      <tr key={a.id} className="align-top">
                        {canResolve && (
                          <td className="px-3 py-2.5"><input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} aria-label="Selecionar alerta" /></td>
                        )}
                        <td className="px-3 py-2.5 text-[11px] text-slate-500 whitespace-nowrap">{fmt(a.criadoEm)}</td>
                        <td className="px-3 py-2.5"><SeverityBadge alert={a} /></td>
                        <td className="px-3 py-2.5"><MessageCell alert={a} /></td>
                        {canResolve && (
                          <td className="px-3 py-2.5">
                            <button
                              type="button"
                              disabled={resolving}
                              onClick={() => void resolve([a.id])}
                              className="inline-flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-md text-[11px] font-medium cursor-pointer whitespace-nowrap disabled:opacity-50"
                            >
                              <CheckCircle className="w-3 h-3" /> {a.bloqueante ? 'Resolvido — liberar' : 'Ciente/Resolvido'}
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ---- Histórico */}
          <section className="space-y-2">
            <h4 className="text-sm font-bold text-slate-900 flex items-center gap-1.5"><History className="w-4 h-4 text-slate-500" /> Histórico ({history.length})</h4>
            {history.length === 0 ? (
              <p className="text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg p-4 text-center">Nenhum alerta resolvido ainda.</p>
            ) : (
              <div className="border border-slate-200 rounded-xl overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 whitespace-nowrap">Data</th>
                      <th className="px-3 py-2">Severidade</th>
                      <th className="px-3 py-2">Alerta</th>
                      <th className="px-3 py-2 whitespace-nowrap">Ciente/resolvido por</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {history.map((a) => (
                      <tr key={a.id} className="align-top">
                        <td className="px-3 py-2.5 text-[11px] text-slate-500 whitespace-nowrap">{fmt(a.criadoEm)}</td>
                        <td className="px-3 py-2.5"><SeverityBadge alert={a} /></td>
                        <td className="px-3 py-2.5"><MessageCell alert={a} /></td>
                        <td className="px-3 py-2.5 text-[11px] text-slate-600 whitespace-nowrap">
                          <div className="font-medium">{a.resolvidoPor || '—'}</div>
                          <div className="text-slate-400">{fmt(a.resolvidoEm)}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

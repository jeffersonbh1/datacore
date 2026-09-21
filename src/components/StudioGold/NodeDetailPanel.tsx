import React, { useEffect, useState } from 'react';
import { Code2, Crosshair, Loader2, Play, X } from 'lucide-react';
import { LAYER_LABEL, fetchModelSql, type LineageIndex, type LineageNode, type ModelSql } from '../../lib/lineage';
import { LAYER_STYLE, formatRows, formatWhen } from './LineageGraph';

interface NodeDetailPanelProps {
  node: LineageNode;
  index: LineageIndex;
  isFocus: boolean;
  onFocus: (id: string) => void;
  /** Abre a confirmação para executar SÓ esta tabela (nada do que a alimenta). */
  onExecute: (id: string) => void;
  /** Perfil pode executar E nenhuma execução está em andamento. */
  canExecute: boolean;
  executeHint?: string;
  onClose: () => void;
}

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-start justify-between gap-3 text-xs py-1 border-b border-slate-100 last:border-0">
    <span className="text-slate-500 shrink-0">{label}</span>
    <span className="text-slate-800 font-medium text-right break-all">{value}</span>
  </div>
);

export const NodeDetailPanel: React.FC<NodeDetailPanelProps> = ({ node, index, isFocus, onFocus, onExecute, canExecute, executeHint, onClose }) => {
  const [sql, setSql] = useState<ModelSql | null>(null);
  const [sqlOpen, setSqlOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isModel = node.layer === 'bronze' || node.layer === 'silver' || node.layer === 'gold';

  // Trocar de nó fecha o SQL do anterior.
  useEffect(() => { setSql(null); setSqlOpen(false); setError(null); }, [node.id]);

  const toggleSql = async () => {
    if (sqlOpen) { setSqlOpen(false); return; }
    setSqlOpen(true);
    if (sql) return;
    setLoading(true);
    setError(null);
    try { setSql(await fetchModelSql(node.name)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Falha ao ler o SQL.'); }
    finally { setLoading(false); }
  };

  const parents = (index.parents.get(node.id) ?? []).map((id) => index.byId.get(id)!).filter(Boolean);
  const children = (index.children.get(node.id) ?? []).map((id) => index.byId.get(id)!).filter(Boolean);
  const style = LAYER_STYLE[node.layer];

  const NodeLink: React.FC<{ n: LineageNode }> = ({ n }) => (
    <button type="button" onClick={() => onFocus(n.id)} className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer" title="Focar o grafo nesta tabela">
      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ${LAYER_STYLE[n.layer].badge}`}>{LAYER_LABEL[n.layer]}</span>
      <span className="text-xs text-slate-800 truncate">{n.name}</span>
    </button>
  );

  return (
    <aside className="w-full lg:w-80 shrink-0 bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col min-h-0 overflow-hidden">
      <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-slate-100">
        <div className="min-w-0">
          <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${style.badge}`}>{LAYER_LABEL[node.layer]}</span>
          <h3 className="mt-1 text-sm font-bold text-slate-900 break-all">{node.name}</h3>
        </div>
        <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer shrink-0" aria-label="Fechar detalhes"><X className="w-4 h-4" /></button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {node.description && <p className="text-xs text-slate-600 leading-relaxed">{node.description}</p>}

        <div>
          {node.dataset && <Row label="Tabela" value={<span className="font-mono">{node.dataset}.{node.name}</span>} />}
          {node.integrationName && <Row label="Integração" value={node.integrationName} />}
          {node.sistema && node.layer !== 'source' && <Row label="Sistema" value={node.sistema} />}
          {node.columns !== null && <Row label="Colunas" value={node.columns} />}
          {node.layer !== 'source' && (
            <Row label="Situação" value={node.built ? 'construída no BigQuery' : node.built === false || node.layer === 'gold' ? 'ainda não construída' : 'desconhecida'} />
          )}
          {node.built && node.rows !== null && <Row label="Linhas" value={formatRows(node.rows)} />}
          {node.built && node.lastModified && <Row label="Atualizada em" value={formatWhen(node.lastModified)} />}
        </div>

        <div className="flex gap-2 flex-wrap">
          {!isFocus && (
            <button type="button" onClick={() => onFocus(node.id)} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold cursor-pointer transition">
              <Crosshair className="w-3.5 h-3.5" /> Focar nesta tabela
            </button>
          )}
          {isModel && (
            <button type="button" onClick={toggleSql} className="flex items-center gap-1.5 px-2.5 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer transition">
              <Code2 className="w-3.5 h-3.5" /> {sqlOpen ? 'Ocultar SQL' : 'Ver SQL'}
            </button>
          )}
          {isModel && (
            <button
              type="button"
              onClick={() => onExecute(node.id)}
              disabled={!canExecute}
              title={canExecute ? 'Executa só esta tabela — não sincroniza nem reconstrói o que a alimenta' : (executeHint || 'Seu perfil não pode executar pipelines.')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed text-emerald-800 rounded-lg text-xs font-semibold cursor-pointer transition"
            >
              <Play className="w-3.5 h-3.5" /> Executar esta tabela
            </button>
          )}
        </div>

        {sqlOpen && (
          <div>
            {loading && <p className="text-xs text-slate-500 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando…</p>}
            {error && <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700 break-words">{error}</div>}
            {sql && (sql.sql
              ? <pre className="text-[11px] leading-relaxed font-mono bg-slate-900 text-slate-100 p-3 rounded-lg overflow-auto max-h-72 whitespace-pre">{sql.sql}</pre>
              : <p className="text-xs text-slate-500">O arquivo .sql deste modelo não está disponível no gateway.</p>)}
          </div>
        )}

        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Recebe dados de ({parents.length})</p>
          {parents.length === 0 ? <p className="text-xs text-slate-400 px-2">Nada — é o início do fluxo.</p> : parents.map((n) => <NodeLink key={n.id} n={n} />)}
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Envia dados para ({children.length})</p>
          {children.length === 0 ? <p className="text-xs text-slate-400 px-2">Nada — é o fim do fluxo.</p> : children.map((n) => <NodeLink key={n.id} n={n} />)}
        </div>
      </div>
    </aside>
  );
};

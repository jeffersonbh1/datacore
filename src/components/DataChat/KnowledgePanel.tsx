import React, { useCallback, useEffect, useState } from 'react';
import { BookOpen, Loader2, Plus, Trash2, X } from 'lucide-react';
import {
  KNOWLEDGE_TYPE_LABEL,
  createKnowledge,
  deleteKnowledge,
  fetchKnowledge,
  setKnowledgeActive,
  type KnowledgeItem,
  type KnowledgeType,
} from '../../lib/knowledge';

interface KnowledgePanelProps {
  idEmpresa: number | null;
  canEdit: boolean;
  onClose: () => void;
}

const TYPE_STYLE: Record<KnowledgeType, string> = {
  regra_negocio: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  metrica: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  relacionamento: 'bg-amber-50 text-amber-700 border-amber-200',
  padrao: 'bg-slate-100 text-slate-700 border-slate-200',
};

export const KnowledgePanel: React.FC<KnowledgePanelProps> = ({ idEmpresa, canEdit, onClose }) => {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tipo, setTipo] = useState<KnowledgeType>('regra_negocio');
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [tabelas, setTabelas] = useState('');

  const load = useCallback(async () => {
    if (!idEmpresa) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchKnowledge(idEmpresa));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar a base de conhecimento.');
    } finally {
      setLoading(false);
    }
  }, [idEmpresa]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!idEmpresa) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createKnowledge(idEmpresa, {
        tipo,
        titulo: titulo.trim(),
        descricao: descricao.trim(),
        tabelas_relacionadas: tabelas.split(',').map((t) => t.trim()).filter(Boolean),
      });
      setItems((prev) => [created, ...prev]);
      setTitulo(''); setDescricao(''); setTabelas(''); setAdding(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try { await fn(); } catch (err) { setError(err instanceof Error ? err.message : 'Falha na operação.'); }
  };

  const canSubmit = titulo.trim().length >= 3 && descricao.trim().length >= 3 && !saving;

  return (
    <aside className="w-full lg:w-96 shrink-0 bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col min-h-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><BookOpen className="w-4 h-4 text-indigo-600" /> Base de conhecimento</h3>
        <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer" aria-label="Fechar painel"><X className="w-4 h-4" /></button>
      </div>

      <div className="px-4 py-3 text-[11px] text-slate-500 leading-relaxed border-b border-slate-100">
        O agente consulta aqui as regras de negócio, métricas e relacionamentos da sua empresa. Se algo não estiver cadastrado, ele pergunta em vez de inventar.
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        {canEdit && !adding && (
          <button type="button" onClick={() => setAdding(true)} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 border border-dashed border-indigo-300 text-indigo-700 hover:bg-indigo-50 rounded-lg text-xs font-semibold cursor-pointer transition">
            <Plus className="w-3.5 h-3.5" /> Nova regra, métrica ou relacionamento
          </button>
        )}

        {adding && (
          <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 space-y-2">
            <select value={tipo} onChange={(e) => setTipo(e.target.value as KnowledgeType)} className="w-full text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white">
              {(Object.keys(KNOWLEDGE_TYPE_LABEL) as KnowledgeType[]).map((k) => <option key={k} value={k}>{KNOWLEDGE_TYPE_LABEL[k]}</option>)}
            </select>
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={200} placeholder="Título (ex.: Definição de faturamento)" className="w-full text-xs border border-slate-300 rounded-md px-2 py-1.5" />
            <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={4000} rows={4} placeholder="Descrição (ex.: Faturamento = soma de valor_total dos pedidos com status APROVADO)" className="w-full text-xs border border-slate-300 rounded-md px-2 py-1.5 resize-y" />
            <input value={tabelas} onChange={(e) => setTabelas(e.target.value)} placeholder="Tabelas relacionadas, separadas por vírgula (opcional)" className="w-full text-xs border border-slate-300 rounded-md px-2 py-1.5 font-mono" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setAdding(false)} className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-md cursor-pointer">Cancelar</button>
              <button type="button" disabled={!canSubmit} onClick={handleCreate} className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-md text-xs font-semibold cursor-pointer">
                {saving && <Loader2 className="w-3 h-3 animate-spin" />} Salvar
              </button>
            </div>
          </div>
        )}

        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700 break-words">{error}</div>}
        {loading && <p className="text-xs text-slate-500 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando…</p>}
        {!loading && items.length === 0 && !error && (
          <p className="text-xs text-slate-400 text-center py-6">
            Nada cadastrado ainda.{canEdit ? ' Cadastre a primeira regra de negócio para o agente aplicar nos modelos.' : ''}
          </p>
        )}

        {items.map((it) => (
          <div key={it.id} className={`rounded-lg border p-3 space-y-1.5 ${it.ativo ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50 opacity-60'}`}>
            <div className="flex items-start justify-between gap-2">
              <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${TYPE_STYLE[it.tipo]}`}>{KNOWLEDGE_TYPE_LABEL[it.tipo]}</span>
              {canEdit && (
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => run(async () => { await setKnowledgeActive(it.id, !it.ativo); setItems((p) => p.map((x) => (x.id === it.id ? { ...x, ativo: !x.ativo } : x))); })} className="text-[10px] text-slate-500 hover:text-slate-800 px-1.5 py-0.5 rounded hover:bg-slate-100 cursor-pointer">
                    {it.ativo ? 'Desativar' : 'Ativar'}
                  </button>
                  <button type="button" onClick={() => { if (window.confirm(`Excluir "${it.titulo}"?`)) run(async () => { await deleteKnowledge(it.id); setItems((p) => p.filter((x) => x.id !== it.id)); }); }} className="p-1 text-slate-400 hover:text-red-600 rounded hover:bg-red-50 cursor-pointer" aria-label="Excluir"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              )}
            </div>
            <p className="text-xs font-semibold text-slate-900">{it.titulo}</p>
            <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">{it.descricao}</p>
            {it.tabelas_relacionadas.length > 0 && <p className="text-[10px] font-mono text-slate-400 break-words">{it.tabelas_relacionadas.join(' · ')}</p>}
          </div>
        ))}
      </div>
    </aside>
  );
};

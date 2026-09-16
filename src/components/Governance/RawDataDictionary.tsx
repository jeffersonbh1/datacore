import React, { useEffect, useMemo, useState } from 'react';
import { Search, RefreshCw, Loader2, Pencil, Check, X, Lock, AlertTriangle, Database } from 'lucide-react';
import { Pipeline } from '../../types';
import { fetchRawTableColumns, updateRawColumnDescription, RawColumnInfo } from '../../lib/airbyteGateway';

interface RawDataDictionaryProps {
  pipelines: Pipeline[];
  canEdit: boolean;
}

interface RawTableOption {
  key: string;
  sistema: string;
  table: string;
  projectId: string;
  rawDataset: string;
  location?: string;
}

// A camada Raw não tem um _properties.yml com schema fixo — as tabelas/colunas
// disponíveis vêm dos nós Bronze já materializados no Studio (1 nó por tabela,
// ver src/lib/pipelineBuilder.ts), que carregam projectId/rawDataset/sistema
// reais da integração. Deduplicado por tabela física (projeto+dataset+tabela).
function collectRawTableOptions(pipelines: Pipeline[]): RawTableOption[] {
  const byKey = new Map<string, RawTableOption>();
  for (const pipeline of pipelines) {
    for (const node of pipeline.nodes) {
      if (node.type !== 'bronze' || !node.config.bigquery) continue;
      const bq = node.config.bigquery;
      const table = bq.tables[0] || node.title;
      const key = `${bq.projectId}::${bq.rawDataset}::${table}`;
      if (byKey.has(key)) continue;
      byKey.set(key, {
        key,
        sistema: bq.sistema || '—',
        table,
        projectId: bq.projectId,
        rawDataset: bq.rawDataset,
        location: bq.location,
      });
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.table.localeCompare(b.table));
}

const QUALITY_BADGE: Record<RawColumnInfo['quality']['status'], { label: string; className: string }> = {
  completo: { label: 'Completo', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  atencao: { label: 'Atenção', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  critico: { label: 'Crítico', className: 'bg-rose-50 text-rose-700 border-rose-200' },
  sem_dados: { label: 'Sem dados', className: 'bg-slate-50 text-slate-600 border-slate-200' },
};

export const RawDataDictionary: React.FC<RawDataDictionaryProps> = ({ pipelines, canEdit }) => {
  const tableOptions = useMemo(() => collectRawTableOptions(pipelines), [pipelines]);
  const [filter, setFilter] = useState('');
  const [selectedKey, setSelectedKey] = useState('');

  const filteredOptions = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tableOptions;
    return tableOptions.filter((o) => o.table.toLowerCase().includes(q) || o.sistema.toLowerCase().includes(q));
  }, [tableOptions, filter]);

  const selected = tableOptions.find((o) => o.key === selectedKey) || null;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [columns, setColumns] = useState<RawColumnInfo[]>([]);
  const [totalRows, setTotalRows] = useState(0);

  const loadColumns = async (opt: RawTableOption) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchRawTableColumns({
        projectId: opt.projectId,
        rawDataset: opt.rawDataset,
        table: opt.table,
        sistema: opt.sistema,
        location: opt.location,
      });
      setColumns(res.columns);
      setTotalRows(res.totalRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao consultar as colunas da tabela.');
      setColumns([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selected) {
      loadColumns(selected);
    } else {
      setColumns([]);
      setTotalRows(0);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  const [editingColumn, setEditingColumn] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [savingColumn, setSavingColumn] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const startEdit = (col: RawColumnInfo) => {
    setEditingColumn(col.name);
    setDraft(col.description || '');
    setSaveError(null);
  };

  const cancelEdit = () => {
    setEditingColumn(null);
    setDraft('');
    setSaveError(null);
  };

  const saveEdit = async (col: RawColumnInfo) => {
    if (!selected) return;
    setSavingColumn(col.name);
    setSaveError(null);
    try {
      await updateRawColumnDescription(selected.sistema, selected.table, col.name, draft.trim());
      setColumns((prev) => prev.map((c) => (c.name === col.name ? { ...c, description: draft.trim() || null } : c)));
      setEditingColumn(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Falha ao salvar a descrição.');
    } finally {
      setSavingColumn(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Dicionário de Dados da Camada Raw</h3>
          <p className="text-xs text-slate-500">
            Filtre uma tabela replicada pelo Airbyte para inspecionar suas colunas reais (schema ao vivo do BigQuery),
            a qualidade do preenchimento, quais campos são dados pessoais (LGPD) e documentar a descrição de cada campo.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex items-center gap-2 flex-1 max-w-md bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 focus-within:bg-white focus-within:border-emerald-500 transition-colors">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              type="text"
              placeholder="Filtrar por nome da tabela ou sistema de origem..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full bg-transparent focus:outline-none text-slate-800 placeholder-slate-400"
            />
          </div>

          <select
            value={selectedKey}
            onChange={(e) => setSelectedKey(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:border-emerald-500 min-w-[260px]"
          >
            <option value="">Selecione uma tabela raw...</option>
            {filteredOptions.map((o) => (
              <option key={o.key} value={o.key}>{o.sistema} — {o.table}</option>
            ))}
          </select>

          {selected && (
            <button
              onClick={() => loadColumns(selected)}
              disabled={loading}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer border border-slate-200 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Atualizar
            </button>
          )}
        </div>

        {tableOptions.length === 0 && (
          <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
            Nenhuma tabela raw encontrada — crie uma integração (Pipeline Automático) primeiro.
          </p>
        )}
      </div>

      {selected && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 font-mono flex items-center gap-2">
                <Database className="w-4 h-4 text-slate-500" /> raw_{selected.table}
              </h3>
              <p className="text-xs text-slate-500">
                {selected.projectId}.{selected.rawDataset} · sistema: {selected.sistema}
              </p>
            </div>
            {!loading && !error && (
              <span className="text-xs px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 font-mono">
                {totalRows.toLocaleString('pt-BR')} linhas
              </span>
            )}
          </div>

          {loading && (
            <div className="p-8 flex items-center justify-center gap-2 text-slate-500 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Consultando schema e qualidade no BigQuery...
            </div>
          )}

          {!loading && error && (
            <div className="p-4 text-xs text-rose-700 bg-rose-50 border-t border-rose-100 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}

          {!loading && !error && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-mono text-[10px] border-b border-slate-200">
                  <tr>
                    <th className="p-3.5">Nome do Campo</th>
                    <th className="p-3.5">Tipo</th>
                    <th className="p-3.5">Qualidade dos Dados</th>
                    <th className="p-3.5">Dado Pessoal (LGPD)</th>
                    <th className="p-3.5 w-[32%]">Descrição</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {columns.map((col) => {
                    const badge = QUALITY_BADGE[col.quality.status];
                    const isEditing = editingColumn === col.name;
                    const isSaving = savingColumn === col.name;
                    return (
                      <tr key={col.name} className="hover:bg-slate-50 transition align-top">
                        <td className="p-3.5 font-mono font-semibold text-slate-900">{col.name}</td>
                        <td className="p-3.5 font-mono text-slate-500">{col.dataType}</td>
                        <td className="p-3.5">
                          <span className={`text-[10px] px-2 py-0.5 rounded font-semibold border ${badge.className}`}>
                            {badge.label}
                          </span>
                          <div className="text-[10px] text-slate-400 mt-1">
                            {col.quality.nullPct}% nulo · {col.quality.distinctCount.toLocaleString('pt-BR')} distintos
                          </div>
                        </td>
                        <td className="p-3.5">
                          {col.isPii ? (
                            <span className="text-[10px] px-2 py-0.5 rounded font-semibold bg-rose-50 text-rose-700 border border-rose-200 inline-flex items-center gap-1">
                              <Lock className="w-3 h-3" /> Dado Pessoal
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400">—</span>
                          )}
                        </td>
                        <td className="p-3.5">
                          {isEditing ? (
                            <div className="flex items-start gap-1.5">
                              <textarea
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                rows={2}
                                autoFocus
                                className="w-full text-xs border border-emerald-300 rounded-lg px-2 py-1.5 focus:outline-none focus:border-emerald-500"
                              />
                              <div className="flex flex-col gap-1 shrink-0">
                                <button
                                  onClick={() => saveEdit(col)}
                                  disabled={isSaving}
                                  className="p-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 cursor-pointer disabled:opacity-50"
                                  title="Salvar"
                                >
                                  {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                </button>
                                <button
                                  onClick={cancelEdit}
                                  disabled={isSaving}
                                  className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 cursor-pointer disabled:opacity-50"
                                  title="Cancelar"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-start justify-between gap-2 group min-h-[1.25rem]">
                              <span className="text-slate-600 whitespace-pre-wrap">{col.description}</span>
                              {canEdit && (
                                <button
                                  onClick={() => startEdit(col)}
                                  className="p-1 rounded text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 cursor-pointer shrink-0 opacity-0 group-hover:opacity-100 transition"
                                  title="Editar descrição"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                          {isEditing && saveError && <p className="text-[10px] text-rose-600 mt-1">{saveError}</p>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

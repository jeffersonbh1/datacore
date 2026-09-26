import React, { useEffect, useState } from 'react';
import { AlertTriangle, Info, ListChecks, Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import {
  fetchColumnValues, fetchQualityColumns, RULE_TYPE_LABEL, saveQualityRules,
  type QualityColumn, type QualityRule, type QualityRuleType,
} from '../../lib/quality';
import type { QualityTableRef } from './QualidadeView';

interface Props {
  table: QualityTableRef;
  rules: QualityRule[];
  onCancel: () => void;
  onSaved: (rules: QualityRule[], gitNote: string | null) => void;
}

/** Regra em edição: `key` estável para a lista (regras novas ainda não têm id). */
type Draft = QualityRule & { key: string };

let draftSeq = 0;
const newKey = () => `novo-${++draftSeq}`;

const KIND_LABEL: Record<string, string> = {
  string: 'texto', number: 'número', date: 'data', timestamp: 'data e hora', boolean: 'sim/não', other: 'outro',
};

/** Checagem rápida no navegador; a validação que vale é a do servidor. */
function draftError(d: Draft, col?: QualityColumn): string | null {
  if (!d.coluna) return 'Escolha a coluna.';
  if (!col) return 'Coluna não existe mais na tabela.';
  if (!col.regrasPermitidas.includes(d.tipo)) return `"${RULE_TYPE_LABEL[d.tipo]}" não se aplica a esta coluna.`;
  if (d.tipo === 'accepted_values' && !(d.parametros.valores || []).length) return 'Informe ao menos um valor permitido.';
  if (d.tipo === 'range') {
    const empty = (v: unknown) => v === undefined || v === null || v === '';
    if (empty(d.parametros.min) && empty(d.parametros.max)) return 'Informe o mínimo, o máximo ou os dois.';
  }
  return null;
}

export const QualityRulesEditor: React.FC<Props> = ({ table, rules, onCancel, onSaved }) => {
  const [drafts, setDrafts] = useState<Draft[]>(() => rules.map((r) => ({ ...r, key: `id-${r.id}` })));
  const [columns, setColumns] = useState<QualityColumn[] | null>(null);
  const [incremental, setIncremental] = useState(false);
  const [columnsError, setColumnsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    fetchQualityColumns(table.integracaoId, table.tabela)
      .then((res) => { if (alive) { setColumns(res.colunas); setIncremental(res.incremental); } })
      .catch((err) => { if (alive) setColumnsError(err instanceof Error ? err.message : 'Falha ao carregar as colunas.'); });
    return () => { alive = false; };
  }, [table.integracaoId, table.tabela]);

  const colByName = new Map((columns ?? []).map((c) => [c.nome, c]));
  const update = (key: string, patch: Partial<QualityRule>) =>
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const addRule = () => setDrafts((prev) => [...prev, {
    key: newKey(), integracaoId: table.integracaoId, tabela: table.tabela, coluna: '', tipo: 'not_null', parametros: {}, status: 'ativa',
  }]);

  const errors = drafts.map((d) => (columns ? draftError(d, colByName.get(d.coluna)) : null));
  const hasErrors = errors.some(Boolean);

  const save = async () => {
    setSaving(true);
    setSaveErrors([]);
    try {
      const res = await saveQualityRules(table.integracaoId, table.tabela, drafts);
      const gitNote = res.git === 'failed'
        ? `Atenção: o SQL foi gerado, mas não foi publicado no repositório (${res.gitDetail || 'erro no git'}).`
        : null;
      onSaved(res.regras, gitNote);
    } catch (err) {
      const details = (err as { details?: unknown }).details;
      setSaveErrors(Array.isArray(details) ? details.map(String) : [err instanceof Error ? err.message : 'Falha ao salvar.']);
    } finally {
      setSaving(false);
    }
  };

  if (columnsError) {
    return (
      <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-800">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <div className="space-y-2">
          <div>{columnsError}</div>
          <button onClick={onCancel} className="underline cursor-pointer">Voltar</button>
        </div>
      </div>
    );
  }

  if (!columns) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-xs text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-400" />
        Carregando as colunas e os tipos da tabela no BigQuery...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 p-3 rounded-lg border border-sky-200 bg-sky-50 text-xs text-sky-800">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          Linhas que violam uma regra ativa vão para a quarentena e não entram na Silver. Valores nulos só são
          reprovados pela regra "Obrigatório". As regras valem a partir da próxima execução da Silver.
          {incremental && ' Esta Silver é incremental: as regras valem para registros novos ou alterados — para revalidar a tabela inteira, execute "Do zero" no Studio.'}
        </span>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm divide-y divide-slate-100">
        {drafts.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-slate-500">Nenhuma regra. Sem regras, a Silver continua sendo uma cópia da Bronze.</div>
        )}
        {drafts.map((d, i) => (
          <RuleRow
            key={d.key}
            draft={d}
            columns={columns}
            column={colByName.get(d.coluna)}
            table={table}
            error={errors[i]}
            onChange={(patch) => update(d.key, patch)}
            onRemove={() => setDrafts((prev) => prev.filter((x) => x.key !== d.key))}
          />
        ))}
        <div className="px-4 py-3">
          <button onClick={addRule} className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800 cursor-pointer">
            <Plus className="w-3.5 h-3.5" />
            Adicionar regra
          </button>
        </div>
      </div>

      {saveErrors.length > 0 && (
        <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-xs text-rose-800 space-y-1">
          {saveErrors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} disabled={saving} className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs text-slate-700 cursor-pointer disabled:opacity-60">
          Cancelar
        </button>
        <button
          onClick={() => void save()}
          disabled={saving || hasErrors}
          title={hasErrors ? 'Corrija as regras marcadas antes de salvar.' : undefined}
          className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {saving ? 'Salvando e gerando a Silver...' : 'Salvar regras'}
        </button>
      </div>
    </div>
  );
};

interface RowProps {
  draft: Draft;
  columns: QualityColumn[];
  column?: QualityColumn;
  table: QualityTableRef;
  error: string | null;
  onChange: (patch: Partial<QualityRule>) => void;
  onRemove: () => void;
}

const RuleRow: React.FC<RowProps> = ({ draft, columns, column, table, error, onChange, onRemove }) => {
  const allowed = column?.regrasPermitidas ?? (['not_null'] as QualityRuleType[]);
  const inputType = column?.tipo === 'number' ? 'number' : column?.tipo === 'date' || column?.tipo === 'timestamp' ? 'date' : 'text';

  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={draft.coluna}
          onChange={(e) => {
            const col = columns.find((c) => c.nome === e.target.value);
            const tipo = col && !col.regrasPermitidas.includes(draft.tipo) ? 'not_null' : draft.tipo;
            onChange({ coluna: e.target.value, tipo, parametros: {} });
          }}
          className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 min-w-48 cursor-pointer"
        >
          <option value="">Coluna...</option>
          {columns.map((c) => (
            <option key={c.nome} value={c.nome}>{c.nome} ({KIND_LABEL[c.tipo]}{c.pk ? ', chave' : ''})</option>
          ))}
          {draft.coluna && !column && <option value={draft.coluna}>{draft.coluna} (não existe mais)</option>}
        </select>
        <select
          value={draft.tipo}
          onChange={(e) => onChange({ tipo: e.target.value as QualityRuleType, parametros: {} })}
          disabled={!column}
          className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 cursor-pointer disabled:opacity-60"
        >
          {allowed.map((t) => <option key={t} value={t}>{RULE_TYPE_LABEL[t]}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer ml-auto">
          <input
            type="checkbox"
            checked={draft.status === 'ativa'}
            onChange={(e) => onChange({ status: e.target.checked ? 'ativa' : 'inativa' })}
            className="accent-indigo-600"
          />
          Ativa
        </label>
        <button onClick={onRemove} title="Excluir regra" className="p-1.5 text-slate-400 hover:text-rose-600 cursor-pointer">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {column && draft.tipo === 'range' && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span>Mínimo</span>
          <input
            type={inputType}
            value={draft.parametros.min ?? ''}
            onChange={(e) => onChange({ parametros: { ...draft.parametros, min: e.target.value } })}
            className="border border-slate-200 rounded-lg px-2.5 py-1.5 w-40"
            placeholder="sem mínimo"
          />
          <span>Máximo</span>
          <input
            type={inputType}
            value={draft.parametros.max ?? ''}
            onChange={(e) => onChange({ parametros: { ...draft.parametros, max: e.target.value } })}
            className="border border-slate-200 rounded-lg px-2.5 py-1.5 w-40"
            placeholder="sem máximo"
          />
        </div>
      )}

      {column && draft.tipo === 'accepted_values' && (
        <AcceptedValues
          values={draft.parametros.valores ?? []}
          inputType={inputType}
          onChange={(valores) => onChange({ parametros: { valores } })}
          loadExisting={() => fetchColumnValues(table.integracaoId, table.tabela, draft.coluna)}
        />
      )}

      {error && <div className="text-[11px] text-rose-600">{error}</div>}
    </div>
  );
};

const AcceptedValues: React.FC<{
  values: Array<string | number>;
  inputType: string;
  onChange: (values: Array<string | number>) => void;
  loadExisting: () => Promise<{ valores: Array<{ valor: string; qtd: number }> }>;
}> = ({ values, inputType, onChange, loadExisting }) => {
  const [text, setText] = useState('');
  const [existing, setExisting] = useState<Array<{ valor: string; qtd: number }> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = (v: string) => {
    const value = v.trim();
    if (!value || values.map(String).includes(value)) return;
    onChange([...values, value]);
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setExisting((await loadExisting()).valores);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar os valores.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {values.map((v) => (
          <span key={String(v)} className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 font-mono">
            {String(v)}
            <button onClick={() => onChange(values.filter((x) => x !== v))} className="cursor-pointer hover:text-rose-600"><X className="w-3 h-3" /></button>
          </span>
        ))}
        <input
          type={inputType}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(text); setText(''); } }}
          placeholder="digite e tecle Enter"
          className="border border-slate-200 rounded-lg px-2.5 py-1 text-xs w-44"
        />
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 cursor-pointer disabled:opacity-60"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ListChecks className="w-3.5 h-3.5" />}
          Ver valores existentes
        </button>
      </div>
      <div className="text-[11px] text-slate-400">Maiúsculas e minúsculas contam: "Pago" e "pago" são valores diferentes.</div>
      {error && <div className="text-[11px] text-rose-600">{error}</div>}
      {existing && (
        <div className="border border-slate-200 rounded-lg p-2 bg-slate-50">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] text-slate-500">Valores na Bronze (até 50 mais frequentes) — clique para adicionar</span>
            {existing.length > 0 && (
              <button onClick={() => onChange([...values, ...existing.map((e) => e.valor).filter((v) => !values.map(String).includes(v))])} className="text-[11px] text-indigo-600 hover:text-indigo-800 cursor-pointer">
                Adicionar todos
              </button>
            )}
          </div>
          {existing.length === 0 && <div className="text-[11px] text-slate-500">A coluna só tem valores nulos.</div>}
          <div className="flex flex-wrap gap-1.5">
            {existing.map((e) => (
              <button
                key={e.valor}
                onClick={() => add(e.valor)}
                disabled={values.map(String).includes(e.valor)}
                className="text-[11px] px-2 py-0.5 rounded-md bg-white border border-slate-200 hover:border-indigo-300 font-mono cursor-pointer disabled:opacity-40 disabled:cursor-default"
              >
                {e.valor} <span className="text-slate-400">({e.qtd.toLocaleString('pt-BR')})</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

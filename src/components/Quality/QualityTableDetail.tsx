import React, { useState } from 'react';
import { AlertTriangle, ArrowLeft, Eye, Loader2, Pencil } from 'lucide-react';
import {
  acceptedPct, describeRule, fetchQuarantineSample, RULE_TYPE_LABEL, type QualityExecution, type QualityRule,
} from '../../lib/quality';
import type { QualityTableRef } from './QualidadeView';
import { QualityRulesEditor } from './QualityRulesEditor';
import { ExecutionStatusBadge, formatCount, formatDateTime, formatPct } from './qualityUi';

interface Props {
  table: QualityTableRef;
  rules: QualityRule[];
  /** Execuções desta tabela, mais recentes primeiro. */
  executions: QualityExecution[];
  canEdit: boolean;
  onBack: () => void;
  onRulesSaved: (rules: QualityRule[]) => void;
}

type Tab = 'regras' | 'historico' | 'quarentena';
const HISTORY_SIZE = 20;

export const QualityTableDetail: React.FC<Props> = ({ table, rules, executions, canEdit, onBack, onRulesSaved }) => {
  const [tab, setTab] = useState<Tab>('regras');
  const [editing, setEditing] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const last = executions[0];

  return (
    <div id="quality-table-detail" className="space-y-4">
      <div className="flex items-start gap-3">
        <button
          onClick={onBack}
          className="p-1.5 mt-0.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 cursor-pointer"
          title="Voltar para a lista"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-slate-900">{table.tabela}</h2>
          <p className="text-xs text-slate-500">{table.integracaoNome} · camada Silver</p>
        </div>
        {last && <ExecutionStatusBadge status={last.status} />}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Linhas aceitas" value={last ? formatPct(acceptedPct(last)) : '—'} hint={last ? `${formatCount(last.linhasProcessadas)} gravadas na Silver` : 'ainda não validada'} />
        <Tile label="Em quarentena" value={last ? formatCount(last.linhasRejeitadas) : '—'} hint="na última execução" warn={!!last && last.linhasRejeitadas > 0} />
        <Tile label="Testes aprovados" value={last ? `${last.testesAprovados}/${last.testesTotal}` : '—'} hint="chave, reconciliação" warn={!!last && last.testesAprovados < last.testesTotal} />
        <Tile label="Última validação" value={last ? formatDateTime(last.executadoEm) : '—'} hint={`${rules.filter((r) => r.status === 'ativa').length} regra(s) ativa(s)`} />
      </div>

      {last?.erro && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-rose-200 bg-rose-50 text-xs text-rose-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{last.erro}</span>
        </div>
      )}

      <div className="flex gap-1 border-b border-slate-200">
        {([['regras', 'Regras'], ['historico', 'Histórico'], ['quarentena', 'Quarentena']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px cursor-pointer ${tab === id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {savedNotice && (
        <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50 text-xs text-emerald-800">{savedNotice}</div>
      )}

      {tab === 'regras' && (editing ? (
        <QualityRulesEditor
          table={table}
          rules={rules}
          onCancel={() => setEditing(false)}
          onSaved={(saved, gitNote) => {
            onRulesSaved(saved);
            setEditing(false);
            setSavedNotice(`Regras salvas. Elas passam a valer na próxima execução da Silver desta tabela.${gitNote ? ` ${gitNote}` : ''}`);
          }}
        />
      ) : (
        <RulesList rules={rules} last={last} canEdit={canEdit} onEdit={() => { setSavedNotice(null); setEditing(true); }} />
      ))}

      {tab === 'historico' && <History executions={executions.slice(0, HISTORY_SIZE)} />}

      {tab === 'quarentena' && <Quarantine table={table} rules={rules} last={last} />}
    </div>
  );
};

const Tile: React.FC<{ label: string; value: string; hint: string; warn?: boolean }> = ({ label, value, hint, warn }) => (
  <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm">
    <div className="text-[11px] text-slate-500 font-medium">{label}</div>
    <div className={`text-lg font-bold mt-1 ${warn ? 'text-amber-600' : 'text-slate-900'}`}>{value}</div>
    <div className="text-[11px] text-slate-400 mt-0.5">{hint}</div>
  </div>
);

const RulesList: React.FC<{ rules: QualityRule[]; last?: QualityExecution; canEdit: boolean; onEdit: () => void }> = ({ rules, last, canEdit, onEdit }) => (
  <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
      <span className="text-xs text-slate-500">
        A chave primária (única e não nula) é sempre validada. As regras abaixo decidem o que vai para a quarentena.
      </span>
      {canEdit && (
        <button
          onClick={onEdit}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold cursor-pointer shrink-0 ml-3"
        >
          <Pencil className="w-3.5 h-3.5" />
          Editar regras
        </button>
      )}
    </div>
    {rules.length === 0 ? (
      <div className="px-4 py-8 text-center text-xs text-slate-500">
        Nenhuma regra cadastrada — a Silver desta tabela é uma cópia da Bronze{canEdit ? '. Use "Editar regras" para começar.' : '.'}
      </div>
    ) : (
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
            <th className="px-4 py-2 font-medium">Regra</th>
            <th className="px-3 py-2 font-medium">Tipo</th>
            <th className="px-3 py-2 font-medium">Situação</th>
            <th className="px-3 py-2 font-medium text-right">Rejeitadas na última execução</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => {
            const n = r.id !== undefined ? last?.motivos[String(r.id)] ?? 0 : 0;
            return (
              <tr key={r.id} className="border-b border-slate-50 last:border-0">
                <td className="px-4 py-2.5 text-slate-800">{describeRule(r)}</td>
                <td className="px-3 py-2.5 text-slate-500">{RULE_TYPE_LABEL[r.tipo]}</td>
                <td className="px-3 py-2.5">
                  <span className={`text-[11px] px-2 py-0.5 rounded-md border ${r.status === 'ativa' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                    {r.status === 'ativa' ? 'Ativa' : 'Inativa'}
                  </span>
                </td>
                <td className={`px-3 py-2.5 text-right font-mono ${n > 0 ? 'text-amber-700 font-semibold' : 'text-slate-500'}`}>
                  {last && r.status === 'ativa' ? n.toLocaleString('pt-BR') : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    )}
  </div>
);

const History: React.FC<{ executions: QualityExecution[] }> = ({ executions }) => {
  const [open, setOpen] = useState<number | null>(null);
  if (executions.length === 0) {
    return <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-xs text-slate-500">Nenhuma execução registrada — execute a Silver desta tabela.</div>;
  }
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
            <th className="px-4 py-2 font-medium">Execução</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium text-right">Gravadas</th>
            <th className="px-3 py-2 font-medium text-right">Quarentena</th>
            <th className="px-3 py-2 font-medium text-right">Aceitas</th>
            <th className="px-3 py-2 font-medium text-right">Testes</th>
            <th className="px-3 py-2 font-medium text-right">Total Silver</th>
          </tr>
        </thead>
        <tbody>
          {executions.map((e) => (
            <React.Fragment key={e.id}>
              <tr
                onClick={() => setOpen(open === e.id ? null : e.id)}
                className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer"
              >
                <td className="px-4 py-2.5 text-slate-700 whitespace-nowrap">{formatDateTime(e.executadoEm)}</td>
                <td className="px-3 py-2.5"><ExecutionStatusBadge status={e.status} /></td>
                <td className="px-3 py-2.5 text-right font-mono">{formatCount(e.linhasProcessadas)}</td>
                <td className={`px-3 py-2.5 text-right font-mono ${e.linhasRejeitadas > 0 ? 'text-amber-700 font-semibold' : ''}`}>{formatCount(e.linhasRejeitadas)}</td>
                <td className="px-3 py-2.5 text-right font-mono">{formatPct(acceptedPct(e))}</td>
                <td className="px-3 py-2.5 text-right font-mono">{e.testesAprovados}/{e.testesTotal}</td>
                <td className="px-3 py-2.5 text-right font-mono text-slate-500">{formatCount(e.linhasSilver)}</td>
              </tr>
              {open === e.id && (
                <tr className="bg-slate-50 border-b border-slate-100">
                  <td colSpan={7} className="px-4 py-3 space-y-1">
                    {e.erro && <div className="text-rose-700">{e.erro}</div>}
                    {e.testes.length === 0 && !e.erro && <div className="text-slate-500">Nenhum teste nesta execução.</div>}
                    {e.testes.map((t, i) => (
                      <div key={i} className="flex gap-2">
                        <span className={`font-mono ${t.status === 'pass' ? 'text-emerald-700' : t.status === 'warn' ? 'text-amber-700' : 'text-rose-700'}`}>{t.status}</span>
                        <span className="text-slate-700">{t.nome}</span>
                        {t.mensagem && t.status !== 'pass' && <span className="text-slate-500">— {t.mensagem}</span>}
                      </div>
                    ))}
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const Quarantine: React.FC<{ table: QualityTableRef; rules: QualityRule[]; last?: QualityExecution }> = ({ table, rules, last }) => {
  const [sample, setSample] = useState<Array<Record<string, unknown>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byRule = Object.entries(last?.motivos ?? {}).sort((a, b) => b[1] - a[1]);
  const ruleLabel = (id: string) => {
    const r = rules.find((x) => String(x.id) === id);
    return r ? describeRule(r) : `Regra #${id} (removida)`;
  };

  const loadSample = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchQuarantineSample(table.integracaoId, table.tabela);
      setSample(res.linhas);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar a amostra.');
    } finally {
      setLoading(false);
    }
  };

  const columns = sample && sample.length > 0
    ? ['_motivos_rejeicao', ...Object.keys(sample[0]).filter((k) => k !== '_motivos_rejeicao')]
    : [];

  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
        <div className="text-xs font-semibold text-slate-700 mb-2">Motivos na última execução</div>
        {!last || byRule.length === 0 ? (
          <div className="text-xs text-slate-500">Nenhuma linha em quarentena na última execução.</div>
        ) : (
          <div className="space-y-1.5">
            {byRule.map(([id, n]) => (
              <div key={id} className="flex items-center justify-between text-xs">
                <span className="text-slate-700">{ruleLabel(id)}</span>
                <span className="font-mono text-amber-700 font-semibold">{n.toLocaleString('pt-BR')}</span>
              </div>
            ))}
            <div className="text-[11px] text-slate-400 pt-1">Uma linha pode violar mais de uma regra — a soma pode passar do total em quarentena.</div>
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <span className="text-xs text-slate-500">
            Amostra de até 100 linhas rejeitadas na última execução com quarentena (dados pessoais já mascarados na Bronze). A quarentena guarda 90 dias.
          </span>
          <button
            onClick={() => void loadSample()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-medium cursor-pointer shrink-0 ml-3 disabled:opacity-60"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
            {sample ? 'Recarregar amostra' : 'Ver amostra'}
          </button>
        </div>
        {error && <div className="px-4 py-3 text-xs text-rose-700">{error}</div>}
        {sample && sample.length === 0 && <div className="px-4 py-6 text-center text-xs text-slate-500">Nenhuma linha em quarentena registrada.</div>}
        {sample && sample.length > 0 && (
          <div className="overflow-x-auto max-h-[28rem]">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  {columns.map((c) => <th key={c} className="px-3 py-2 text-left font-medium text-slate-500 whitespace-nowrap">{c === '_motivos_rejeicao' ? 'Motivos' : c}</th>)}
                </tr>
              </thead>
              <tbody>
                {sample.map((row, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    {columns.map((c) => (
                      <td key={c} className={`px-3 py-1.5 whitespace-nowrap ${c === '_motivos_rejeicao' ? 'text-amber-700' : 'text-slate-700 font-mono'}`}>
                        {c === '_motivos_rejeicao'
                          ? (Array.isArray(row[c]) ? (row[c] as string[]).map((m) => m.replace(/^r\d+:\s*/, '')).join('; ') : '')
                          : row[c] === null || row[c] === undefined ? <span className="text-slate-300">null</span> : String(row[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

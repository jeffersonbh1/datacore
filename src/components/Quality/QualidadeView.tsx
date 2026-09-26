import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BadgeCheck, ChevronRight, Loader2, RefreshCw, Search } from 'lucide-react';
import { AutoIntegration } from '../../types';
import {
  acceptedPct, fetchQualityExecutions, fetchQualityRules, type QualityExecution, type QualityRule,
} from '../../lib/quality';
import { QualityTableDetail } from './QualityTableDetail';
import { ExecutionStatusBadge, formatDateTime, formatPct } from './qualityUi';

interface QualidadeViewProps {
  /** Integrações persistidas da empresa (id do banco). */
  integrations: AutoIntegration[];
  /** Abre já filtrado por esta integração (atalho do card em Pipelines & Fluxos). */
  initialIntegrationId?: number | null;
  /** Admin / engenheiro de dados: pode editar regras. */
  canEdit: boolean;
}

export interface QualityTableRef {
  integracaoId: number;
  integracaoNome: string;
  tabela: string;
}

const TREND_SIZE = 10;
const PAGE_SIZE = 15;

export const QualidadeView: React.FC<QualidadeViewProps> = ({ integrations, initialIntegrationId = null, canEdit }) => {
  const [rules, setRules] = useState<QualityRule[]>([]);
  const [executions, setExecutions] = useState<QualityExecution[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [integrationFilter, setIntegrationFilter] = useState<string>(initialIntegrationId ? String(initialIntegrationId) : 'all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<QualityTableRef | null>(null);
  const [page, setPage] = useState(0);

  // Filtro novo = volta para a primeira página.
  useEffect(() => { setPage(0); }, [integrationFilter, search]);

  useEffect(() => {
    if (initialIntegrationId) setIntegrationFilter(String(initialIntegrationId));
  }, [initialIntegrationId]);

  // Só Supabase na abertura: rápido e sem acordar o gateway.
  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [r, e] = await Promise.all([fetchQualityRules(), fetchQualityExecutions()]);
      setRules(r);
      setExecutions(e);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao carregar.';
      setLoadError(/does not exist|schema cache/i.test(msg)
        ? 'As tabelas de qualidade ainda não existem no banco — rode o script sql/018_qualidade_silver.sql no Supabase.'
        : msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const dbIntegrations = useMemo(() => integrations.filter((i) => /^\d+$/.test(i.id)), [integrations]);

  const rows = useMemo(() => {
    const out: Array<QualityTableRef & { history: QualityExecution[]; activeRules: number }> = [];
    for (const integ of dbIntegrations) {
      if (integrationFilter !== 'all' && integ.id !== integrationFilter) continue;
      const integracaoId = Number(integ.id);
      for (const tabela of integ.selectedTables) {
        if (search && !`${tabela} ${integ.name}`.toLowerCase().includes(search.toLowerCase())) continue;
        out.push({
          integracaoId,
          integracaoNome: integ.name,
          tabela,
          history: executions.filter((e) => e.integracaoId === integracaoId && e.tabela === tabela),
          activeRules: rules.filter((r) => r.integracaoId === integracaoId && r.tabela === tabela && r.status === 'ativa').length,
        });
      }
    }
    return out.sort((a, b) => a.integracaoNome.localeCompare(b.integracaoNome) || a.tabela.localeCompare(b.tabela));
  }, [dbIntegrations, integrationFilter, search, executions, rules]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pageStart = currentPage * PAGE_SIZE;
  const pageRows = rows.slice(pageStart, pageStart + PAGE_SIZE);

  const totals = useMemo(() => {
    const latest = rows.map((r) => r.history[0]).filter((e): e is QualityExecution => !!e);
    return {
      tables: rows.length,
      validated: latest.length,
      withRules: rows.filter((r) => r.activeRules > 0).length,
      rejected: latest.reduce((s, e) => s + e.linhasRejeitadas, 0),
      problems: latest.filter((e) => e.status === 'erro' || e.status === 'teste_falhou').length,
    };
  }, [rows]);

  if (selected) {
    return (
      <QualityTableDetail
        table={selected}
        rules={rules.filter((r) => r.integracaoId === selected.integracaoId && r.tabela === selected.tabela)}
        executions={executions.filter((e) => e.integracaoId === selected.integracaoId && e.tabela === selected.tabela)}
        canEdit={canEdit}
        onBack={() => setSelected(null)}
        onRulesSaved={(saved) => setRules((prev) => [
          ...prev.filter((r) => !(r.integracaoId === selected.integracaoId && r.tabela === selected.tabela)),
          ...saved,
        ])}
      />
    );
  }

  return (
    <div id="quality-view-container" className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <BadgeCheck className="w-4.5 h-4.5 text-indigo-600" />
            Qualidade de Dados
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Regras de validação da camada Silver. Linhas que violam uma regra vão para a quarentena em vez da Silver.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-medium transition cursor-pointer shadow-2xs disabled:opacity-60 self-start"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryTile label="Tabelas Silver" value={isLoading ? null : String(totals.tables)} hint={`${totals.validated} já validada(s)`} />
        <SummaryTile label="Com regras ativas" value={isLoading ? null : String(totals.withRules)} hint="tabelas com validação" />
        <SummaryTile label="Em quarentena" value={isLoading ? null : totals.rejected.toLocaleString('pt-BR')} hint="linhas na última execução" tone={totals.rejected > 0 ? 'warn' : undefined} />
        <SummaryTile label="Com problema" value={isLoading ? null : String(totals.problems)} hint="teste reprovado ou erro" tone={totals.problems > 0 ? 'bad' : undefined} />
      </div>

      <div className="flex flex-col sm:flex-row gap-2 bg-white border border-slate-200 p-3 rounded-xl shadow-sm">
        <div className="flex items-center gap-2 flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus-within:bg-white focus-within:border-indigo-500">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar tabela ou integração..."
            className="w-full bg-transparent focus:outline-none text-slate-800 placeholder-slate-400"
          />
        </div>
        <select
          value={integrationFilter}
          onChange={(e) => setIntegrationFilter(e.target.value)}
          className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
        >
          <option value="all">Todas as integrações</option>
          {dbIntegrations.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </div>

      {loadError && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{loadError}</span>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
              <th className="px-4 py-2.5 font-medium">Tabela</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-3 py-2.5 font-medium text-right">Linhas aceitas</th>
              <th className="px-3 py-2.5 font-medium text-right">Quarentena</th>
              <th className="px-3 py-2.5 font-medium text-right">Testes</th>
              <th className="px-3 py-2.5 font-medium text-right">Regras</th>
              <th className="px-3 py-2.5 font-medium">Tendência</th>
              <th className="px-3 py-2.5 font-medium">Última validação</th>
              <th className="px-2 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {isLoading && rows.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-400" />
                Carregando tabelas...
              </td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                Nenhuma tabela Silver encontrada{integrationFilter !== 'all' || search ? ' com esse filtro' : ''}.
              </td></tr>
            )}
            {pageRows.map((row) => {
              const last = row.history[0];
              return (
                <tr
                  key={`${row.integracaoId}:${row.tabela}`}
                  onClick={() => setSelected(row)}
                  className="border-b border-slate-50 last:border-0 hover:bg-slate-50 cursor-pointer"
                >
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-slate-800">{row.tabela}</div>
                    <div className="text-[11px] text-slate-400">{row.integracaoNome}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    {last ? <ExecutionStatusBadge status={last.status} /> : <span className="text-[11px] text-slate-400">Ainda não validada</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-slate-700">{last ? formatPct(acceptedPct(last)) : '—'}</td>
                  <td className={`px-3 py-2.5 text-right font-mono ${last && last.linhasRejeitadas > 0 ? 'text-amber-700 font-semibold' : 'text-slate-500'}`}>
                    {last ? last.linhasRejeitadas.toLocaleString('pt-BR') : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-slate-700">{last ? `${last.testesAprovados}/${last.testesTotal}` : '—'}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-slate-700">{row.activeRules}</td>
                  <td className="px-3 py-2.5"><Trend history={row.history.slice(0, TREND_SIZE)} /></td>
                  <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{last ? formatDateTime(last.executadoEm) : '—'}</td>
                  <td className="px-2 py-2.5 text-slate-300"><ChevronRight className="w-4 h-4" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length > 0 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100 text-[11px] text-slate-500">
            <span>
              {totalPages > 1
                ? <>Mostrando {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, rows.length)} de {rows.length} tabelas</>
                : `${rows.length} tabela${rows.length === 1 ? '' : 's'}`}
            </span>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                  className="px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer font-medium"
                >
                  Anterior
                </button>
                <span className="font-mono">Página {currentPage + 1} de {totalPages}</span>
                <button
                  type="button"
                  disabled={currentPage >= totalPages - 1}
                  onClick={() => setPage(currentPage + 1)}
                  className="px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer font-medium"
                >
                  Próxima
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const SummaryTile: React.FC<{ label: string; value: string | null; hint: string; tone?: 'warn' | 'bad' }> = ({ label, value, hint, tone }) => (
  <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm">
    <div className="text-[11px] text-slate-500 font-medium">{label}</div>
    <div className={`text-xl font-bold mt-1 ${tone === 'bad' ? 'text-rose-600' : tone === 'warn' ? 'text-amber-600' : 'text-slate-900'}`}>
      {value === null ? <Loader2 className="w-4 h-4 animate-spin text-slate-400 my-1" /> : value}
    </div>
    <div className="text-[11px] text-slate-400 mt-0.5">{hint}</div>
  </div>
);

/** Barras do % de linhas aceitas das últimas execuções (mais antiga à esquerda). */
const Trend: React.FC<{ history: QualityExecution[] }> = ({ history }) => {
  if (history.length === 0) return <span className="text-slate-300">—</span>;
  const points = [...history].reverse();
  return (
    <div className="flex items-end gap-0.5 h-5" title="% de linhas aceitas nas últimas execuções">
      {points.map((e) => {
        const pct = acceptedPct(e);
        const bad = e.status === 'erro' || e.status === 'teste_falhou';
        const h = pct === null ? 20 : Math.max(12, pct);
        return (
          <span
            key={e.id}
            title={`${formatDateTime(e.executadoEm)} — ${formatPct(pct)} aceitas`}
            className={`w-1.5 rounded-sm ${bad ? 'bg-rose-400' : pct !== null && pct < 100 ? 'bg-amber-400' : 'bg-emerald-400'}`}
            style={{ height: `${h}%` }}
          />
        );
      })}
    </div>
  );
};

import React, { useCallback, useEffect, useState } from 'react';
import {
  DollarSign, TrendingDown, Sparkles, Server, Zap,
  CheckCircle, HelpCircle,
  AlertCircle, RefreshCw, Loader2, ClipboardCopy, Check
} from 'lucide-react';
import { CostRecommendation, GcpCostReport, GcpResourceCost } from '../../types';
import { fetchGcpCostReport } from '../../lib/airbyteGateway';
import { fetchRecordsSyncedLast30Days } from '../../lib/supabase';

interface CostAnalyticsProps {
  canViewFinOps: boolean;
  idEmpresa?: number | null;
}

const CATEGORY_LABEL: Record<GcpResourceCost['category'], string> = {
  compute: 'Compute Engine',
  cloud_run: 'Cloud Run',
  bigquery: 'BigQuery',
  artifact_registry: 'Artifact Registry',
  secret_manager: 'Secret Manager',
  other: 'Outros',
};

const CATEGORY_COLOR: Record<GcpResourceCost['category'], string> = {
  compute: '#F59E0B',
  cloud_run: '#3B82F6',
  bigquery: '#06B6D4',
  artifact_registry: '#6366F1',
  secret_manager: '#94A3B8',
  other: '#10B981',
};

/** `showMonth = false` (padrão do eixo do gráfico) mostra só o dia; o rótulo de
 *  intervalo do cabeçalho e o caso de o período passar de um mês pedem "dd/mm". */
function formatDay(iso: string, showMonth = true): string {
  const [, m, d] = iso.split('-');
  return showMonth ? `${d}/${m}` : d;
}

function CopyCommandButton({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(command);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard indisponível (ex.: contexto não seguro) — sem crash, só não copia.
        }
      }}
      title={command}
      className="flex items-center gap-1 px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded text-[10px] font-medium border border-slate-200 transition cursor-pointer shrink-0"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <ClipboardCopy className="w-3 h-3" />}
      {copied ? 'Copiado' : 'Copiar comando'}
    </button>
  );
}

export const CostAnalytics: React.FC<CostAnalyticsProps> = ({ canViewFinOps, idEmpresa }) => {
  const [report, setReport] = useState<GcpCostReport | null>(null);
  const [recordsSynced30d, setRecordsSynced30d] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  // Inputs de data do gráfico — controlados aqui, sincronizados com o range
  // que o servidor de fato usou assim que a resposta chega (o 1º load, sem
  // range explícito, usa o default do servidor: mês atual em São Paulo).
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');

  const refresh = useCallback(async (force: boolean, range?: { start: string; end: string }) => {
    setLoading(true);
    setError(null);
    try {
      const [reportData, records] = await Promise.all([
        fetchGcpCostReport(force, range),
        idEmpresa ? fetchRecordsSyncedLast30Days(idEmpresa) : Promise.resolve(0),
      ]);
      setReport(reportData);
      setRangeStart(reportData.rangeStart);
      setRangeEnd(reportData.rangeEnd);
      setRecordsSynced30d(records);
      setLastRefreshedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar custos reais do GCP.');
    } finally {
      setLoading(false);
    }
  }, [idEmpresa]);

  useEffect(() => {
    if (!canViewFinOps) return;
    refresh(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewFinOps]);

  const handleApplyRange = () => {
    if (!rangeStart || !rangeEnd) return;
    refresh(true, { start: rangeStart, end: rangeEnd });
  };

  const handleResetToCurrentMonth = () => {
    refresh(true, undefined);
  };

  const handleApply = (id: string) => {
    setAppliedIds(prev => new Set(prev).add(id));
  };

  if (!canViewFinOps) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-slate-500 space-y-3 shadow-sm">
        <DollarSign className="w-12 h-12 text-slate-400 mx-auto" />
        <h3 className="text-lg font-bold text-slate-900">Acesso Restrito ao Painel FinOps</h3>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          Seu papel de usuário atual não possui permissão para visualizar métricas de faturamento e custos de computação em nuvem. Contate o Administrador Global se necessitar de acesso.
        </p>
      </div>
    );
  }

  const recommendations = report?.recommendations || [];
  const totalPotentialSavings = recommendations
    .filter(r => !appliedIds.has(r.id))
    .reduce((sum, r) => sum + r.potentialSavingsUsd, 0);
  const appliedSavings = recommendations
    .filter(r => appliedIds.has(r.id))
    .reduce((sum, r) => sum + r.potentialSavingsUsd, 0);
  const topRecommendation = [...recommendations].sort((a, b) => b.potentialSavingsUsd - a.potentialSavingsUsd)[0];

  const totalMonthly = (report?.totalMonthlyCostUsd || 0) - appliedSavings;
  const costPerMillion = recordsSynced30d > 0 ? (report?.totalMonthlyCostUsd || 0) / (recordsSynced30d / 1_000_000) : null;

  // Agrupado por produto GCP (Compute Engine, Cloud Run, BigQuery...) — mesmo
  // agrupamento do relatório nativo do Console de Billing ("Mês atual,
  // Agrupar por Produto"), só que com os números que já calculamos (uso real
  // medido × preço de lista), não a fatura oficial (ver nota de rodapé).
  interface ProductGroup { category: GcpResourceCost['category']; monthlyCostUsd: number; items: GcpResourceCost[] }
  const productGroupsMap = new Map<GcpResourceCost['category'], ProductGroup>();
  for (const res of report?.resources || []) {
    const group = productGroupsMap.get(res.category) || { category: res.category, monthlyCostUsd: 0, items: [] };
    group.monthlyCostUsd += res.monthlyCostUsd;
    group.items.push(res);
    productGroupsMap.set(res.category, group);
  }
  const productGroups = [...productGroupsMap.values()].sort((a, b) => b.monthlyCostUsd - a.monthlyCostUsd);
  const maxDailyTotal = Math.max(
    1,
    ...(report?.dailyTrend || []).map(d => d.computeUsd + d.cloudRunUsd + d.bigqueryUsd),
  );
  // Rótulo de cada barra: só o dia normalmente; dia/mês quando o período selecionado
  // atravessa mais de um mês (senão "01", "02"... de meses diferentes ficam ambíguos).
  const spansMultipleMonths = !!report && report.rangeStart.slice(0, 7) !== report.rangeEnd.slice(0, 7);

  return (
    <div id="finops-view-container" className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <DollarSign className="w-4.5 h-4.5 text-emerald-600" />
            Custos & FinOps
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {report?.costSource === 'billing_export'
              ? <>Fatura oficial real do GCP (projeto {report.projectId}), via BigQuery Billing Export — não é estimativa.</>
              : <>Inventário real de recursos GCP (projeto {report?.projectId || '—'}) + uso real medido × preço público
                de lista — não é a fatura oficial do Cloud Billing (sem billing export configurado).</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastRefreshedAt && (
            <span className="text-[11px] text-slate-400">Atualizado às {lastRefreshedAt.toLocaleTimeString('pt-BR')}</span>
          )}
          <button
            onClick={() => refresh(true, rangeStart && rangeEnd ? { start: rangeStart, end: rangeEnd } : undefined)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-medium transition cursor-pointer shadow-2xs disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-rose-500 hover:text-rose-700 cursor-pointer">✕</button>
        </div>
      )}

      {loading && !report ? (
        <div className="bg-white border border-slate-200 rounded-xl p-16 text-center text-slate-500 space-y-2 shadow-sm">
          <Loader2 className="w-8 h-8 text-indigo-400 mx-auto animate-spin" />
          <h4 className="text-sm font-semibold text-slate-800">Consultando recursos e preços reais no GCP...</h4>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Compute Engine, Cloud Run, BigQuery, Artifact Registry e Secret Manager — pode levar alguns segundos na primeira carga.
          </p>
        </div>
      ) : !report ? null : (
        <>
          {/* Top Banner KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between text-slate-500 text-xs mb-1 font-medium">
                <span>Gasto Real Neste Mês (até agora)</span>
                <DollarSign className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="text-2xl font-bold text-slate-900 flex items-baseline gap-1 font-mono">
                R${totalMonthly.toFixed(2)}
                <span className="text-xs text-slate-400 font-normal">BRL</span>
              </div>
              <div className="flex items-center gap-1 text-[11px] text-slate-500 mt-1 font-medium">
                <Server className="w-3.5 h-3.5" />
                <span>{report.resources.length} recursos reais no projeto {report.projectId}</span>
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between text-slate-500 text-xs mb-1 font-medium">
                <span>Custo por 1 Milhão de Registros</span>
                <Zap className="w-4 h-4 text-sky-600" />
              </div>
              <div className="text-2xl font-bold text-sky-600 flex items-baseline gap-1 font-mono">
                {costPerMillion != null ? `R$${costPerMillion.toFixed(2)}` : '—'}
                <span className="text-xs text-slate-400 font-normal">/ 1M</span>
              </div>
              <span className="text-[11px] text-slate-500">
                {recordsSynced30d > 0 ? `${recordsSynced30d.toLocaleString('pt-BR')} registros sincronizados (30d)` : 'Sem registros sincronizados nos últimos 30 dias'}
              </span>
            </div>

            <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between text-slate-500 text-xs mb-1 font-medium">
                <span>Maior Sub-utilização Detectada</span>
                <AlertCircle className="w-4 h-4 text-amber-600" />
              </div>
              <div className="text-2xl font-bold text-amber-600 flex items-baseline gap-1 font-mono">
                R${(topRecommendation?.potentialSavingsUsd || 0).toFixed(2)}
                <span className="text-xs text-slate-400 font-normal">/mês</span>
              </div>
              <span className="text-[11px] text-amber-600 font-medium truncate block" title={topRecommendation?.title}>
                {topRecommendation ? topRecommendation.title : 'Nenhuma sub-utilização relevante detectada'}
              </span>
            </div>

            <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between text-slate-500 text-xs mb-1 font-medium">
                <span>Economia Potencial Restante</span>
                <Sparkles className="w-4 h-4 text-indigo-600" />
              </div>
              <div className="text-2xl font-bold text-indigo-600 flex items-baseline gap-1 font-mono">
                R${totalPotentialSavings.toFixed(2)}
                <span className="text-xs text-slate-400 font-normal">/mês</span>
              </div>
              <span className="text-[11px] text-indigo-600 font-medium">
                Baseado em {recommendations.filter(r => !appliedIds.has(r.id)).length} recomendações reais ativas
              </span>
            </div>
          </div>

          {/* Charts Row: Resource Breakdown + Daily Trend */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Evolução do Gasto Diário {report.rangeStart && report.rangeEnd ? `(${formatDay(report.rangeStart)} a ${formatDay(report.rangeEnd)})` : ''}
                  </h3>
                  <p className="text-xs text-slate-500">VM é custo real por uptime medido; Cloud Run e BigQuery variam com uso real medido</p>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1.5 text-slate-600">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Compute Engine
                  </span>
                  <span className="flex items-center gap-1.5 text-slate-600">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Cloud Run
                  </span>
                  <span className="flex items-center gap-1.5 text-slate-600">
                    <span className="w-2.5 h-2.5 rounded-full bg-cyan-500" /> BigQuery
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap text-xs">
                <label className="flex items-center gap-1.5 text-slate-500">
                  De
                  <input
                    type="date"
                    value={rangeStart}
                    onChange={(e) => setRangeStart(e.target.value)}
                    className="border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-700"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-slate-500">
                  até
                  <input
                    type="date"
                    value={rangeEnd}
                    onChange={(e) => setRangeEnd(e.target.value)}
                    className="border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-700"
                  />
                </label>
                <button
                  type="button"
                  onClick={handleApplyRange}
                  disabled={loading || !rangeStart || !rangeEnd}
                  className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium transition cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Aplicar
                </button>
                <button
                  type="button"
                  onClick={handleResetToCurrentMonth}
                  disabled={loading}
                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-medium transition cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Mês atual
                </button>
              </div>

              {/* overflow-hidden é a trava: mesmo que uma barra não consiga encolher o suficiente (intervalo
                  com muitos dias), o excesso fica cortado aqui dentro — nunca vaza por cima do card vizinho. */}
              <div className={`h-56 w-full flex items-end justify-between overflow-hidden ${report.dailyTrend.length > 12 ? 'gap-1' : 'gap-3'} pt-6 pb-2 px-2 border-b border-slate-100`}>
                {report.dailyTrend.map((item, idx) => {
                  const totalDay = item.computeUsd + item.cloudRunUsd + item.bigqueryUsd;
                  const heightPercent = Math.min(100, (totalDay / maxDailyTotal) * 100);
                  const computeHeight = totalDay > 0 ? (item.computeUsd / totalDay) * 100 : 0;
                  const runHeight = totalDay > 0 ? (item.cloudRunUsd / totalDay) * 100 : 0;
                  const bqHeight = totalDay > 0 ? (item.bigqueryUsd / totalDay) * 100 : 0;

                  return (
                    // min-w-0: sem isto, o texto da data ("01/09") vira a largura mínima do item flex e,
                    // com muitos dias, a soma das larguras mínimas passa do espaço disponível — as últimas
                    // barras eram empurradas pra fora do card em vez de encolher (vazando sobre o card vizinho).
                    <div key={idx} className="flex-1 min-w-0 flex flex-col items-center gap-2 group h-full justify-end">
                      <div className="w-full text-center truncate text-[10px] text-slate-500 font-mono opacity-0 group-hover:opacity-100 transition font-medium">
                        R${totalDay.toFixed(2)}
                      </div>
                      <div
                        className="w-full max-w-[42px] rounded-t overflow-hidden flex flex-col-reverse transition-all duration-300 group-hover:brightness-105 group-hover:scale-105 shadow-sm"
                        style={{ height: `${heightPercent}%` }}
                      >
                        <div style={{ height: `${computeHeight}%` }} className="bg-amber-500 w-full" title={`Compute Engine: R$${item.computeUsd.toFixed(2)}`} />
                        <div style={{ height: `${runHeight}%` }} className="bg-blue-500 w-full" title={`Cloud Run: R$${item.cloudRunUsd.toFixed(2)}`} />
                        <div style={{ height: `${bqHeight}%` }} className="bg-cyan-500 w-full" title={`BigQuery: R$${item.bigqueryUsd.toFixed(2)}`} />
                      </div>
                      <span className="w-full text-center truncate text-[11px] text-slate-500 font-mono group-hover:text-slate-900 group-hover:font-semibold transition">
                        {formatDay(item.date, spansMultipleMonths)}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between text-xs text-slate-500 pt-1 font-medium">
                <span>Compute Engine ainda domina o custo — pouca variação dia a dia</span>
                {topRecommendation && (
                  <span className="text-amber-600 font-semibold flex items-center gap-1">
                    <TrendingDown className="w-3.5 h-3.5" /> Ver recomendação de redimensionamento abaixo
                  </span>
                )}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Mês Atual, Agrupado por Produto</h3>
                <p className="text-xs text-slate-500">Mesmo agrupamento do relatório do Console de Billing — custo mensal estimado por produto GCP</p>
              </div>

              <div className="space-y-3.5">
                {productGroups.map((group) => {
                  const pct = report.totalMonthlyCostUsd > 0 ? Math.round((group.monthlyCostUsd / report.totalMonthlyCostUsd) * 1000) / 10 : 0;
                  return (
                    <div key={group.category} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-700 font-medium truncate pr-2">{CATEGORY_LABEL[group.category]}</span>
                        <span className="font-mono text-slate-600 font-semibold shrink-0">
                          R${group.monthlyCostUsd.toFixed(2)} ({pct}%)
                        </span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${Math.max(pct, group.monthlyCostUsd > 0 ? 1 : 0)}%`, backgroundColor: CATEGORY_COLOR[group.category] }}
                        />
                      </div>
                      <p className="text-[10px] text-slate-400 leading-snug">
                        {group.items.length > 1 ? `${group.items.length} recursos: ` : ''}
                        {group.items.map(r => r.label.replace(`${CATEGORY_LABEL[group.category]} — `, '')).join(', ')}
                      </p>
                    </div>
                  );
                })}
              </div>

              <div className="pt-3 border-t border-slate-100 space-y-1.5">
                {report.notes.map((note, i) => (
                  <div key={i} className="text-[11px] text-slate-500 leading-relaxed flex items-start gap-1.5">
                    <HelpCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{note}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Recommendations */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-600" />
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Otimizações Recomendadas de Recursos & Custos</h3>
                  <p className="text-xs text-slate-500">Geradas a partir de uso real medido (CPU, storage) — não são cenários fictícios</p>
                </div>
              </div>
              <span className="text-xs text-emerald-700 font-semibold bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full">
                Economia Total Possível: R${totalPotentialSavings.toFixed(2)}/mês
              </span>
            </div>

            {recommendations.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">Nenhuma sub-utilização relevante detectada nos recursos monitorados agora.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {recommendations.map((rec: CostRecommendation) => {
                  const applied = appliedIds.has(rec.id);
                  return (
                    <div
                      key={rec.id}
                      className={`p-4 rounded-xl border flex flex-col justify-between space-y-3 transition shadow-sm ${
                        applied ? 'bg-emerald-50/40 border-emerald-200' : 'bg-slate-50 border-slate-200 hover:border-slate-300 hover:bg-white'
                      }`}
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 font-semibold">
                            {rec.effort === 'baixo' ? 'Esforço Baixo' : rec.effort === 'medio' ? 'Esforço Médio' : 'Esforço Alto'}
                          </span>
                          <span className="text-xs font-bold font-mono text-emerald-600">
                            +R${rec.potentialSavingsUsd.toFixed(2)}/mês
                          </span>
                        </div>

                        <h4 className="text-xs font-semibold text-slate-900">{rec.title}</h4>
                        <p className="text-[11px] text-slate-600 leading-normal">{rec.description}</p>
                      </div>

                      <div className="pt-3 border-t border-slate-200/60 space-y-2">
                        {rec.suggestedCommand && !applied && <CopyCommandButton command={rec.suggestedCommand} />}
                        <div className="flex items-center justify-end">
                          {applied ? (
                            <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                              <CheckCircle className="w-4 h-4" /> Marcado como aplicado
                            </span>
                          ) : (
                            <button
                              onClick={() => handleApply(rec.id)}
                              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold transition cursor-pointer shadow-sm"
                            >
                              Marcar como Aplicado
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

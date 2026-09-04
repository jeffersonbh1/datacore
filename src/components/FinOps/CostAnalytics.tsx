import React, { useState } from 'react';
import { 
  DollarSign, TrendingDown, TrendingUp, Sparkles, Server, Zap, 
  CheckCircle, ArrowUpRight, ArrowDownRight, Layers, HelpCircle, 
  PieChart, BarChart3, AlertCircle
} from 'lucide-react';
import { FinOpsMetric } from '../../types';

interface CostAnalyticsProps {
  finops: FinOpsMetric;
  onApplyRecommendation: (recId: string) => void;
  canViewFinOps: boolean;
}

export const CostAnalytics: React.FC<CostAnalyticsProps> = ({
  finops,
  onApplyRecommendation,
  canViewFinOps
}) => {
  const [recommendations, setRecommendations] = useState(finops.recommendations);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const totalPotentialSavings = recommendations
    .filter(r => !r.applied)
    .reduce((sum, r) => sum + r.potentialSavingsUsd, 0);

  const appliedSavings = recommendations
    .filter(r => r.applied)
    .reduce((sum, r) => sum + r.potentialSavingsUsd, 0);

  const handleApply = (id: string) => {
    setRecommendations(prev =>
      prev.map(r => r.id === id ? { ...r, applied: true } : r)
    );
    onApplyRecommendation(id);
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

  return (
    <div id="finops-view-container" className="space-y-6">
      {/* Top Banner KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1 font-medium">
            <span>Custo Total de Computação (Mês)</span>
            <DollarSign className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold text-slate-900 flex items-baseline gap-1 font-mono">
            ${(finops.totalMonthlyCostUsd - appliedSavings).toFixed(2)}
            <span className="text-xs text-slate-400 font-normal">USD</span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-emerald-600 mt-1 font-medium">
            <ArrowDownRight className="w-3.5 h-3.5" />
            <span>-8.5% após otimizações de partição</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1 font-medium">
            <span>Custo por 1 Milhão de Registros</span>
            <Zap className="w-4 h-4 text-sky-600" />
          </div>
          <div className="text-2xl font-bold text-sky-600 flex items-baseline gap-1 font-mono">
            ${finops.costPerMillionRecords.toFixed(2)}
            <span className="text-xs text-slate-400 font-normal">/ 1M</span>
          </div>
          <span className="text-[11px] text-slate-500">Excelente eficiência (Benchmark: $0.25)</span>
        </div>

        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1 font-medium">
            <span>Recursos Ociosos / Desperdício</span>
            <AlertCircle className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-bold text-amber-600 flex items-baseline gap-1 font-mono">
            ${finops.idleResourcesCost.toFixed(2)}
            <span className="text-xs text-slate-400 font-normal">/mês</span>
          </div>
          <span className="text-[11px] text-amber-600 font-medium">Podem ser eliminados via automação</span>
        </div>

        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1 font-medium">
            <span>Economia Potencial Restante</span>
            <Sparkles className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="text-2xl font-bold text-indigo-600 flex items-baseline gap-1 font-mono">
            ${totalPotentialSavings.toFixed(2)}
            <span className="text-xs text-slate-400 font-normal">/mês</span>
          </div>
          <span className="text-[11px] text-indigo-600 font-medium">Baseado em {recommendations.filter(r => !r.applied).length} recomendações ativas</span>
        </div>
      </div>

      {/* Charts Row: Provider Breakdown + Daily Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Daily Trend SVG Chart (2 cols) */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Evolução do Gasto Diário de Computação (FinOps)</h3>
              <p className="text-xs text-slate-500">Consumo consolidado dos últimos 7 dias em USD</p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5 text-slate-600">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> AWS
              </span>
              <span className="flex items-center gap-1.5 text-slate-600">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> GCP
              </span>
              <span className="flex items-center gap-1.5 text-slate-600">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-500" /> Snowflake
              </span>
              <span className="flex items-center gap-1.5 text-slate-600">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" /> Azure
              </span>
            </div>
          </div>

          {/* SVG Multi-bar / Stacked Bar Chart */}
          <div className="h-56 w-full flex items-end justify-between gap-3 pt-6 pb-2 px-2 border-b border-slate-100">
            {finops.dailySpendTrend.map((item, idx) => {
              const totalDay = item.aws + item.gcp + item.snowflake + item.azure;
              const heightPercent = Math.min(100, (totalDay / 65) * 100);

              const awsHeight = (item.aws / totalDay) * 100;
              const gcpHeight = (item.gcp / totalDay) * 100;
              const snowHeight = (item.snowflake / totalDay) * 100;
              const azureHeight = (item.azure / totalDay) * 100;

              return (
                <div 
                  key={idx} 
                  onClick={() => setSelectedDay(idx)}
                  className="flex-1 flex flex-col items-center gap-2 group cursor-pointer h-full justify-end"
                >
                  <div className="text-[10px] text-slate-500 font-mono opacity-0 group-hover:opacity-100 transition font-medium">
                    ${totalDay.toFixed(1)}
                  </div>
                  <div 
                    className="w-full max-w-[42px] rounded-t overflow-hidden flex flex-col-reverse transition-all duration-300 group-hover:brightness-105 group-hover:scale-105 shadow-sm"
                    style={{ height: `${heightPercent}%` }}
                  >
                    <div style={{ height: `${awsHeight}%` }} className="bg-amber-500 w-full" title={`AWS: $${item.aws}`} />
                    <div style={{ height: `${gcpHeight}%` }} className="bg-blue-500 w-full" title={`GCP: $${item.gcp}`} />
                    <div style={{ height: `${snowHeight}%` }} className="bg-cyan-500 w-full" title={`Snowflake: $${item.snowflake}`} />
                    <div style={{ height: `${azureHeight}%` }} className="bg-indigo-500 w-full" title={`Azure: $${item.azure}`} />
                  </div>
                  <span className="text-[11px] text-slate-500 font-mono group-hover:text-slate-900 group-hover:font-semibold transition">
                    {item.day}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500 pt-1 font-medium">
            <span>Média móvel diária: ~$53.20 USD</span>
            <span className="text-emerald-600 font-semibold">Picos de carga noturna absorvidos sem sobrecusto</span>
          </div>
        </div>

        {/* Provider Breakdown Pie / Progress Bars (1 col) */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Distribuição por Provedor Cloud</h3>
            <p className="text-xs text-slate-500">Divisão percentual dos custos mensais</p>
          </div>

          <div className="space-y-3.5">
            {finops.providerBreakdown.map((prov) => (
              <div key={prov.provider} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-700 font-medium">{prov.provider}</span>
                  <span className="font-mono text-slate-600 font-semibold">
                    ${prov.cost.toFixed(2)} ({prov.percentage}%)
                  </span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                  <div 
                    className="h-full rounded-full transition-all duration-500" 
                    style={{ width: `${prov.percentage}%`, backgroundColor: prov.color }} 
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="pt-3 border-t border-slate-100 text-[11px] text-slate-500 leading-relaxed">
            Nenhum lock-in de fornecedor: O DataCore permite direcionar cargas de trabalho entre AWS, GCP e Snowflake conforme a variação de preços.
          </div>
        </div>
      </div>

      {/* Smart Resource Optimization Recommendations (FinOps) */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-600" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Otimizações Recomendadas de Recursos & Custos</h3>
              <p className="text-xs text-slate-500">Ajustes inteligentes sugeridos pelo motor de análise estática e histórico de execução</p>
            </div>
          </div>
          <span className="text-xs text-emerald-700 font-semibold bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full">
            Economia Total Possível: ${totalPotentialSavings.toFixed(2)}/mês
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {recommendations.map((rec) => (
            <div 
              key={rec.id}
              className={`p-4 rounded-xl border flex flex-col justify-between space-y-3 transition shadow-sm ${
                rec.applied 
                  ? 'bg-emerald-50/40 border-emerald-200' 
                  : 'bg-slate-50 border-slate-200 hover:border-slate-300 hover:bg-white'
              }`}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 font-semibold">
                    {rec.type === 'spot_instance' ? 'Instâncias Spot' :
                     rec.type === 'partition_prune' ? 'Particionamento' : 'Auto-Suspend'}
                  </span>
                  <span className="text-xs font-bold font-mono text-emerald-600">
                    +${rec.potentialSavingsUsd}/mês
                  </span>
                </div>

                <h4 className="text-xs font-semibold text-slate-900">{rec.pipelineName}</h4>
                <p className="text-[11px] text-slate-600 leading-normal">{rec.description}</p>
              </div>

              <div className="pt-3 border-t border-slate-200/60 flex items-center justify-between">
                <span className="text-[10px] text-slate-500">Esforço: <strong className="text-slate-700 uppercase">{rec.effort}</strong></span>
                {rec.applied ? (
                  <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                    <CheckCircle className="w-4 h-4" /> Aplicado
                  </span>
                ) : (
                  <button
                    onClick={() => handleApply(rec.id)}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold transition cursor-pointer shadow-sm"
                  >
                    Aplicar Otimização
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import {
  Search, Filter, Play, Pause, ExternalLink, ShieldCheck,
  Layers, Clock, DollarSign, Database, CheckCircle, AlertTriangle,
  Sparkles, Boxes, Radio, Server, X, Wand2, Trash2, AlertCircle
} from 'lucide-react';
import { Pipeline, CloudProvider } from '../../types';

interface PipelinesOverviewProps {
  pipelines: Pipeline[];
  onSelectPipeline: (pipeline: Pipeline) => void;
  onToggleStatus: (pipelineId: string) => void;
  onTriggerRun: (pipelineId: string) => void;
  onDeletePipeline?: (pipeline: Pipeline) => void;
  onCreatePipeline?: (newPipeline: Pipeline) => void;
  onNavigateToAutoPipeline?: () => void;
  canCreate: boolean;
  canEdit: boolean;
  canTrigger: boolean;
}

export const PipelinesOverview: React.FC<PipelinesOverviewProps> = ({
  pipelines,
  onSelectPipeline,
  onToggleStatus,
  onTriggerRun,
  onDeletePipeline,
  onCreatePipeline,
  onNavigateToAutoPipeline,
  canCreate,
  canEdit,
  canTrigger
}) => {
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState<string>('all');
  const [modeFilter, setModeFilter] = useState<string>('all');
  const [deleteTarget, setDeleteTarget] = useState<Pipeline | null>(null);

  const filteredPipelines = pipelines.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
                        p.description.toLowerCase().includes(search.toLowerCase()) ||
                        p.category.toLowerCase().includes(search.toLowerCase());
    const matchProvider = providerFilter === 'all' || p.cloudProviders.includes(providerFilter as CloudProvider);
    const matchMode = modeFilter === 'all' || p.mode === modeFilter;
    return matchSearch && matchProvider && matchMode;
  });

  const totalRecordsToday = pipelines.reduce((sum, p) => sum + p.recordsProcessedToday, 0);
  const totalCost = pipelines.reduce((sum, p) => sum + p.monthlyCostUsd, 0);
  const avgSla = pipelines.length
    ? (pipelines.reduce((sum, p) => sum + p.actualSla, 0) / pipelines.length).toFixed(2)
    : '0.00';
  const activeCount = pipelines.filter(p => p.status === 'active').length;

  const getProviderBadge = (provider: CloudProvider) => {
    switch (provider) {
      case 'gcp': return <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded font-mono font-medium">GCP</span>;
      case 'aws': return <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded font-mono font-medium">AWS</span>;
      case 'azure': return <span className="text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded font-mono font-medium">Azure</span>;
      case 'snowflake': return <span className="text-[10px] bg-cyan-50 text-cyan-700 border border-cyan-200 px-2 py-0.5 rounded font-mono font-medium">Snowflake</span>;
      default: return <span className="text-[10px] bg-slate-100 text-slate-700 border border-slate-200 px-2 py-0.5 rounded font-mono">Cloud</span>;
    }
  };

  return (
    <div id="pipelines-overview-container" className="space-y-6">
      {/* Top Banner KPI Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1.5 font-medium">
            <span>Pipelines Operando</span>
            <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-900 flex items-baseline gap-2">
            {activeCount} <span className="text-xs text-slate-500 font-normal">de {pipelines.length} ativos</span>
          </div>
          <span className="text-[11px] text-emerald-600 font-medium flex items-center gap-1 mt-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            100% dos nós com TLS 1.3
          </span>
        </div>

        <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1.5 font-medium">
            <span>Volume Processado (Hoje)</span>
            <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
              <Database className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-900 flex items-baseline gap-1">
            {(totalRecordsToday / 1000000).toFixed(2)}M
            <span className="text-xs text-slate-500 font-normal">registros</span>
          </div>
          <span className="text-[11px] text-slate-500 block mt-1">Streaming & Batch combinados</span>
        </div>

        <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1.5 font-medium">
            <span>Disponibilidade & SLA</span>
            <div className="p-1.5 rounded-lg bg-sky-50 text-sky-600">
              <CheckCircle className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-900 flex items-baseline gap-1">
            {avgSla}%
            <span className="text-xs text-slate-500 font-normal">uptime</span>
          </div>
          <span className="text-[11px] text-slate-500 block mt-1">Meta acordada: 99.90%</span>
        </div>

        <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1.5 font-medium">
            <span>Custo Total de Compute</span>
            <div className="p-1.5 rounded-lg bg-amber-50 text-amber-600">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-900 flex items-baseline gap-1">
            ${totalCost.toFixed(2)}
            <span className="text-xs text-slate-500 font-normal">/mês</span>
          </div>
          <span className="text-[11px] text-emerald-600 font-medium block mt-1">Otimização FinOps ativa</span>
        </div>
      </div>

      {/* Action and Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white border border-slate-200 p-3.5 rounded-xl shadow-sm">
        <div className="flex items-center gap-2 flex-1 max-w-md bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 focus-within:bg-white focus-within:border-indigo-500 transition-colors">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            type="text"
            placeholder="Buscar por nome de pipeline, categoria ou tags..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-transparent focus:outline-none text-slate-800 placeholder-slate-400"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-slate-400 hover:text-slate-600">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Provider Filter */}
          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 hover:border-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer shadow-sm"
          >
            <option value="all">Todas as Nuvens</option>
            <option value="gcp">Google Cloud (GCP)</option>
            <option value="aws">Amazon Web Services (AWS)</option>
            <option value="snowflake">Snowflake</option>
            <option value="azure">Microsoft Azure</option>
          </select>

          {/* Mode Filter */}
          <select
            value={modeFilter}
            onChange={(e) => setModeFilter(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 hover:border-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer shadow-sm"
          >
            <option value="all">Todos os Modos</option>
            <option value="streaming">Streaming em Tempo Real</option>
            <option value="batch">Batch Agendado</option>
          </select>

          {/* Automatic Pipeline Button */}
          {canCreate && onNavigateToAutoPipeline && (
            <button
              id="btn-auto-pipeline-overview"
              onClick={onNavigateToAutoPipeline}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-sm transition cursor-pointer"
            >
              <Wand2 className="w-4 h-4" />
              Novo Pipeline Automático
            </button>
          )}
        </div>
      </div>

      {/* Pipelines List Cards */}
      <div className="space-y-4">
        {filteredPipelines.map((pipeline) => {
          const isActive = pipeline.status === 'active';

          return (
            <div
              key={pipeline.id}
              id={`pipeline-card-${pipeline.id}`}
              className="bg-white border border-slate-200 hover:border-slate-300 hover:shadow-md rounded-xl p-5 shadow-sm transition-all flex flex-col lg:flex-row lg:items-center justify-between gap-5"
            >
              {/* Left Details */}
              <div className="flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${isActive ? 'bg-emerald-500 ring-4 ring-emerald-50' : 'bg-slate-400'}`} />
                  <h3 className="text-base font-semibold text-slate-900 hover:text-indigo-600 cursor-pointer transition"
                      onClick={() => onSelectPipeline(pipeline)}>
                    {pipeline.name}
                  </h3>
                  <span className="text-xs px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 font-mono font-medium border border-slate-200">
                    {pipeline.version}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-medium">
                    {pipeline.category}
                  </span>
                  {pipeline.containsPII && (
                    <span className="text-xs px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1 font-medium">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      LGPD Ativo
                    </span>
                  )}
                </div>

                <p className="text-xs text-slate-500 max-w-3xl leading-relaxed">
                  {pipeline.description}
                </p>

                {/* Tags & Metadata */}
                <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-slate-500">
                  <div className="flex items-center gap-1">
                    <span>Provedores:</span>
                    <div className="flex items-center gap-1">
                      {pipeline.cloudProviders.map(p => (
                        <span key={p}>{getProviderBadge(p)}</span>
                      ))}
                    </div>
                  </div>
                  <span>•</span>
                  <span>Modo: <strong className="text-slate-700 font-medium">{pipeline.mode === 'streaming' ? 'Streaming' : 'Batch'}</strong></span>
                  <span>•</span>
                  <span>Base Legal: <strong className="text-slate-700 font-medium">{pipeline.legalBasis}</strong></span>
                  <span>•</span>
                  <span>Dono: <span className="text-slate-600">{pipeline.owner}</span></span>
                </div>
              </div>

              {/* Middle Metrics */}
              <div className="flex items-center gap-6 border-y lg:border-y-0 lg:border-x border-slate-100 py-3 lg:py-0 lg:px-6 shrink-0 text-center">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-medium">Processados</span>
                  <span className="text-sm font-semibold font-mono text-emerald-600">
                    {(pipeline.recordsProcessedToday / 1000).toLocaleString()}k
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-medium">Latência</span>
                  <span className="text-sm font-semibold font-mono text-sky-600">
                    {pipeline.avgLatencyMs}ms
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-medium">SLA Real</span>
                  <span className="text-sm font-semibold font-mono text-emerald-600">
                    {pipeline.actualSla}%
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-medium">Custo Mensal</span>
                  <span className="text-sm font-semibold font-mono text-amber-600">
                    ${pipeline.monthlyCostUsd.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Right Controls */}
              <div className="flex items-center gap-2 shrink-0 justify-end">
                {canTrigger && (
                  <button
                    onClick={() => onTriggerRun(pipeline.id)}
                    title="Executar job agora"
                    className="p-2 bg-slate-100 hover:bg-slate-200 text-emerald-600 rounded-lg text-xs font-semibold transition cursor-pointer border border-slate-200 shadow-sm"
                  >
                    <Play className="w-4 h-4 fill-current" />
                  </button>
                )}

                {canEdit && (
                  <button
                    onClick={() => onToggleStatus(pipeline.id)}
                    title={isActive ? 'Pausar pipeline' : 'Retomar pipeline'}
                    className={`p-2 rounded-lg text-xs font-semibold transition cursor-pointer border border-slate-200 shadow-sm ${
                      isActive ? 'bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                    }`}
                  >
                    {isActive ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4" />}
                  </button>
                )}

                <button
                  id={`btn-open-studio-${pipeline.id}`}
                  onClick={() => onSelectPipeline(pipeline)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-sm transition cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Abrir no Studio
                </button>

                {canEdit && onDeletePipeline && (
                  <button
                    id={`btn-delete-pipeline-${pipeline.id}`}
                    onClick={() => setDeleteTarget(pipeline)}
                    title="Excluir integração (remove do banco de dados)"
                    className="p-2 bg-slate-100 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg transition cursor-pointer border border-slate-200 hover:border-rose-200 shadow-sm"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {filteredPipelines.length === 0 && pipelines.length === 0 && (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-500 space-y-3 shadow-sm">
            <Database className="w-10 h-10 text-slate-300 mx-auto" />
            <h4 className="text-base font-semibold text-slate-800">Nenhum pipeline criado ainda</h4>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Crie sua primeira integração no Pipeline Automático para vê-la listada aqui.
            </p>
            {canCreate && onNavigateToAutoPipeline && (
              <button
                onClick={onNavigateToAutoPipeline}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-sm transition cursor-pointer"
              >
                <Wand2 className="w-4 h-4" />
                Novo Pipeline Automático
              </button>
            )}
          </div>
        )}

        {filteredPipelines.length === 0 && pipelines.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-500 space-y-3 shadow-sm">
            <Database className="w-10 h-10 text-slate-300 mx-auto" />
            <h4 className="text-base font-semibold text-slate-800">Nenhum pipeline encontrado</h4>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Nenhum fluxo de dados corresponde aos filtros aplicados. Tente ajustar os parâmetros de busca.
            </p>
          </div>
        )}
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Excluir integração?</h3>
                <p className="text-xs text-slate-500">Esta ação não pode ser desfeita.</p>
              </div>
            </div>
            <p className="text-sm text-slate-600">
              <strong className="text-slate-800">"{deleteTarget.name}"</strong> será removida do banco de dados
              (a integração, o pipeline e o histórico de execuções). A conexão no Airbyte e os modelos dbt gerados
              <strong> não</strong> são apagados.
            </p>
            <div className="flex items-start gap-2 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
              <AlertCircle className="w-4 h-4 shrink-0 text-slate-400 mt-0.5" />
              <span>Para parar as sincronizações, pause/exclua também a conexão no Airbyte.</span>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                id="btn-confirm-delete-pipeline"
                onClick={() => { onDeletePipeline?.(deleteTarget); setDeleteTarget(null); }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-sm transition cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Excluir integração
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

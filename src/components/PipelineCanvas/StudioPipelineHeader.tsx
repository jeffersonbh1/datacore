import React, { useState, useRef, useEffect } from 'react';
import { 
  ChevronDown, Search, Plus, Check, Layers, Radio, 
  Clock, ShieldCheck, Database, Play, Pause, Boxes, Sparkles, Filter, X, Wand2
} from 'lucide-react';
import { Pipeline, CloudProvider } from '../../types';

interface StudioPipelineHeaderProps {
  pipelines: Pipeline[];
  selectedPipelineId: string;
  onSelectPipeline: (pipelineId: string) => void;
  onNavigateToAutoPipeline?: () => void;
  canCreate: boolean;
  onToggleStatus?: (pipelineId: string) => void;
}

export const StudioPipelineHeader: React.FC<StudioPipelineHeaderProps> = ({
  pipelines,
  selectedPipelineId,
  onSelectPipeline,
  onNavigateToAutoPipeline,
  canCreate,
  onToggleStatus
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'active' | 'paused'>('all');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentPipeline = pipelines.find(p => p.id === selectedPipelineId) || pipelines[0];

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredPipelines = pipelines.filter(p => {
    const matchesSearch = 
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.cloudProviders.some(cp => cp.toLowerCase().includes(searchQuery.toLowerCase()));
    
    if (filterMode === 'active') return matchesSearch && p.status === 'active';
    if (filterMode === 'paused') return matchesSearch && p.status === 'paused';
    return matchesSearch;
  });

  const activeCount = pipelines.filter(p => p.status === 'active').length;
  const pausedCount = pipelines.filter(p => p.status === 'paused').length;

  const getProviderBadge = (provider: CloudProvider) => {
    switch (provider) {
      case 'gcp': return <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-mono font-semibold">GCP</span>;
      case 'aws': return <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-mono font-semibold">AWS</span>;
      case 'snowflake': return <span className="px-1.5 py-0.5 rounded bg-cyan-50 text-cyan-700 border border-cyan-200 text-[10px] font-mono font-semibold">SNOWFLAKE</span>;
      case 'azure': return <span className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200 text-[10px] font-mono font-semibold">AZURE</span>;
      default: return <span className="px-1.5 py-0.5 rounded bg-slate-50 text-slate-700 border border-slate-200 text-[10px] font-mono font-semibold">CLOUD</span>;
    }
  };

  return (
    <div id="studio-pipeline-header" className="bg-white border border-slate-200 p-2.5 sm:p-3 rounded-xl shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-3 relative z-30">
      {/* Left: Combobox Pipeline Selector */}
      <div className="flex items-center gap-2.5 flex-1 min-w-0" ref={dropdownRef}>
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 shrink-0">
          <Layers className="w-4 h-4 text-indigo-600" />
          <span className="hidden sm:inline">Pipeline:</span>
        </div>

        {/* Combobox Trigger Button */}
        <div className="relative flex-1 min-w-0 max-w-md">
          <button
            id="combobox-pipeline-trigger"
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="w-full flex items-center justify-between gap-2.5 px-3 py-2 bg-slate-50 hover:bg-slate-100/90 border border-slate-300 rounded-lg text-xs transition cursor-pointer text-left shadow-2xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 min-w-0"
            aria-expanded={isOpen}
            aria-haspopup="listbox"
          >
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                {currentPipeline?.status === 'active' ? (
                  <>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                  </>
                ) : (
                  <span className="inline-flex rounded-full h-2.5 w-2.5 bg-slate-400"></span>
                )}
              </span>

              <div className="flex flex-col min-w-0 flex-1">
                <div className="font-bold text-slate-900 truncate text-xs">
                  {currentPipeline?.name || 'Selecione um Pipeline'}
                </div>
                <span className="text-[11px] text-slate-500 truncate">
                  {currentPipeline?.category} • {currentPipeline?.nodes.length || 0} nós no canvas • {currentPipeline?.mode === 'streaming' ? 'Streaming' : 'Batch'}
                </span>
              </div>
            </div>

            <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180 text-indigo-600' : ''}`} />
          </button>

          {/* Combobox Dropdown Popover */}
          {isOpen && (
            <div 
              id="combobox-pipeline-dropdown"
              className="absolute left-0 w-full min-w-[300px] max-w-lg top-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150"
            >
              {/* Search Bar inside Combobox */}
              <div className="p-2.5 border-b border-slate-100 bg-slate-50/70">
                <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs">
                  <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <input
                    type="text"
                    placeholder="Buscar por nome, categoria ou cloud..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-transparent focus:outline-none text-slate-800 placeholder-slate-400 text-xs"
                    autoFocus
                  />
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery('')}
                      className="text-slate-400 hover:text-slate-600 p-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Filter Pills */}
                <div className="flex items-center gap-1.5 mt-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setFilterMode('all')}
                    className={`px-2 py-0.5 rounded-md font-medium transition cursor-pointer ${
                      filterMode === 'all' 
                        ? 'bg-indigo-50 text-indigo-700 font-semibold' 
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Todos ({pipelines.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterMode('active')}
                    className={`px-2 py-0.5 rounded-md font-medium transition cursor-pointer ${
                      filterMode === 'active' 
                        ? 'bg-emerald-50 text-emerald-700 font-semibold' 
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Ativos ({activeCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterMode('paused')}
                    className={`px-2 py-0.5 rounded-md font-medium transition cursor-pointer ${
                      filterMode === 'paused' 
                        ? 'bg-slate-200 text-slate-800 font-semibold' 
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Pausados ({pausedCount})
                  </button>
                </div>
              </div>

              {/* Pipelines List */}
              <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 p-1">
                {filteredPipelines.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-400">
                    Nenhum pipeline encontrado com "{searchQuery}"
                  </div>
                ) : (
                  filteredPipelines.map((p) => {
                    const isSelected = p.id === selectedPipelineId;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          onSelectPipeline(p.id);
                          setIsOpen(false);
                          setSearchQuery('');
                        }}
                        className={`w-full text-left p-2.5 rounded-lg flex items-center justify-between gap-3 transition cursor-pointer ${
                          isSelected 
                            ? 'bg-indigo-50/80 hover:bg-indigo-50' 
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-start gap-2.5 min-w-0 flex-1">
                          <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                            p.status === 'active' ? 'bg-emerald-500' : 'bg-slate-400'
                          }`} />

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className={`text-xs font-semibold truncate ${
                                isSelected ? 'text-indigo-900 font-bold' : 'text-slate-900'
                              }`}>
                                {p.name}
                              </span>
                            </div>

                            <p className="text-[11px] text-slate-500 truncate mt-0.5">
                              {p.description}
                            </p>

                            <div className="flex items-center gap-1.5 mt-1.5">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                p.status === 'active' 
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                                  : 'bg-slate-100 text-slate-600 border border-slate-200'
                              }`}>
                                {p.status === 'active' ? 'Ativo' : 'Pausado'}
                              </span>

                              <span className="text-[10px] text-slate-500 flex items-center gap-1">
                                {p.mode === 'streaming' ? <Radio className="w-2.5 h-2.5 text-blue-500" /> : <Clock className="w-2.5 h-2.5 text-amber-500" />}
                                {p.mode === 'streaming' ? 'Streaming' : 'Batch'}
                              </span>

                              {p.containsPII && (
                                <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 font-medium flex items-center gap-0.5">
                                  <ShieldCheck className="w-2.5 h-2.5" /> LGPD
                                </span>
                              )}

                              <div className="flex items-center gap-1 ml-auto">
                                {p.cloudProviders.map(cp => (
                                  <span key={cp}>{getProviderBadge(cp)}</span>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>

                        {isSelected && (
                          <div className="shrink-0 p-1 bg-indigo-100 text-indigo-700 rounded-full">
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                          </div>
                        )}
                      </button>
                    );
                  })
                )}
              </div>

              {/* Footer action inside combobox */}
              {canCreate && onNavigateToAutoPipeline && (
                <div className="p-2 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
                  <span className="text-[11px] text-slate-500">
                    {pipelines.length} pipelines configurados
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setIsOpen(false);
                      onNavigateToAutoPipeline();
                    }}
                    className="text-xs text-indigo-700 hover:text-indigo-800 font-semibold flex items-center gap-1 px-2.5 py-1 rounded-md hover:bg-indigo-50 transition cursor-pointer"
                  >
                    <Wand2 className="w-3.5 h-3.5" />
                    Novo Pipeline Automático
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right Actions: Status Toggle + Primary Pipeline Automático Button */}
      <div className="flex items-center gap-2 sm:gap-2.5 shrink-0 ml-auto">
        {currentPipeline && onToggleStatus && (
          <button
            id="btn-toggle-pipeline-status"
            type="button"
            onClick={() => onToggleStatus(currentPipeline.id)}
            className={`px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-2xs border shrink-0 whitespace-nowrap ${
              currentPipeline.status === 'active'
                ? 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
                : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-300'
            }`}
            title={currentPipeline.status === 'active' ? 'Pausar Pipeline' : 'Ativar Pipeline'}
          >
            {currentPipeline.status === 'active' ? (
              <>
                <Pause className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>Pausar</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 text-emerald-600 fill-current shrink-0" />
                <span>Ativar</span>
              </>
            )}
          </button>
        )}

        {/* Primary Pipeline Automático Button */}
        {onNavigateToAutoPipeline && (
          <button
            id="btn-auto-pipeline-header"
            type="button"
            onClick={onNavigateToAutoPipeline}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold transition cursor-pointer shadow-sm shadow-indigo-100 shrink-0 whitespace-nowrap"
            title="Assistente de Cadastro de Pipeline Automático"
          >
            <Wand2 className="w-4 h-4 text-white shrink-0" />
            <span>Pipeline Automático</span>
          </button>
        )}
      </div>
    </div>
  );
};

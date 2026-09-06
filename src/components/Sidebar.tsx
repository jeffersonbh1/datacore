import React, { useState } from 'react';
import { 
  Network, Layers, ShieldCheck, DollarSign, 
  Lock, ChevronRight, ChevronLeft, HelpCircle, Terminal, Wand2, UserPlus
} from 'lucide-react';

export type ActiveTab = 'studio' | 'auto-pipeline' | 'pipelines' | 'governance' | 'finops' | 'rbac' | 'cadastro-usuario';

interface SidebarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  openIncidentsCount?: number;
  pendingDsrCount: number;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  pendingDsrCount,
  isCollapsed: externalIsCollapsed,
  onToggleCollapse: externalOnToggleCollapse
}) => {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const isCollapsed = externalIsCollapsed !== undefined ? externalIsCollapsed : internalCollapsed;
  const toggleCollapse = externalOnToggleCollapse || (() => setInternalCollapsed(prev => !prev));

  const navItems: { id: ActiveTab; label: string; icon: React.ReactNode; badge?: number; badgeColor?: string }[] = [
    {
      id: 'pipelines',
      label: 'Pipelines & Fluxos',
      icon: <Layers className="w-4 h-4 shrink-0" />
    },
    {
      id: 'studio',
      label: 'Studio Visual ETL',
      icon: <Network className="w-4 h-4 shrink-0" />
    },
    {
      id: 'auto-pipeline',
      label: 'Pipeline Automático',
      icon: <Wand2 className="w-4 h-4 text-indigo-600 shrink-0" />
    },
    {
      id: 'governance',
      label: 'Governança & LGPD',
      icon: <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />,
      badge: pendingDsrCount > 0 ? pendingDsrCount : undefined,
      badgeColor: 'bg-emerald-50 text-emerald-700 border border-emerald-200'
    },
    {
      id: 'finops',
      label: 'Custos & FinOps',
      icon: <DollarSign className="w-4 h-4 text-amber-600 shrink-0" />
    },
    {
      id: 'rbac',
      label: 'Segurança & RBAC',
      icon: <Lock className="w-4 h-4 text-indigo-600 shrink-0" />
    },
    {
      id: 'cadastro-usuario',
      label: 'Cadastrar Usuário',
      icon: <UserPlus className="w-4 h-4 text-indigo-600 shrink-0" />
    }
  ];

  return (
    <aside 
      id="app-sidebar" 
      className={`${
        isCollapsed ? 'w-16 p-2' : 'w-60 p-4'
      } bg-white border-r border-slate-200 flex flex-col justify-between shrink-0 transition-all duration-200 hidden md:flex h-full overflow-y-auto min-h-0`}
    >
      {/* Navigation list */}
      <div className="space-y-1">
        <div className="flex items-center justify-between px-2 mb-2">
          {!isCollapsed && (
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate">
              Core Platform
            </p>
          )}
          <button
            id="btn-toggle-sidebar"
            type="button"
            onClick={toggleCollapse}
            className={`p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition cursor-pointer ${
              isCollapsed ? 'mx-auto' : 'ml-auto'
            }`}
            title={isCollapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'}
          >
            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              id={`nav-item-${item.id}`}
              onClick={() => onSelectTab(item.id)}
              title={isCollapsed ? item.label : undefined}
              className={`w-full flex items-center ${
                isCollapsed ? 'justify-center px-2 py-2.5' : 'justify-between px-3 py-2'
              } rounded-lg text-sm font-medium transition cursor-pointer text-left ${
                isActive
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className={isActive ? 'text-indigo-600 shrink-0' : 'text-slate-400 shrink-0'}>
                  {item.icon}
                </span>
                {!isCollapsed && <span className="truncate">{item.label}</span>}
              </div>

              {!isCollapsed && item.badge !== undefined && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold shrink-0 ${item.badgeColor || 'bg-slate-100 text-slate-700'}`}>
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Bottom Compliance & Platform Health widget */}
      {!isCollapsed ? (
        <div className="mt-auto p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-800 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              Certificação LGPD
            </span>
            <span className="text-[10px] font-mono text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 font-bold">100% OK</span>
          </div>
          <p className="text-[11px] text-slate-500 leading-normal">
            Conformidade ativa com Artigos 7º, 13 e 46 da Lei 13.709/2018.
          </p>
          <div>
            <div className="flex justify-between text-[10px] text-slate-500 mb-1">
              <span>Sanitização em Memória</span>
              <span className="font-medium text-slate-700">99.8%</span>
            </div>
            <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
              <div className="bg-indigo-600 h-full w-[99.8%] rounded-full"></div>
            </div>
          </div>
          <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-[10px] text-slate-500">
            <span>HSM Vault</span>
            <span className="text-slate-700 font-mono font-medium">AES-256 GCM</span>
          </div>
        </div>
      ) : (
        <div className="mt-auto flex flex-col items-center py-2 text-slate-400" title="Certificação LGPD Ativa 100%">
          <ShieldCheck className="w-5 h-5 text-emerald-600" />
        </div>
      )}
    </aside>
  );
};

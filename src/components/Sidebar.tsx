import React from 'react';
import { 
  Network, Layers, Activity, ShieldCheck, DollarSign, 
  Lock, ChevronRight, HelpCircle, Terminal, Wand2
} from 'lucide-react';

export type ActiveTab = 'studio' | 'auto-pipeline' | 'pipelines' | 'monitoring' | 'governance' | 'finops' | 'rbac';

interface SidebarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  openIncidentsCount: number;
  pendingDsrCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  openIncidentsCount,
  pendingDsrCount
}) => {
  const navItems: { id: ActiveTab; label: string; icon: React.ReactNode; badge?: number; badgeColor?: string }[] = [
    {
      id: 'studio',
      label: 'Studio Visual ETL',
      icon: <Network className="w-4 h-4" />
    },
    {
      id: 'auto-pipeline',
      label: 'Pipeline Automático',
      icon: <Wand2 className="w-4 h-4 text-indigo-600" />
    },
    {
      id: 'pipelines',
      label: 'Pipelines & Fluxos',
      icon: <Layers className="w-4 h-4" />
    },
    {
      id: 'monitoring',
      label: 'Monitoramento & Alertas',
      icon: <Activity className="w-4 h-4" />,
      badge: openIncidentsCount > 0 ? openIncidentsCount : undefined,
      badgeColor: 'bg-amber-50 text-amber-700 border border-amber-200'
    },
    {
      id: 'governance',
      label: 'Governança & LGPD',
      icon: <ShieldCheck className="w-4 h-4 text-emerald-600" />,
      badge: pendingDsrCount > 0 ? pendingDsrCount : undefined,
      badgeColor: 'bg-emerald-50 text-emerald-700 border border-emerald-200'
    },
    {
      id: 'finops',
      label: 'Custos & FinOps',
      icon: <DollarSign className="w-4 h-4 text-amber-600" />
    },
    {
      id: 'rbac',
      label: 'Segurança & RBAC',
      icon: <Lock className="w-4 h-4 text-indigo-600" />
    }
  ];

  return (
    <aside id="app-sidebar" className="w-60 bg-white border-r border-slate-200 flex flex-col justify-between shrink-0 p-4 hidden md:flex">
      {/* Navigation list */}
      <div className="space-y-1">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-2 mb-2">
          Core Platform
        </p>

        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              id={`nav-item-${item.id}`}
              onClick={() => onSelectTab(item.id)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition cursor-pointer text-left ${
                isActive
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className={isActive ? 'text-indigo-600' : 'text-slate-400'}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </div>

              {item.badge !== undefined && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold ${item.badgeColor || 'bg-slate-100 text-slate-700'}`}>
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Bottom Compliance & Platform Health widget */}
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
    </aside>
  );
};

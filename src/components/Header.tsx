import React from 'react';
import { 
  ShieldCheck, Activity, User, ChevronDown, 
  Layers, Lock, Sparkles, Bell, LogOut
} from 'lucide-react';
import { UserRole, TeamUser } from '../types';
import { ROLE_DEFINITIONS } from '../data/initialData';
import { DataCoreLogo } from './common/DataCoreLogo';
import { ExecutionBell } from './Executions/ExecutionBell';

interface HeaderProps {
  currentRole: UserRole;
  onChangeRole: (role: UserRole) => void;
  currentUser?: TeamUser | null;
  onLogout?: () => void;
  /** Vai para a tela principal (Pipelines & Fluxos) ao clicar no logo. */
  onLogoClick?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentRole,
  onChangeRole,
  currentUser,
  onLogout,
  onLogoClick
}) => {
  const currentRoleDef = ROLE_DEFINITIONS[currentRole] || ROLE_DEFINITIONS.admin;

  return (
    <header 
      id="app-header" 
      className="fixed top-0 left-0 right-0 h-14 bg-white/95 backdrop-blur-xs border-b border-slate-200 px-3 sm:px-6 flex items-center justify-between gap-3 z-40 shadow-xs min-w-0"
    >
      {/* Brand logo & title */}
      <button
        type="button"
        id="btn-header-logo"
        onClick={onLogoClick}
        disabled={!onLogoClick}
        className="flex items-center gap-2.5 sm:gap-3 shrink-0 cursor-pointer disabled:cursor-default rounded-lg -m-1 p-1 hover:bg-slate-50 transition"
        title="Ir para Pipelines & Fluxos"
      >
        <DataCoreLogo size="sm" showWordmark={true} showTagline={false} />
      </button>

      {/* Operational Cards & User Controls Cluster (No overlap layout) */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0 ml-auto">
        {/* Tipo de Usuário / Perfil (Administrador Global, etc.) */}
        <div 
          id="header-card-user-role"
          className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 shadow-2xs shrink-0"
        >
          <User className="w-3.5 h-3.5 text-indigo-600 shrink-0 hidden sm:block" />
          <span className="text-[11px] text-slate-500 hidden xl:inline font-medium whitespace-nowrap">
            Perfil:
          </span>

          <div className="relative flex items-center">
            <select
              id="header-role-select"
              value={currentRole}
              onChange={(e) => onChangeRole(e.target.value as UserRole)}
              className="bg-transparent text-xs font-semibold text-slate-800 focus:outline-none cursor-pointer pr-5 appearance-none max-w-[155px] sm:max-w-[175px] truncate"
              title="Tipo de usuário / Papel de acesso RBAC"
            >
              <option value="admin" className="bg-white text-slate-900">Administrador Global</option>
              <option value="data_engineer" className="bg-white text-slate-900">Engenheiro de Dados</option>
              <option value="dpo_compliance" className="bg-white text-slate-900">DPO / Oficial LGPD</option>
              <option value="data_analyst" className="bg-white text-slate-900">Analista de Dados</option>
              <option value="viewer" className="bg-white text-slate-900">Visualizador</option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-500 pointer-events-none absolute right-0" />
          </div>
        </div>

        {/* Sino de notificações: execuções do Studio Gold em segundo plano */}
        <ExecutionBell />

        {/* Identificação do Usuário e Logout */}
        <div id="header-user-badge" className="flex items-center gap-2.5 border-l border-slate-200 pl-2.5 sm:pl-3 shrink-0">
          <div className="text-right hidden xl:block">
            <p className="text-xs font-bold text-slate-900 leading-tight">
              {currentUser?.name || 'Jefferson Barbosa'}
            </p>
            <p className="text-[10px] text-slate-500">
              {currentUser?.department || currentRoleDef.name}
            </p>
          </div>
          <div 
            className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-200 flex items-center justify-center font-bold text-xs text-indigo-700 shrink-0 shadow-2xs" 
            title={`${currentUser?.name || 'Usuário'} (${currentUser?.department || currentRoleDef.name})`}
          >
            {currentUser?.avatar || 'JB'}
          </div>

          {/* Sair / Logout */}
          {onLogout && (
            <button
              id="btn-header-logout"
              type="button"
              onClick={onLogout}
              className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200 transition cursor-pointer"
              title="Encerrar sessão e voltar ao Login"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};

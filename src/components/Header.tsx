import React from 'react';
import {
  ShieldCheck, Activity, User, ChevronDown,
  Layers, Lock, Sparkles, Bell, LogOut
} from 'lucide-react';
import { UserRole } from '../types';
import { ROLE_DEFINITIONS } from '../data/initialData';
import { Logo } from './Logo';

interface HeaderProps {
  currentRole: UserRole;
  onChangeRole: (role: UserRole) => void;
  activePipelinesCount: number;
  totalPipelinesCount: number;
  userName: string;
  userDepartment: string;
  userAvatar: string;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentRole,
  onChangeRole,
  activePipelinesCount,
  totalPipelinesCount,
  userName,
  userDepartment,
  userAvatar,
  onLogout
}) => {
  const currentRoleDef = ROLE_DEFINITIONS[currentRole] || ROLE_DEFINITIONS.admin;

  return (
    <header id="app-header" className="h-14 bg-white border-b border-slate-200 px-3 sm:px-6 flex items-center justify-between gap-3 z-30 sticky top-0 shadow-[0_1px_3px_rgba(0,0,0,0.03)] min-w-0">
      {/* Brand logo & title */}
      <Logo iconSize={36} wordmarkClassName="text-base sm:text-lg" className="shrink-0" />

      {/* Operational Cards & User Controls Cluster (No overlap layout) */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0 ml-auto">
        {/* Card 1: Quantidade de Pipelines Ativos */}
        <div 
          id="header-card-active-pipelines"
          className="hidden sm:flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg text-xs shrink-0 whitespace-nowrap shadow-2xs"
          title="Pipelines ativos em operação"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 animate-pulse"></span>
          <span className="text-slate-600 font-medium text-[11px] sm:text-xs">
            <strong className="text-slate-900 font-bold">{activePipelinesCount}/{totalPipelinesCount}</strong> Pipelines Ativos
          </span>
        </div>

        {/* Card 2: Região Cloud */}
        <div 
          id="header-card-region"
          className="hidden md:flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg text-xs shrink-0 whitespace-nowrap shadow-2xs text-slate-600"
          title="Região primária do cluster de processamento"
        >
          <span className="text-slate-400 text-[11px] font-medium hidden lg:inline">Região:</span>
          <strong className="text-slate-800 font-semibold text-[11px] sm:text-xs">AWS sa-east-1</strong>
        </div>

        {/* Card 3: Tipo de Usuário / Perfil (Administrador Global, etc.) */}
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

        {/* Card 4: Identificação do Usuário */}
        <div id="header-user-badge" className="flex items-center gap-2.5 border-l border-slate-200 pl-2.5 sm:pl-3 shrink-0">
          <div className="text-right hidden xl:block">
            <p className="text-xs font-bold text-slate-900 leading-tight">{userName}</p>
            <p className="text-[10px] text-slate-500">{userDepartment}</p>
          </div>
          <div
            className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-200 flex items-center justify-center font-bold text-xs text-indigo-700 shrink-0 shadow-2xs"
            title={`${userName} (${userDepartment})`}
          >
            {userAvatar}
          </div>
          <button
            id="header-logout-button"
            onClick={onLogout}
            title="Sair da plataforma"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};

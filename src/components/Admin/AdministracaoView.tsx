import React from 'react';
import { Settings, Users, UserPlus, Building2 } from 'lucide-react';
import { TeamUser } from '../../types';
import { CadastroUsuarioView } from '../Security/CadastroUsuarioView';
import { EmpresasView } from '../Empresas/EmpresasView';
import { UsuariosAdminView } from './UsuariosAdminView';

export type AdminSection = 'usuarios' | 'cadastrar-usuario' | 'empresas';

interface AdministracaoViewProps {
  section: AdminSection;
  onSelectSection: (section: AdminSection) => void;
  canManage: boolean;
  currentUserEmail?: string;
  onUserCreated?: (user: TeamUser) => void;
}

const SECTIONS: { id: AdminSection; label: string; icon: React.ReactNode }[] = [
  { id: 'usuarios', label: 'Usuários', icon: <Users className="w-4 h-4" /> },
  { id: 'cadastrar-usuario', label: 'Cadastrar Usuário', icon: <UserPlus className="w-4 h-4" /> },
  { id: 'empresas', label: 'Empresas', icon: <Building2 className="w-4 h-4" /> },
];

export const AdministracaoView: React.FC<AdministracaoViewProps> = ({
  section,
  onSelectSection,
  canManage,
  currentUserEmail,
  onUserCreated,
}) => {
  return (
    <div id="administracao-container" className="space-y-6 max-w-5xl mx-auto">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center shadow-xs">
            <Settings className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Administração</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Cadastro e manutenção de usuários (dados, e-mail de login e senha) e das empresas da plataforma.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1 border-b border-slate-200 -mb-6 -mx-6 px-6">
          {SECTIONS.map(s => {
            const isActive = section === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelectSection(s.id)}
                className={`px-4 py-2.5 text-xs font-semibold flex items-center gap-2 border-b-2 -mb-px transition cursor-pointer ${
                  isActive
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {s.icon}
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {section === 'usuarios' && (
        <UsuariosAdminView canManage={canManage} currentUserEmail={currentUserEmail} />
      )}

      {section === 'cadastrar-usuario' && (
        <CadastroUsuarioView
          canManageUsers={canManage}
          onUserCreated={(newUser) => {
            onUserCreated?.(newUser);
            onSelectSection('usuarios');
          }}
          onCancel={() => onSelectSection('usuarios')}
        />
      )}

      {section === 'empresas' && <EmpresasView canManage={canManage} />}
    </div>
  );
};

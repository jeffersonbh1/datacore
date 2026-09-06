import React, { useState } from 'react';
import { 
  ShieldCheck, Users, Lock, Key, CheckCircle, XCircle, AlertTriangle, 
  Search, Plus, Shield, UserPlus, Sliders, Check, X
} from 'lucide-react';
import { TeamUser, RolePermissions, UserRole } from '../../types';
import { ROLE_DEFINITIONS } from '../../data/initialData';

interface RbacManagerProps {
  users: TeamUser[];
  onUpdateUserRole: (userId: string, newRole: UserRole) => void;
  onToggleUserRawPII: (userId: string) => void;
  canManageUsers: boolean;
  onNavigateToCadastro?: () => void;
}

export const RbacManager: React.FC<RbacManagerProps> = ({
  users,
  onUpdateUserRole,
  onToggleUserRawPII,
  canManageUsers,
  onNavigateToCadastro
}) => {
  const [activeTab, setActiveTab] = useState<'matrix' | 'users' | 'policies'>('matrix');
  const [rolePermissions, setRolePermissions] = useState<Record<string, RolePermissions>>(ROLE_DEFINITIONS);
  const [searchUser, setSearchUser] = useState('');
  const [showAddUserModal, setShowAddUserModal] = useState(false);

  const permissionLabels: { key: keyof RolePermissions['permissions']; label: string; description: string; sensitive?: boolean }[] = [
    { key: 'canCreatePipelines', label: 'Criar Pipelines Automáticos', description: 'Permite cadastrar novas integrações e gerar pipelines' },
    { key: 'canEditPipelines', label: 'Editar e Salvar DAGs', description: 'Alterar nós, consultas SQL e filtros' },
    { key: 'canTriggerExecutions', label: 'Executar Jobs Manuais', description: 'Disparar processamento e testes de pipeline' },
    { key: 'canViewPipelines', label: 'Visualizar Pipelines', description: 'Acesso de leitura aos diagramas de fluxo' },
    { key: 'canViewRawPII', label: 'Visualizar PII em Texto Claro', description: 'Acesso a CPFs e Cartões sem máscara (Crítico LGPD)', sensitive: true },
    { key: 'canConfigureLGPDRules', label: 'Gerenciar Regras LGPD', description: 'Configurar sanitização e responder a solicitações DSR' },
    { key: 'canManageAlerts', label: 'Configurar Alertas', description: 'Criar e alterar regras de notificação de erro' },
    { key: 'canViewFinOps', label: 'Visualizar FinOps & Custos', description: 'Acesso aos relatórios de faturamento cloud' },
    { key: 'canManageUsers', label: 'Administrar Usuários & RBAC', description: 'Gerenciar funções e permissões de colaboradores' }
  ];

  const handleTogglePermission = (role: string, permKey: keyof RolePermissions['permissions']) => {
    if (!canManageUsers) return;
    setRolePermissions(prev => ({
      ...prev,
      [role]: {
        ...prev[role],
        permissions: {
          ...prev[role].permissions,
          [permKey]: !prev[role].permissions[permKey]
        }
      }
    }));
  };

  const filteredUsers = users.filter(u =>
    u.name.toLowerCase().includes(searchUser.toLowerCase()) ||
    u.email.toLowerCase().includes(searchUser.toLowerCase()) ||
    u.department.toLowerCase().includes(searchUser.toLowerCase())
  );

  return (
    <div id="rbac-manager-container" className="space-y-6">
      {/* Top Banner Header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <div className="flex items-center gap-3">
            <span className="p-2.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-600 shadow-sm">
              <Lock className="w-6 h-6" />
            </span>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-700 font-mono">
                Segurança Corporativa & Privacidade
              </span>
              <h2 className="text-xl font-bold text-slate-900">
                Controle de Acesso Baseado em Função (RBAC & LGPD)
              </h2>
            </div>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Configure privilégios de acesso granulares para cada perfil de colaborador, garantindo o princípio do menor privilégio (PoLP) e blindando dados sensíveis contra vazamentos acidentais.
          </p>
        </div>

        {/* Sub Navigation */}
        <div className="flex items-center gap-1.5 bg-slate-100 p-1.5 rounded-xl border border-slate-200 text-xs font-semibold shrink-0">
          <button
            onClick={() => setActiveTab('matrix')}
            className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
              activeTab === 'matrix' ? 'bg-white text-indigo-700 shadow-sm border border-slate-200/60 font-bold' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
            }`}
          >
            Matriz de Permissões
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
              activeTab === 'users' ? 'bg-white text-indigo-700 shadow-sm border border-slate-200/60 font-bold' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
            }`}
          >
            Colaboradores ({users.length})
          </button>
          <button
            onClick={() => setActiveTab('policies')}
            className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
              activeTab === 'policies' ? 'bg-white text-indigo-700 shadow-sm border border-slate-200/60 font-bold' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
            }`}
          >
            Políticas de Segurança
          </button>
        </div>
      </div>

      {/* TAB 1: Role Permissions Matrix */}
      {activeTab === 'matrix' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Matriz de Acessos por Função</h3>
              <p className="text-xs text-slate-500">Clique nas caixas de seleção para conceder ou revogar privilégios para cada papel</p>
            </div>
            {!canManageUsers && (
              <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-1 rounded-lg font-medium">
                Modo Apenas Leitura (Requer privilégios de Administrador)
              </span>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-mono text-[10px] border-b border-slate-200">
                <tr>
                  <th className="p-4 min-w-[240px]">Funcionalidade / Privilégio</th>
                  <th className="p-4 text-center">Administrador</th>
                  <th className="p-4 text-center">Engenheiro de Dados</th>
                  <th className="p-4 text-center">DPO / Compliance</th>
                  <th className="p-4 text-center">Analista de Dados</th>
                  <th className="p-4 text-center">Visualizador</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {permissionLabels.map((perm) => (
                  <tr key={perm.key} className="hover:bg-slate-50 transition">
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900">{perm.label}</span>
                        {perm.sensitive && (
                          <span className="text-[10px] bg-rose-50 text-rose-700 border border-rose-200 px-1.5 py-0.5 rounded font-mono font-medium">
                            Crítico LGPD
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">{perm.description}</p>
                    </td>

                    {/* Columns for each role */}
                    {['admin', 'data_engineer', 'dpo_compliance', 'data_analyst', 'viewer'].map((roleKey) => {
                      const hasPerm = rolePermissions[roleKey]?.permissions[perm.key];
                      return (
                        <td key={roleKey} className="p-4 text-center">
                          <button
                            disabled={!canManageUsers || roleKey === 'admin'}
                            onClick={() => handleTogglePermission(roleKey, perm.key)}
                            className={`w-6 h-6 rounded-lg inline-flex items-center justify-center transition cursor-pointer ${
                              hasPerm 
                                ? 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700' 
                                : 'bg-slate-100 text-slate-400 hover:text-slate-600 hover:bg-slate-200 border border-slate-200'
                            } ${!canManageUsers || roleKey === 'admin' ? 'cursor-not-allowed opacity-90' : ''}`}
                          >
                            {hasPerm ? <Check className="w-4 h-4 stroke-[3]" /> : <X className="w-3.5 h-3.5" />}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: Team Members & Individual Roles */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 bg-white border border-slate-200 p-3.5 rounded-xl shadow-sm">
            <div className="flex items-center gap-2 flex-1 max-w-md bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 focus-within:bg-white focus-within:border-indigo-500 transition-colors">
              <Search className="w-4 h-4 text-slate-400 shrink-0" />
              <input
                type="text"
                placeholder="Filtrar por nome, e-mail ou departamento..."
                value={searchUser}
                onChange={(e) => setSearchUser(e.target.value)}
                className="w-full bg-transparent focus:outline-none text-slate-800 placeholder-slate-400"
              />
            </div>
            {onNavigateToCadastro && (
              <button
                type="button"
                onClick={onNavigateToCadastro}
                className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-2xs"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Novo Usuário (tabela usuarios)</span>
              </button>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-mono text-[10px] border-b border-slate-200">
                  <tr>
                    <th className="p-3.5">Colaborador</th>
                    <th className="p-3.5">Departamento</th>
                    <th className="p-3.5">Papel Atribuído (Role)</th>
                    <th className="p-3.5 text-center">Autenticação MFA</th>
                    <th className="p-3.5 text-center">Ver PII Crua (LGPD)</th>
                    <th className="p-3.5">Última Atividade</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {filteredUsers.map((user) => (
                    <tr key={user.id} className="hover:bg-slate-50 transition">
                      <td className="p-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold flex items-center justify-center text-xs shadow-sm">
                            {user.avatar}
                          </div>
                          <div>
                            <span className="font-semibold text-slate-900 block">{user.name}</span>
                            <span className="text-slate-500 text-[11px]">{user.email}</span>
                          </div>
                        </div>
                      </td>

                      <td className="p-3.5 text-slate-600 font-medium">{user.department}</td>

                      <td className="p-3.5">
                        <select
                          disabled={!canManageUsers}
                          value={user.role}
                          onChange={(e) => onUpdateUserRole(user.id, e.target.value as UserRole)}
                          className="bg-white border border-slate-300 rounded px-2.5 py-1 text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer text-xs shadow-sm"
                        >
                          <option value="admin">Administrador Global</option>
                          <option value="data_engineer">Engenheiro de Dados</option>
                          <option value="dpo_compliance">DPO / Compliance</option>
                          <option value="data_analyst">Analista de Dados</option>
                          <option value="viewer">Visualizador</option>
                        </select>
                      </td>

                      <td className="p-3.5 text-center">
                        {user.mfaEnabled ? (
                          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded font-mono font-medium">
                            <CheckCircle className="w-3 h-3" /> FIDO2/MFA Ativo
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded font-mono font-medium">
                            <AlertTriangle className="w-3 h-3" /> Pendente
                          </span>
                        )}
                      </td>

                      <td className="p-3.5 text-center">
                        <button
                          disabled={!canManageUsers}
                          onClick={() => onToggleUserRawPII(user.id)}
                          className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border transition cursor-pointer shadow-sm ${
                            user.canViewUnmaskedPII
                              ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                              : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                          }`}
                        >
                          {user.canViewUnmaskedPII ? 'Liberado (Alto Risco)' : 'Bloqueado (Mascarado)'}
                        </button>
                      </td>

                      <td className="p-3.5 font-mono text-slate-500 text-[11px]">{user.lastActive}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Security & Compliance Policies */}
      {activeTab === 'policies' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 shadow-sm hover:shadow-md transition-shadow">
            <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-600 w-fit">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h4 className="text-sm font-semibold text-slate-900">Criptografia em Trânsito & Repouso</h4>
            <p className="text-xs text-slate-600 leading-relaxed">
              Todos os fluxos de streaming e batch utilizam canais TLS 1.3 obrigatórios com mTLS nos webhooks. Armazenamento com AES-256 GCM e rotação semestral de chaves.
            </p>
            <span className="text-[10px] text-emerald-700 font-mono block pt-2 border-t border-slate-100 font-medium">
              Certificação FIPS 140-3 Nível 3
            </span>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 shadow-sm hover:shadow-md transition-shadow">
            <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-600 w-fit">
              <Key className="w-5 h-5" />
            </div>
            <h4 className="text-sm font-semibold text-slate-900">Pseudonimização e Token Vault</h4>
            <p className="text-xs text-slate-600 leading-relaxed">
              Dados pessoais cadastrais substituídos por tokens determinísticos seguros. Somente o serviço de reconciliação sob autorização judicial pode reverter o token.
            </p>
            <span className="text-[10px] text-blue-700 font-mono block pt-2 border-t border-slate-100 font-medium">
              Conforme Artigo 13 § 4º da LGPD
            </span>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 shadow-sm hover:shadow-md transition-shadow">
            <div className="p-2.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-600 w-fit">
              <Shield className="w-5 h-5" />
            </div>
            <h4 className="text-sm font-semibold text-slate-900">Trilhas de Auditoria Imutáveis</h4>
            <p className="text-xs text-slate-600 leading-relaxed">
              Todo acesso a tabelas contendo PII gera log assinado criptograficamente armazenado em bucket WORM (Write Once, Read Many) com retenção mínima de 1 ano.
            </p>
            <span className="text-[10px] text-indigo-700 font-mono block pt-2 border-t border-slate-100 font-medium">
              Auditoria em conformidade com a ANPD
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

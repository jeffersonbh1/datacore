import React, { useEffect, useState } from 'react';
import {
  UserPlus, Mail, Lock, Shield, Building, Eye, EyeOff,
  CheckCircle2, AlertTriangle, ArrowLeft, RefreshCw, Database,
  Sliders, Key, Sparkles, Check, Info
} from 'lucide-react';
import { UserRole, TeamUser, NewUsuarioPayload, Empresa } from '../../types';
import { ROLE_DEFINITIONS } from '../../data/initialData';
import { isSupabaseConfigured, registerUsuario, fetchEmpresas } from '../../lib/supabase';

interface CadastroUsuarioViewProps {
  onUserCreated?: (user: TeamUser) => void;
  onCancel?: () => void;
  canManageUsers?: boolean;
}

export const CadastroUsuarioView: React.FC<CadastroUsuarioViewProps> = ({
  onUserCreated,
  onCancel,
  canManageUsers = true
}) => {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [showSenha, setShowSenha] = useState(false);
  const [papel, setPapel] = useState<UserRole>('viewer');
  const [departamento, setDepartamento] = useState('Engenharia de Dados');
  const [idEmpresa, setIdEmpresa] = useState<string>('');
  const [mfaHabilitado, setMfaHabilitado] = useState(false);
  const [podeVisualizarPiiBruto, setPodeVisualizarPiiBruto] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showSqlSchema, setShowSqlSchema] = useState(false);

  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [isLoadingEmpresas, setIsLoadingEmpresas] = useState(true);

  const supabaseReady = isSupabaseConfigured();
  const selectedRoleDef = ROLE_DEFINITIONS[papel] || ROLE_DEFINITIONS.viewer;

  useEffect(() => {
    if (!supabaseReady) {
      setIsLoadingEmpresas(false);
      return;
    }
    fetchEmpresas()
      .then(setEmpresas)
      .catch(() => setEmpresas([]))
      .finally(() => setIsLoadingEmpresas(false));
  }, [supabaseReady]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    // Basic form validations
    if (!nome.trim()) {
      setErrorMsg('O nome do usuário é obrigatório.');
      return;
    }

    if (!email.trim() || !email.includes('@')) {
      setErrorMsg('Informe um endereço de e-mail corporativo válido.');
      return;
    }

    if (!senha || senha.length < 6) {
      setErrorMsg('A senha deve possuir no mínimo 6 caracteres (exigência do Supabase Auth).');
      return;
    }

    if (senha !== confirmarSenha) {
      setErrorMsg('A confirmação de senha não coincide com a senha digitada.');
      return;
    }

    setIsLoading(true);

    try {
      const payload: NewUsuarioPayload = {
        nome: nome.trim(),
        email: email.trim().toLowerCase(),
        senha,
        papel,
        departamento: departamento.trim(),
        mfa_habilitado: mfaHabilitado,
        pode_visualizar_pii_bruto: podeVisualizarPiiBruto,
        id_empresa: idEmpresa.trim() ? Number(idEmpresa.trim()) : null
      };

      const newUser = await registerUsuario(payload);

      setIsLoading(false);
      setSuccessMsg(`Usuário "${newUser.name}" (${newUser.email}) criado com sucesso — já pode fazer login com a senha definida.`);
      
      // Reset sensitive fields
      setSenha('');
      setConfirmarSenha('');

      if (onUserCreated) {
        onUserCreated(newUser);
      }
    } catch (err: unknown) {
      setIsLoading(false);
      const msg = err instanceof Error ? err.message : 'Erro ao cadastrar usuário na tabela.';
      setErrorMsg(msg);
    }
  };

  return (
    <div id="cadastro-usuario-container" className="space-y-6 max-w-4xl mx-auto">
      {/* Top Banner Header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center shadow-xs">
            <UserPlus className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900">
                Cadastro de Usuário
              </h2>
              {supabaseReady ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                  <Database className="w-3 h-3 text-emerald-600" />
                  Supabase: public.usuarios
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                  Modo Local (Demo)
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Cria a conta real no <strong className="font-semibold text-slate-700">Supabase Auth</strong> e o perfil em <code className="font-mono text-slate-800 bg-slate-100 px-1 py-0.5 rounded">public.usuarios</code>, vinculados.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center">
          <button
            type="button"
            onClick={() => setShowSqlSchema(!showSqlSchema)}
            className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-medium transition cursor-pointer flex items-center gap-1.5"
          >
            <Database className="w-3.5 h-3.5 text-indigo-600" />
            <span>{showSqlSchema ? 'Ocultar DDL' : 'Ver Estrutura DDL'}</span>
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-medium transition cursor-pointer flex items-center gap-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Voltar</span>
            </button>
          )}
        </div>
      </div>

      {/* SQL DDL Collapsible Helper */}
      {showSqlSchema && (
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono text-slate-300 space-y-2">
          <div className="flex items-center justify-between text-emerald-400 font-semibold border-b border-slate-800 pb-2">
            <span className="flex items-center gap-2">
              <Database className="w-4 h-4" />
              Fluxo de cadastro (Fase 4 — Supabase Auth)
            </span>
            <span className="text-[10px] text-slate-500 uppercase">Admin API / PostgreSQL</span>
          </div>
          <pre className="text-[11px] text-emerald-300 leading-relaxed overflow-x-auto select-all p-2 bg-slate-950/80 rounded border border-slate-800/80">
{`1. Gateway (service role) chama supabase.auth.admin.createUser({ email, password })
   -> cria a identidade real no Supabase Auth (senha nunca toca as tabelas da app)
2. Gateway insere em public.usuarios: { auth_user_id, nome, papel, id_empresa, ... }
   -> perfil da aplicação, vinculado 1:1 à identidade acima
3. Se o passo 2 falhar, o usuário criado no passo 1 é revertido (rollback)`}
          </pre>
          <p className="text-[11px] text-slate-400">
            A coluna <code className="text-amber-300">senha_hash</code> em <code className="text-amber-300">usuarios</code> está obsoleta — mantida só por compatibilidade de schema, nunca lida.
          </p>
        </div>
      )}

      {/* Feedback Alerts */}
      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-medium">{successMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMsg(null)}
            className="text-emerald-700 hover:text-emerald-900 font-bold text-xs"
          >
            ✕
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="font-medium">{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-rose-700 hover:text-rose-900 font-bold text-xs"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Registration Form */}
      <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
        
        {/* Section 1: Dados Pessoais & Corporativos */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <UserPlus className="w-4 h-4 text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide text-[11px]">
              1. Identificação do Colaborador
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Nome */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Nome Completo <span className="text-rose-500">*</span>
              </label>
              <input
                id="input-user-nome"
                type="text"
                required
                maxLength={150}
                placeholder="Ex: Ana Silva Santos"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                Gravado na coluna: <code className="font-mono text-slate-600">nome character varying(150)</code>
              </span>
            </div>

            {/* Email */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                E-mail Corporativo <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  id="input-user-email"
                  type="email"
                  required
                  maxLength={255}
                  placeholder="usuario@datacore.io"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
                />
              </div>
              <span className="text-[10px] text-slate-400 mt-1 block">
                Chave única: <code className="font-mono text-slate-600">email character varying(255) UNIQUE</code>
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            {/* Departamento */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Departamento / Área
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Building className="w-4 h-4" />
                </div>
                <input
                  id="input-user-departamento"
                  type="text"
                  maxLength={150}
                  placeholder="Ex: Engenharia de Dados & Governança"
                  value={departamento}
                  onChange={(e) => setDepartamento(e.target.value)}
                  className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
                />
              </div>
              <span className="text-[10px] text-slate-400 mt-1 block">
                Gravado na coluna: <code className="font-mono text-slate-600">departamento</code>
              </span>
            </div>

            {/* Empresa */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Empresa (Opcional)
              </label>
              <select
                id="input-user-id-empresa"
                value={idEmpresa}
                onChange={(e) => setIdEmpresa(e.target.value)}
                disabled={isLoadingEmpresas || empresas.length === 0}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition disabled:opacity-60"
              >
                <option value="">Sem empresa vinculada</option>
                {empresas.map(empresa => (
                  <option key={empresa.id} value={empresa.id}>{empresa.nome}</option>
                ))}
              </select>
              <span className="text-[10px] text-slate-400 mt-1 block">
                {isLoadingEmpresas
                  ? 'Carregando empresas...'
                  : empresas.length === 0
                    ? <>Nenhuma empresa cadastrada — crie uma em <strong>Empresas</strong> primeiro.</>
                    : <>Gravado na coluna: <code className="font-mono text-slate-600">id_empresa</code> (FK para <code className="font-mono text-slate-600">empresas</code>)</>}
              </span>
            </div>
          </div>
        </div>

        {/* Section 2: Credenciais e Senha_Hash */}
        <div className="space-y-4 pt-2">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <Key className="w-4 h-4 text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide text-[11px]">
              2. Segurança & Senha (senha_hash)
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Senha */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Senha de Acesso <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="input-user-senha"
                  type={showSenha ? 'text' : 'password'}
                  required
                  placeholder="Mínimo de 3 caracteres"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  className="w-full pl-9 pr-10 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
                />
                <button
                  type="button"
                  onClick={() => setShowSenha(!showSenha)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  {showSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <span className="text-[10px] text-slate-400 mt-1 block">
                Armazenada criptografada em <code className="font-mono text-slate-600">senha_hash</code>
              </span>
            </div>

            {/* Confirmar Senha */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Confirmar Senha <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="input-user-confirmar-senha"
                  type={showSenha ? 'text' : 'password'}
                  required
                  placeholder="Repita a senha"
                  value={confirmarSenha}
                  onChange={(e) => setConfirmarSenha(e.target.value)}
                  className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
                />
              </div>
              {confirmarSenha && senha !== confirmarSenha && (
                <span className="text-[10px] text-rose-600 mt-1 block font-medium">
                  As senhas não coincidem.
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Section 3: Papel de Acesso (papel_usuario) e Governança LGPD */}
        <div className="space-y-4 pt-2">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <Shield className="w-4 h-4 text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide text-[11px]">
              3. Papel de Acesso & Controles de Privacidade
            </h3>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">
              Papel Atribuído (<code className="font-mono text-indigo-700">papel: papel_usuario</code>)
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
              {[
                { id: 'admin', label: 'Administrador', desc: 'Acesso pleno à governança, RBAC e infraestrutura' },
                { id: 'data_engineer', label: 'Eng. de Dados', desc: 'Criar DAGs, triggers e conectores' },
                { id: 'dpo_compliance', label: 'DPO / Compliance', desc: 'Acesso a solicitações LGPD e DSR' },
                { id: 'data_analyst', label: 'Analista de Dados', desc: 'Leitura de métricas, FinOps e pipelines' },
                { id: 'viewer', label: 'Visualizador', desc: 'Leitura restrita e dados mascarados' }
              ].map((roleOpt) => {
                const isSelected = papel === roleOpt.id;
                return (
                  <button
                    key={roleOpt.id}
                    type="button"
                    onClick={() => setPapel(roleOpt.id as UserRole)}
                    className={`p-3 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                      isSelected
                        ? 'border-indigo-600 bg-indigo-50/70 text-indigo-950 shadow-xs'
                        : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-xs">{roleOpt.label}</span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-indigo-600" />}
                      </div>
                      <p className="text-[10px] text-slate-500 leading-snug">
                        {roleOpt.desc}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Granular Toggles for mfa_habilitado and pode_visualizar_pii_bruto */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 flex items-start gap-3">
              <input
                id="check-mfa-habilitado"
                type="checkbox"
                checked={mfaHabilitado}
                onChange={(e) => setMfaHabilitado(e.target.checked)}
                className="mt-1 w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 cursor-pointer"
              />
              <div>
                <label htmlFor="check-mfa-habilitado" className="font-semibold text-xs text-slate-900 cursor-pointer">
                  Exigir Autenticação Multifator (MFA)
                </label>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Coluna <code className="font-mono text-slate-700">mfa_habilitado boolean</code>. Exige verificação adicional FIDO2 / OTP no próximo logon.
                </p>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 flex items-start gap-3">
              <input
                id="check-pii-bruto"
                type="checkbox"
                checked={podeVisualizarPiiBruto}
                onChange={(e) => setPodeVisualizarPiiBruto(e.target.checked)}
                className="mt-1 w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 cursor-pointer"
              />
              <div>
                <label htmlFor="check-pii-bruto" className="font-semibold text-xs text-slate-900 cursor-pointer">
                  Visualizar Dados Pessoais em Texto Claro (PII Crua)
                </label>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Coluna <code className="font-mono text-slate-700">pode_visualizar_pii_bruto boolean</code>. Permite visualizar CPFs e RG desmascarados conforme termos da LGPD.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Submit Actions */}
        <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Info className="w-4 h-4 text-indigo-500 shrink-0" />
            <span>O usuário receberá o status ativo (<code className="font-mono text-slate-700">ind_cadastro_ativo = true</code>) automaticamente.</span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="w-full sm:w-auto px-4 py-2.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition cursor-pointer"
              >
                Cancelar
              </button>
            )}
            <button
              id="btn-salvar-usuario"
              type="submit"
              disabled={isLoading || !canManageUsers}
              className="w-full sm:w-auto px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Gravando na tabela usuarios...</span>
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4" />
                  <span>Cadastrar Usuário</span>
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

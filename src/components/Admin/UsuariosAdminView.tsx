import React, { useEffect, useMemo, useState } from 'react';
import {
  Users, RefreshCw, AlertTriangle, CheckCircle2, Pencil, Save, X,
  Eye, EyeOff, KeyRound, Search, Lock, Link2
} from 'lucide-react';
import { Empresa, UserRole } from '../../types';
import { ROLE_DEFINITIONS } from '../../data/initialData';
import { isSupabaseConfigured, fetchEmpresas } from '../../lib/supabase';
import { listUsuarios, updateUsuario, gerarLinkAcesso, UsuarioAdmin, UpdateUsuarioPayload } from '../../lib/adminUsuarios';
import { LinkAcessoCard } from './LinkAcessoCard';

interface UsuariosAdminViewProps {
  canManage?: boolean;
  currentUserEmail?: string;
}

const inputClass =
  'w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition';

interface FormState {
  nome: string;
  email: string;
  papel: UserRole;
  departamento: string;
  idEmpresa: string;
  mfaHabilitado: boolean;
  podeVisualizarPiiBruto: boolean;
  ativo: boolean;
  novaSenha: string;
  confirmarSenha: string;
}

function toForm(u: UsuarioAdmin): FormState {
  return {
    nome: u.nome,
    email: u.email,
    papel: u.papel,
    departamento: u.departamento,
    idEmpresa: u.idEmpresa !== null ? String(u.idEmpresa) : '',
    mfaHabilitado: u.mfaHabilitado,
    podeVisualizarPiiBruto: u.podeVisualizarPiiBruto,
    ativo: u.ativo,
    novaSenha: '',
    confirmarSenha: '',
  };
}

export const UsuariosAdminView: React.FC<UsuariosAdminViewProps> = ({ canManage = true, currentUserEmail }) => {
  const supabaseReady = isSupabaseConfigured();

  const [usuarios, setUsuarios] = useState<UsuarioAdmin[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [busca, setBusca] = useState('');

  const [editing, setEditing] = useState<UsuarioAdmin | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [showSenha, setShowSenha] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [linkGerado, setLinkGerado] = useState<{ nome: string; email: string; link: string } | null>(null);
  const [gerandoLinkId, setGerandoLinkId] = useState<string | null>(null);

  const load = () => {
    if (!supabaseReady || !canManage) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    Promise.all([listUsuarios(), fetchEmpresas().catch(() => [] as Empresa[])])
      .then(([us, es]) => { setUsuarios(us); setEmpresas(es); })
      .catch(err => setLoadError(err instanceof Error ? err.message : 'Falha ao carregar usuários.'))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const empresaNome = useMemo(() => {
    const map = new Map(empresas.map(e => [e.id, e.nome]));
    return (id: number | null) => (id !== null ? map.get(id) || `#${id}` : 'Sem empresa');
  }, [empresas]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return usuarios;
    return usuarios.filter(u =>
      u.nome.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.departamento.toLowerCase().includes(q)
    );
  }, [usuarios, busca]);

  const handleGerarLink = async (u: UsuarioAdmin) => {
    setGerandoLinkId(u.id);
    setLoadError(null);
    setSuccessMsg(null);
    try {
      const link = await gerarLinkAcesso(u.id);
      setLinkGerado({ nome: u.nome, email: u.email, link });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Erro ao gerar o link de acesso.');
    } finally {
      setGerandoLinkId(null);
    }
  };

  const openEdit = (u: UsuarioAdmin) => {
    setEditing(u);
    setForm(toForm(u));
    setFormError(null);
    setSuccessMsg(null);
    setShowSenha(false);
  };

  const closeEdit = () => {
    setEditing(null);
    setForm(null);
    setFormError(null);
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm(prev => (prev ? { ...prev, [key]: value } : prev));

  const isSelf = !!editing && !!currentUserEmail && editing.email.toLowerCase() === currentUserEmail.toLowerCase();

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing || !form) return;
    setFormError(null);

    if (!form.nome.trim()) { setFormError('O nome é obrigatório.'); return; }
    if (!form.email.trim() || !form.email.includes('@')) { setFormError('Informe um e-mail válido.'); return; }
    if (form.novaSenha || form.confirmarSenha) {
      if (form.novaSenha.length < 6) { setFormError('A nova senha deve ter no mínimo 6 caracteres.'); return; }
      if (form.novaSenha !== form.confirmarSenha) { setFormError('A confirmação não coincide com a nova senha.'); return; }
    }

    // Só manda o que mudou — evita mexer no Supabase Auth à toa.
    const payload: UpdateUsuarioPayload = {};
    const email = form.email.trim().toLowerCase();
    const idEmpresa = form.idEmpresa ? Number(form.idEmpresa) : null;
    if (form.nome.trim() !== editing.nome) payload.nome = form.nome.trim();
    if (email !== editing.email) payload.email = email;
    if (form.papel !== editing.papel) payload.papel = form.papel;
    if (form.departamento.trim() !== editing.departamento) payload.departamento = form.departamento.trim();
    if (idEmpresa !== editing.idEmpresa) payload.id_empresa = idEmpresa;
    if (form.mfaHabilitado !== editing.mfaHabilitado) payload.mfa_habilitado = form.mfaHabilitado;
    if (form.podeVisualizarPiiBruto !== editing.podeVisualizarPiiBruto) payload.pode_visualizar_pii_bruto = form.podeVisualizarPiiBruto;
    if (form.ativo !== editing.ativo) payload.ind_cadastro_ativo = form.ativo;
    if (form.novaSenha) payload.senha = form.novaSenha;

    if (Object.keys(payload).length === 0) {
      setFormError('Nenhuma alteração para salvar.');
      return;
    }

    setIsSaving(true);
    try {
      const salvo = await updateUsuario(editing.id, payload);
      // O PATCH não devolve senha_pendente; só uma senha nova muda esse estado.
      const senhaPendente = payload.senha ? false : editing.senhaPendente;
      setUsuarios(prev => prev.map(u => (u.id === salvo.id ? { ...salvo, senhaPendente } : u)));
      const partes = [
        payload.email ? 'e-mail de login alterado' : null,
        payload.senha ? 'senha redefinida' : null,
      ].filter(Boolean);
      setSuccessMsg(`Cadastro de "${salvo.nome}" atualizado${partes.length ? ` (${partes.join(', ')})` : ''}.`);
      closeEdit();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erro ao atualizar usuário.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!canManage) {
    return (
      <div className="p-6 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-2.5">
        <Lock className="w-4 h-4 shrink-0" />
        <span>Apenas administradores podem alterar cadastros de usuários.</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!supabaseReady && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para gerenciar usuários.</span>
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-medium">{successMsg}</span>
          </div>
          <button type="button" onClick={() => setSuccessMsg(null)} className="text-emerald-700 hover:text-emerald-900 font-bold text-xs">✕</button>
        </div>
      )}

      {loadError && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="font-medium">{loadError}</span>
          </div>
          <button type="button" onClick={() => setLoadError(null)} className="text-rose-700 hover:text-rose-900 font-bold text-xs">✕</button>
        </div>
      )}

      {linkGerado && (
        <LinkAcessoCard
          nome={linkGerado.nome}
          email={linkGerado.email}
          link={linkGerado.link}
          onClose={() => setLinkGerado(null)}
        />
      )}

      {/* Edit form */}
      {editing && form && (
        <form onSubmit={handleSave} className="bg-white border border-indigo-200 rounded-2xl p-6 shadow-sm space-y-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-slate-900">
              Alterar cadastro — <span className="text-indigo-700">{editing.nome}</span>
            </h3>
            <button type="button" onClick={closeEdit} className="p-1 text-slate-400 hover:text-slate-700 rounded-md cursor-pointer" title="Fechar">
              <X className="w-4 h-4" />
            </button>
          </div>

          {formError && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          {/* Dados */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Nome completo <span className="text-rose-500">*</span></label>
              <input type="text" value={form.nome} onChange={e => set('nome', e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">E-mail (login) <span className="text-rose-500">*</span></label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} className={inputClass} />
              {form.email.trim().toLowerCase() !== editing.email && (
                <span className="text-[10px] text-amber-700 mt-1 block">O usuário passará a entrar com este e-mail.</span>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Papel (RBAC)</label>
              <select
                value={form.papel}
                onChange={e => set('papel', e.target.value as UserRole)}
                disabled={isSelf}
                className={`${inputClass} disabled:opacity-60`}
              >
                {Object.values(ROLE_DEFINITIONS).map(r => (
                  <option key={r.role} value={r.role}>{r.name}</option>
                ))}
              </select>
              {isSelf && <span className="text-[10px] text-slate-400 mt-1 block">Você não pode alterar o próprio papel.</span>}
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Departamento / Área</label>
              <input type="text" maxLength={150} value={form.departamento} onChange={e => set('departamento', e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Empresa</label>
              <select value={form.idEmpresa} onChange={e => set('idEmpresa', e.target.value)} className={inputClass}>
                <option value="">Sem empresa vinculada</option>
                {empresas.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.nome}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col justify-end gap-2 pb-1">
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input type="checkbox" checked={form.mfaHabilitado} onChange={e => set('mfaHabilitado', e.target.checked)} className="accent-indigo-600" />
                MFA habilitado
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input type="checkbox" checked={form.podeVisualizarPiiBruto} onChange={e => set('podeVisualizarPiiBruto', e.target.checked)} className="accent-indigo-600" />
                Pode visualizar PII bruto (LGPD)
              </label>
              <label className={`flex items-center gap-2 text-xs text-slate-700 ${isSelf ? 'opacity-60' : 'cursor-pointer'}`}>
                <input type="checkbox" checked={form.ativo} disabled={isSelf} onChange={e => set('ativo', e.target.checked)} className="accent-indigo-600" />
                Cadastro ativo (pode fazer login)
              </label>
            </div>
          </div>

          {/* Senha */}
          <div className="pt-4 border-t border-slate-100 space-y-3">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-indigo-600" />
              <h4 className="text-[11px] font-bold text-slate-900 uppercase tracking-wide">Redefinir senha</h4>
            </div>
            <p className="text-[11px] text-slate-500">
              {editing.authUserId
                ? 'Deixe em branco para manter a senha atual. Para a própria pessoa escolher a senha, use "Gerar link" na lista.'
                : 'Este cadastro ainda não tem login no Supabase Auth — definir uma senha cria o acesso.'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="relative">
                <input
                  type={showSenha ? 'text' : 'password'}
                  placeholder="Nova senha (mín. 6 caracteres)"
                  autoComplete="new-password"
                  value={form.novaSenha}
                  onChange={e => set('novaSenha', e.target.value)}
                  className={`${inputClass} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowSenha(!showSenha)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  {showSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <input
                type={showSenha ? 'text' : 'password'}
                placeholder="Confirmar nova senha"
                autoComplete="new-password"
                value={form.confirmarSenha}
                onChange={e => set('confirmarSenha', e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={closeEdit}
              className="px-4 py-2.5 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg text-xs font-semibold transition cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center gap-2 transition cursor-pointer disabled:opacity-50"
            >
              {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>{isSaving ? 'Salvando...' : 'Salvar Alterações'}</span>
            </button>
          </div>
        </form>
      )}

      {/* List */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-4 h-4 text-indigo-600" />
            Usuários Cadastrados ({usuarios.length})
          </h3>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar por nome, e-mail..."
                value={busca}
                onChange={e => setBusca(e.target.value)}
                className="pl-8 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs w-56 focus:outline-none focus:bg-white focus:border-indigo-500"
              />
            </div>
            <button
              type="button"
              onClick={load}
              title="Recarregar"
              className="p-2 border border-slate-200 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="p-8 flex items-center justify-center gap-2 text-slate-500 text-xs">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>Carregando usuários...</span>
          </div>
        ) : filtrados.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs">
            {usuarios.length === 0 ? 'Nenhum usuário encontrado.' : 'Nenhum usuário corresponde à busca.'}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filtrados.map(u => (
              <div
                key={u.id}
                className={`px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${editing?.id === u.id ? 'bg-indigo-50/50' : ''}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold shrink-0">
                    {u.avatarIniciais || u.nome.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-slate-900 truncate">{u.nome}</span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-slate-50 text-slate-600 border-slate-200">
                        {ROLE_DEFINITIONS[u.papel]?.name || u.papel}
                      </span>
                      {!u.ativo && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-rose-50 text-rose-700 border-rose-200">Inativo</span>
                      )}
                      {u.senhaPendente && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-indigo-50 text-indigo-700 border-indigo-200">Aguardando senha</span>
                      )}
                      {!u.authUserId && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">Sem login</span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-0.5 text-[11px] text-slate-500">
                      <span className="font-mono">{u.email}</span>
                      <span>•</span>
                      <span>{empresaNome(u.idEmpresa)}</span>
                      {u.departamento && <><span>•</span><span>{u.departamento}</span></>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
                  {u.authUserId && u.ativo && (
                    <button
                      type="button"
                      onClick={() => handleGerarLink(u)}
                      disabled={gerandoLinkId === u.id}
                      title="Gera um link de uso único para a pessoa criar ou redefinir a própria senha"
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {gerandoLinkId === u.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                      Gerar link
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openEdit(u)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 flex items-center gap-1.5"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Alterar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

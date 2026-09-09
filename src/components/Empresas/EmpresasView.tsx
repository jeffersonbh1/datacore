import React, { useEffect, useState } from 'react';
import {
  Building2, Plus, RefreshCw, AlertTriangle, CheckCircle2,
  Database, Link2, X
} from 'lucide-react';
import { Empresa } from '../../types';
import { isSupabaseConfigured, fetchEmpresas, createEmpresa, updateEmpresaStatus } from '../../lib/supabase';
import { createAirbyteWorkspace } from '../../lib/airbyteGateway';

interface EmpresasViewProps {
  canManage?: boolean;
}

const STATUS_LABEL: Record<Empresa['status'], string> = {
  ativo: 'Ativo',
  trial: 'Trial',
  suspenso: 'Suspenso',
  cancelado: 'Cancelado',
};

const STATUS_STYLE: Record<Empresa['status'], string> = {
  ativo: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  trial: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  suspenso: 'bg-amber-50 text-amber-700 border-amber-200',
  cancelado: 'bg-slate-100 text-slate-500 border-slate-200',
};

export const EmpresasView: React.FC<EmpresasViewProps> = ({ canManage = true }) => {
  const supabaseReady = isSupabaseConfigured();

  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [nome, setNome] = useState('');
  const [plano, setPlano] = useState('');
  const [airbyteWorkspaceId, setAirbyteWorkspaceId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loadEmpresas = () => {
    if (!supabaseReady) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    fetchEmpresas()
      .then(setEmpresas)
      .catch(err => setLoadError(err instanceof Error ? err.message : 'Falha ao carregar empresas.'))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    loadEmpresas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSuccessMsg(null);

    if (!nome.trim()) {
      setFormError('Informe o nome da empresa.');
      return;
    }

    setIsSaving(true);
    try {
      // Fase 3: cada empresa isolada num workspace próprio do Airbyte — provisiona
      // um automaticamente quando o campo é deixado em branco (o campo manual
      // continua existindo pra quem já tem um workspace pra reaproveitar).
      let workspaceId = airbyteWorkspaceId.trim();
      if (!workspaceId) {
        try {
          const workspace = await createAirbyteWorkspace(nome.trim());
          workspaceId = workspace.workspaceId;
        } catch (err) {
          setFormError(
            `Falha ao provisionar o workspace no Airbyte: ${err instanceof Error ? err.message : 'erro desconhecido'}. ` +
            `Você pode informar um Workspace ID manualmente ou tentar novamente.`
          );
          setIsSaving(false);
          return;
        }
      }

      const created = await createEmpresa({
        nome: nome.trim(),
        plano: plano.trim() || null,
        airbyteWorkspaceId: workspaceId,
      });
      setEmpresas(prev => [...prev, created].sort((a, b) => a.nome.localeCompare(b.nome)));
      setSuccessMsg(`Empresa "${created.nome}" criada com sucesso (slug: ${created.slug}).`);
      setNome('');
      setPlano('');
      setAirbyteWorkspaceId('');
      setShowForm(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erro ao criar empresa.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleStatus = async (empresa: Empresa) => {
    const nextStatus: Empresa['status'] = empresa.status === 'ativo' ? 'suspenso' : 'ativo';
    try {
      await updateEmpresaStatus(empresa.id, nextStatus);
      setEmpresas(prev => prev.map(e => e.id === empresa.id ? { ...e, status: nextStatus } : e));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Erro ao atualizar status da empresa.');
    }
  };

  return (
    <div id="empresas-container" className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center shadow-xs">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900">Empresas (Multi-Tenant)</h2>
              {supabaseReady ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                  <Database className="w-3 h-3 text-emerald-600" />
                  Supabase: public.empresas
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                  Supabase não configurado
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Cada empresa isola suas origens, destinos e integrações. Vincule usuários a uma empresa em <strong>Cadastrar Usuário</strong>.
            </p>
          </div>
        </div>

        {supabaseReady && (
          <button
            type="button"
            onClick={() => { setShowForm(!showForm); setFormError(null); setSuccessMsg(null); }}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center gap-2 transition cursor-pointer"
          >
            {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            <span>{showForm ? 'Cancelar' : 'Nova Empresa'}</span>
          </button>
        )}
      </div>

      {!supabaseReady && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para gerenciar empresas.</span>
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

      {/* Create Form */}
      {showForm && (
        <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
          {formError && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>{formError}</span>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1">
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Nome da Empresa <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="Ex: Acme Comércio Ltda"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Plano (opcional)</label>
              <input
                type="text"
                placeholder="Ex: Enterprise"
                value={plano}
                onChange={(e) => setPlano(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Airbyte Workspace ID (opcional)</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Link2 className="w-3.5 h-3.5" />
                </div>
                <input
                  type="text"
                  placeholder="Deixe em branco para provisionar um novo automaticamente"
                  value={airbyteWorkspaceId}
                  onChange={(e) => setAirbyteWorkspaceId(e.target.value)}
                  className="w-full pl-8 pr-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
                />
              </div>
            </div>
          </div>
          <p className="text-[11px] text-slate-500">
            O identificador (slug) é gerado automaticamente a partir do nome. Deixando o Workspace ID em branco, um workspace novo e isolado é criado no Airbyte na hora — cada empresa tem o seu, sem compartilhar origens/destinos com outras. Só preencha manualmente se já existir um workspace pra reaproveitar.
          </p>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center gap-2 transition cursor-pointer disabled:opacity-50"
            >
              {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              <span>{isSaving ? 'Criando...' : 'Criar Empresa'}</span>
            </button>
          </div>
        </form>
      )}

      {/* List */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-900">Empresas Cadastradas ({empresas.length})</h3>
        </div>

        {isLoading ? (
          <div className="p-8 flex items-center justify-center gap-2 text-slate-500 text-xs">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>Carregando empresas...</span>
          </div>
        ) : empresas.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs">
            Nenhuma empresa cadastrada ainda.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {empresas.map(empresa => (
              <div key={empresa.id} className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-900">{empresa.nome}</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_STYLE[empresa.status]}`}>
                      {STATUS_LABEL[empresa.status]}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-slate-500 font-mono">
                    <span>#{empresa.id}</span>
                    <span>•</span>
                    <span>{empresa.slug}</span>
                    {empresa.plano && <><span>•</span><span>{empresa.plano}</span></>}
                    {empresa.airbyteWorkspaceId && (
                      <>
                        <span>•</span>
                        <span className="inline-flex items-center gap-1">
                          <Link2 className="w-3 h-3" />
                          workspace {empresa.airbyteWorkspaceId.slice(0, 8)}...
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {canManage && (
                  <button
                    type="button"
                    onClick={() => handleToggleStatus(empresa)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer border shrink-0 self-start sm:self-center ${
                      empresa.status === 'ativo'
                        ? 'border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100'
                        : 'border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                    }`}
                  >
                    {empresa.status === 'ativo' ? 'Suspender' : 'Reativar'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

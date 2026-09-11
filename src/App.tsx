import React, { useState, useEffect, useRef } from 'react';
import {
  INITIAL_LOGS, INITIAL_ALERT_RULES,
  INITIAL_INCIDENTS, INITIAL_LGPD_REQUESTS, INITIAL_FINOPS,
  INITIAL_USERS, ROLE_DEFINITIONS,
  INITIAL_SOURCES, INITIAL_DESTINATIONS, INITIAL_INTEGRATIONS
} from './data/initialData';
import { 
  Pipeline, UserRole, AlertRule, LGPDRequest, 
  SourceConnectorConfig, DestinationConnectorConfig, AutoIntegration, TeamUser
} from './types';
import { Header } from './components/Header';
import { Sidebar, ActiveTab } from './components/Sidebar';
import { VisualCanvas } from './components/PipelineCanvas/VisualCanvas';
import { StudioPipelineHeader } from './components/PipelineCanvas/StudioPipelineHeader';
import { AutoPipelineView } from './components/AutoPipeline/AutoPipelineView';
import { PipelinesOverview } from './components/PipelinesList/PipelinesOverview';
import { ExecutionsView } from './components/Executions/ExecutionsView';
import { LgpdHub } from './components/Governance/LgpdHub';
import { CostAnalytics } from './components/FinOps/CostAnalytics';
import { RbacManager } from './components/Security/RbacManager';
import { CadastroUsuarioView } from './components/Security/CadastroUsuarioView';
import { LoginScreen } from './components/Auth/LoginScreen';
import { ResetPasswordScreen } from './components/Auth/ResetPasswordScreen';
import { Network, Layers, Activity, ShieldCheck, DollarSign, Lock, Play, Wand2 } from 'lucide-react';
import {
  isSupabaseConfigured, supabase, logoutFromSupabase,
  fetchUsuarioPorAuthId, mapUsuarioRowToTeamUser,
  fetchOrigensPorEmpresa, fetchDestinosPorEmpresa, fetchIntegracoesPorEmpresa,
  fetchPipelinesPorEmpresa, persistPipeline, updateIntegracaoStatus, deletarIntegracao, PipelineDbRecord,
  fetchEmpresaPorId
} from './lib/supabase';
import { buildPipelineFromIntegration } from './lib/pipelineBuilder';
import { refreshPipelineMetrics } from './lib/pipelineRuns';
import { updateAirbyteConnectionStatus } from './lib/airbyteGateway';
import { EmpresasView } from './components/Empresas/EmpresasView';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return localStorage.getItem('datacore_auth_active') === 'true';
  });
  const [currentUser, setCurrentUser] = useState<TeamUser>(() => {
    try {
      const savedProfile = localStorage.getItem('datacore_user_profile');
      if (savedProfile) {
        return JSON.parse(savedProfile);
      }
    } catch {
      // ignore
    }
    const savedId = localStorage.getItem('datacore_user_id');
    return INITIAL_USERS.find(u => u.id === savedId) || INITIAL_USERS[0];
  });
  const [activeTab, setActiveTab] = useState<ActiveTab>('pipelines');
  const [currentRole, setCurrentRole] = useState<UserRole>(() => currentUser?.role || 'admin');

  // True while the URL carries a Supabase password-recovery token
  // (#access_token=...&type=recovery). A recovery link DOES authenticate the
  // browser with a real session — without this guard that session would just
  // log the user straight into the app, silently skipping the "set a new
  // password" step entirely (their old/temp password would keep working).
  const [passwordRecoveryMode, setPasswordRecoveryMode] = useState<boolean>(
    () => window.location.hash.includes('type=recovery')
  );

  // Supabase Auth State Listener & Session Synchronization (Fase 4).
  // A session alone isn't enough to log in: the user's actual role/id_empresa
  // live in their linked "usuarios" profile row, never in the Auth session's
  // own metadata — a session with no linked profile is treated as invalid.
  useEffect(() => {
    if (!isSupabaseConfigured() || !supabase) return;

    const isRecoveryLink = window.location.hash.includes('type=recovery');

    const applySession = async (authUserId: string) => {
      try {
        const usuarioRow = await fetchUsuarioPorAuthId(authUserId);
        if (!usuarioRow || usuarioRow.ind_cadastro_ativo === false) {
          await supabase.auth.signOut();
          return;
        }
        const teamUser = mapUsuarioRowToTeamUser(usuarioRow);
        setCurrentUser(teamUser);
        setCurrentRole(teamUser.role);
        setIsAuthenticated(true);
        localStorage.setItem('datacore_auth_active', 'true');
        localStorage.setItem('datacore_user_id', teamUser.id);
        localStorage.setItem('datacore_user_profile', JSON.stringify(teamUser));
      } catch (err) {
        console.error('Erro ao restaurar sessão:', err);
      }
    };

    // Restore an existing session on page load (refresh, new tab, etc.). A stale
    // "datacore_auth_active" flag from before Fase 4 (or any tampering) with no
    // real session behind it must NOT leave the app looking logged in. A
    // recovery-link session is left alone here — ResetPasswordScreen handles it.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user && !isRecoveryLink) {
        applySession(session.user.id);
      } else if (!session?.user) {
        setIsAuthenticated(false);
        localStorage.removeItem('datacore_auth_active');
        localStorage.removeItem('datacore_user_id');
        localStorage.removeItem('datacore_user_profile');
      }
    });

    // Keep in sync with sign-in/out happening in this tab (login form, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecoveryMode(true);
      } else if (event === 'SIGNED_IN' && session?.user && !isRecoveryLink) {
        applySession(session.user.id);
      } else if (event === 'SIGNED_OUT') {
        setIsAuthenticated(false);
        localStorage.removeItem('datacore_auth_active');
        localStorage.removeItem('datacore_user_id');
        localStorage.removeItem('datacore_user_profile');
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Called by ResetPasswordScreen after the new password is saved — now safe to
  // log the (already-authenticated-via-recovery) user into the app normally.
  const handlePasswordSet = () => {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    setPasswordRecoveryMode(false);
    if (supabase) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) {
          fetchUsuarioPorAuthId(session.user.id).then(usuarioRow => {
            if (!usuarioRow) return;
            const teamUser = mapUsuarioRowToTeamUser(usuarioRow);
            setCurrentUser(teamUser);
            setCurrentRole(teamUser.role);
            setIsAuthenticated(true);
            localStorage.setItem('datacore_auth_active', 'true');
            localStorage.setItem('datacore_user_id', teamUser.id);
            localStorage.setItem('datacore_user_profile', JSON.stringify(teamUser));
          });
        }
      });
    }
  };

  // Core Data States
  // Pipelines only exist once a real Auto Pipeline integration creates one — no demo/mock seed here.
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>('');
  const [logs, setLogs] = useState(INITIAL_LOGS);
  const [alertRules, setAlertRules] = useState(INITIAL_ALERT_RULES);
  const [incidents, setIncidents] = useState(INITIAL_INCIDENTS);
  const [lgpdRequests, setLgpdRequests] = useState(INITIAL_LGPD_REQUESTS);
  const [finops, setFinops] = useState(INITIAL_FINOPS);
  const [users, setUsers] = useState(INITIAL_USERS);

  // Auto Pipeline Connectors and Integrations State
  const [sources, setSources] = useState<SourceConnectorConfig[]>(INITIAL_SOURCES);
  const [destinations, setDestinations] = useState<DestinationConnectorConfig[]>(INITIAL_DESTINATIONS);
  const [integrations, setIntegrations] = useState<AutoIntegration[]>(INITIAL_INTEGRATIONS);

  // Empresa's own Airbyte workspace (Fase 3 — isolates each tenant's connectors
  // from every other tenant's). Null until resolved, which still works: the
  // gateway falls back to its single shared workspace.
  const [airbyteWorkspaceId, setAirbyteWorkspaceId] = useState<string | null>(null);

  // Loads origens/destinos/integrações persistidos no Supabase para a empresa do
  // usuário logado, para que sobrevivam a um refresh (antes só existiam em memória).
  // Uses a ref (not state) as the guard: React.StrictMode double-invokes effects in
  // dev, and a state-based guard isn't committed in time to stop the second call,
  // which duplicated every persisted row in the UI (each fetch prepended its own copy).
  const hasLoadedEmpresaDataRef = useRef(false);
  useEffect(() => {
    const idEmpresa = currentUser.idEmpresa;
    if (!isSupabaseConfigured() || !idEmpresa || hasLoadedEmpresaDataRef.current) return;

    hasLoadedEmpresaDataRef.current = true;

    fetchEmpresaPorId(idEmpresa)
      .then(empresa => setAirbyteWorkspaceId(empresa?.airbyteWorkspaceId || null))
      .catch(err => console.error('Erro ao buscar o workspace Airbyte da empresa:', err));

    Promise.all([
      fetchOrigensPorEmpresa(idEmpresa),
      fetchDestinosPorEmpresa(idEmpresa),
      fetchIntegracoesPorEmpresa(idEmpresa),
    ])
      .then(async ([persistedSources, persistedDestinations, persistedIntegrations]) => {
        if (persistedSources.length) setSources(prev => [...persistedSources, ...prev]);
        if (persistedDestinations.length) setDestinations(prev => [...persistedDestinations, ...prev]);
        if (persistedIntegrations.length) setIntegrations(prev => [...persistedIntegrations, ...prev]);
        if (!persistedIntegrations.length) return;

        // Reconstruct each integration's Studio canvas deterministically (never a
        // stored blob — see buildPipelineFromIntegration) so pipelines survive a
        // refresh instead of only existing for the session that created them.
        const persistedPipelines = await fetchPipelinesPorEmpresa(idEmpresa);
        const pipelineByIntegracaoId = new Map<number, PipelineDbRecord>(
          persistedPipelines.map(p => [p.integracaoId, p])
        );

        const rebuilt: Pipeline[] = [];
        for (const integration of persistedIntegrations) {
          const source = persistedSources.find(s => s.id === integration.sourceConnectorId);
          const destination = persistedDestinations.find(d => d.id === integration.destinationConnectorId);
          if (!source || !destination) continue;

          const integracaoDbId = Number(integration.id);
          let record = pipelineByIntegracaoId.get(integracaoDbId);
          if (!record) {
            // Backfill: integrações persistidas antes da tabela "pipelines" existir
            // (ou cujo insert falhou na criação) ainda não têm essa linha — cria agora.
            try {
              const newId = await persistPipeline(idEmpresa, integracaoDbId, {
                name: integration.name,
                category: 'Integração Automática Lakehouse',
              });
              record = { id: newId, integracaoId: integracaoDbId, layoutOverrides: {} };
            } catch (err) {
              console.error('Erro ao criar registro de pipeline retroativo:', err);
              continue;
            }
          }

          let pipeline = buildPipelineFromIntegration(`pipe-${record.id}`, integration, source, destination, record.id);

          // Fase 2: overlay real Airbyte sync history onto the deterministic
          // canvas — best-effort, a pipeline with no real connection yet (or a
          // gateway hiccup) just keeps its honest "nothing synced" defaults.
          if (integration.airbyteConnectionId) {
            try {
              pipeline = await refreshPipelineMetrics(idEmpresa, record.id, integration.airbyteConnectionId, pipeline);
            } catch (err) {
              console.error(`Erro ao buscar métricas reais do pipeline "${pipeline.name}":`, err);
            }
          }

          rebuilt.push(pipeline);
        }

        if (rebuilt.length) setPipelines(prev => [...rebuilt, ...prev]);
      })
      .catch(err => console.error('Erro ao carregar dados persistidos da empresa:', err));
  }, [currentUser.idEmpresa]);

  // Derived role permissions
  const roleDef = ROLE_DEFINITIONS[currentRole] || ROLE_DEFINITIONS.admin;
  const permissions = roleDef.permissions;

  const currentPipeline = pipelines.find(p => p.id === selectedPipelineId) || pipelines[0];

  // Pipeline handlers
  const handleUpdatePipeline = (updated: Pipeline) => {
    setPipelines(prev => prev.map(p => p.id === updated.id ? updated : p));
  };

  const handleSelectPipeline = (pipeline: Pipeline) => {
    setSelectedPipelineId(pipeline.id);
    setActiveTab('studio');
  };

  const handleTogglePipelineStatus = (pipelineId: string) => {
    const pipeline = pipelines.find(p => p.id === pipelineId);
    if (!pipeline) return;
    const nextStatus = pipeline.status === 'active' ? 'paused' : 'active';

    setPipelines(prev => prev.map(p => (p.id === pipelineId ? { ...p, status: nextStatus } : p)));

    // Best-effort: pause/resume the real Airbyte schedule and persist the flag —
    // the UI above already reflects success regardless of this outcome. Pausing
    // only "integracoes.status" in Supabase would NOT stop Airbyte from running
    // the sync on schedule, so the Airbyte call is the one that actually matters.
    const integration = integrations.find(i => i.pipelineId === pipelineId);
    if (!integration) return;
    setIntegrations(prev => prev.map(i => (i.pipelineId === pipelineId ? { ...i, status: nextStatus } : i)));

    (async () => {
      try {
        if (integration.airbyteConnectionId) {
          await updateAirbyteConnectionStatus(integration.airbyteConnectionId, nextStatus === 'active' ? 'active' : 'inactive');
        }
        const integracaoDbId = Number(integration.id);
        if (Number.isFinite(integracaoDbId)) {
          await updateIntegracaoStatus(integracaoDbId, nextStatus);
        }
      } catch (err) {
        console.error('Erro ao pausar/retomar a integração no Airbyte/banco:', err);
      }
    })();
  };

  const handleTriggerRun = (pipelineId: string) => {
    const pipe = pipelines.find(p => p.id === pipelineId);
    if (!pipe) return;

    // Add log
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];
    const newLog = {
      id: `log-${Date.now()}`,
      timestamp: timeStr,
      pipelineId,
      pipelineName: pipe.name,
      level: 'info' as const,
      message: `Execução manual disparada por "${currentRole}". Processamento distribuído iniciado.`
    };
    setLogs(prev => [newLog, ...prev]);

    // Update records processed
    setPipelines(prev => prev.map(p => {
      if (p.id === pipelineId) {
        return {
          ...p,
          recordsProcessedToday: p.recordsProcessedToday + 15000,
          lastRunAt: 'Agora mesmo'
        };
      }
      return p;
    }));
  };

  const handleDeletePipeline = (pipeline: Pipeline) => {
    // Remove da UI já (otimista) — o pipeline e seus runs somem por cascade no banco.
    setPipelines(prev => prev.filter(p => p.id !== pipeline.id));
    setIntegrations(prev => prev.filter(i =>
      i.pipelineId !== pipeline.id &&
      (pipeline.integrationId === undefined || i.id !== String(pipeline.integrationId))
    ));
    if (selectedPipelineId === pipeline.id) setSelectedPipelineId('');

    if (pipeline.integrationId !== undefined) {
      deletarIntegracao(pipeline.integrationId).catch(err =>
        console.error('Erro ao excluir a integração no banco:', err)
      );
    }
  };

  const handleCreatePipeline = (newPipe: Pipeline) => {
    setPipelines(prev => [newPipe, ...prev]);
    setSelectedPipelineId(newPipe.id);
    setActiveTab('studio');
  };

  // Auto Pipeline handlers
  const handleAddSource = (source: SourceConnectorConfig) => {
    setSources(prev => [source, ...prev]);
  };

  const handleAddDestination = (destination: DestinationConnectorConfig) => {
    setDestinations(prev => [destination, ...prev]);
  };

  const handleCreateAutoIntegration = (integration: AutoIntegration, generatedPipeline: Pipeline) => {
    setPipelines(prev => [generatedPipeline, ...prev]);
    setSelectedPipelineId(generatedPipeline.id);
    setIntegrations(prev => [integration, ...prev]);
  };

  const handleNavigateToStudio = (pipelineId: string) => {
    setSelectedPipelineId(pipelineId);
    setActiveTab('studio');
  };

  // Monitoring handlers
  const handleToggleAlertRule = (ruleId: string) => {
    setAlertRules(prev => prev.map(r => r.id === ruleId ? { ...r, enabled: !r.enabled } : r));
  };

  const handleAddAlertRule = (rule: AlertRule) => {
    setAlertRules(prev => [rule, ...prev]);
  };

  const handleResolveIncident = (incidentId: string) => {
    setIncidents(prev => prev.map(i => i.id === incidentId ? { ...i, status: 'resolved' as const } : i));
  };

  const handleAcknowledgeIncident = (incidentId: string) => {
    setIncidents(prev => prev.map(i => i.id === incidentId ? { ...i, status: 'acknowledged' as const } : i));
  };

  // LGPD Request handlers
  const handleUpdateLgpdRequestStatus = (requestId: string, newStatus: LGPDRequest['status']) => {
    setLgpdRequests(prev => prev.map(r => r.id === requestId ? { ...r, status: newStatus } : r));
    // Add audit log
    const now = new Date();
    const newLog = {
      id: `log-${Date.now()}`,
      timestamp: now.toTimeString().split(' ')[0],
      pipelineId: 'lgpd-governance',
      pipelineName: 'Módulo de Governança LGPD',
      level: 'security' as const,
      message: `Auditoria DPO: Requisição ${requestId} atualizada para o status "${newStatus}" com integridade criptográfica.`
    };
    setLogs(prev => [newLog, ...prev]);
  };

  // FinOps recommendation apply
  const handleApplyFinOpsRecommendation = (recId: string) => {
    setFinops(prev => ({
      ...prev,
      recommendations: prev.recommendations.map(r => r.id === recId ? { ...r, applied: true } : r)
    }));
  };

  // RBAC User handlers
  const handleUpdateUserRole = (userId: string, newRole: UserRole) => {
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
  };

  const handleToggleUserRawPII = (userId: string) => {
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, canViewUnmaskedPII: !u.canViewUnmaskedPII } : u));
  };

  // Login & Logout Handlers
  const handleLogin = (user: TeamUser, role: UserRole) => {
    setCurrentUser(user);
    setCurrentRole(role);
    setIsAuthenticated(true);
    setActiveTab('pipelines');
    localStorage.setItem('datacore_auth_active', 'true');
    localStorage.setItem('datacore_user_id', user.id);
    localStorage.setItem('datacore_user_profile', JSON.stringify(user));
  };

  const handleLogout = async () => {
    try {
      await logoutFromSupabase();
    } catch (err) {
      console.error('Erro ao encerrar sessão no Supabase:', err);
    }
    setIsAuthenticated(false);
    localStorage.removeItem('datacore_auth_active');
    localStorage.removeItem('datacore_user_id');
    localStorage.removeItem('datacore_user_profile');
  };

  // Handler when a user is successfully registered
  const handleUserCreated = (newUser: TeamUser) => {
    setUsers(prev => {
      const exists = prev.some(u => u.email.toLowerCase() === newUser.email.toLowerCase());
      if (exists) return prev;
      return [newUser, ...prev];
    });
  };

  if (passwordRecoveryMode) {
    return <ResetPasswordScreen onPasswordSet={handlePasswordSet} />;
  }

  if (!isAuthenticated) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  const activeCount = pipelines.filter(p => p.status === 'active').length;
  const openIncidentsCount = incidents.filter(i => i.status !== 'resolved').length;
  const pendingDsrCount = lgpdRequests.filter(r => r.status === 'pendente' || r.status === 'em_analise').length;

  return (
    <div id="app-root" className="h-screen bg-[#f8fafc] text-slate-900 flex flex-col font-sans selection:bg-indigo-600 selection:text-white pt-14 overflow-hidden">
      {/* Top Header (Fixed at top) */}
      <Header
        currentRole={currentRole}
        onChangeRole={setCurrentRole}
        activePipelinesCount={activeCount}
        totalPipelinesCount={pipelines.length}
        currentUser={currentUser}
        onLogout={handleLogout}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left Sidebar */}
        <Sidebar
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          openIncidentsCount={openIncidentsCount}
          pendingDsrCount={pendingDsrCount}
        />

        {/* Dynamic Center Stage */}
        <main className="flex-1 p-4 sm:p-6 overflow-y-auto bg-[#f8fafc] flex flex-col justify-between min-h-0">
          <div>
            {activeTab === 'studio' && (
              <div className="space-y-4">
                {/* Studio Pipeline Header with Combobox and Pipeline Automático Action */}
                <StudioPipelineHeader
                  pipelines={pipelines}
                  selectedPipelineId={selectedPipelineId}
                  onSelectPipeline={(id) => setSelectedPipelineId(id)}
                  onNavigateToAutoPipeline={() => setActiveTab('auto-pipeline')}
                  canCreate={permissions.canCreatePipelines}
                  onToggleStatus={handleTogglePipelineStatus}
                />

                {/* Visual Studio Node Canvas (only once a real pipeline exists/is selected) */}
                {currentPipeline ? (
                  <VisualCanvas
                    pipeline={currentPipeline}
                    onUpdatePipeline={handleUpdatePipeline}
                    canEdit={permissions.canEditPipelines}
                    canExecute={permissions.canTriggerExecutions}
                    canViewRawPII={permissions.canViewRawPII}
                    idEmpresa={currentUser.idEmpresa}
                  />
                ) : (
                  <div className="bg-white border border-slate-200 rounded-xl p-16 text-center text-slate-500 space-y-3 shadow-sm">
                    <Layers className="w-10 h-10 text-slate-300 mx-auto" />
                    <h4 className="text-base font-semibold text-slate-800">Nenhum pipeline criado ainda</h4>
                    <p className="text-xs text-slate-500 max-w-md mx-auto">
                      Crie sua primeira integração no Pipeline Automático para gerar um pipeline e visualizá-lo aqui no Studio Visual ETL.
                    </p>
                    {permissions.canCreatePipelines && (
                      <button
                        onClick={() => setActiveTab('auto-pipeline')}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-sm transition cursor-pointer"
                      >
                        <Wand2 className="w-4 h-4" />
                        Novo Pipeline Automático
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'auto-pipeline' && (
              <AutoPipelineView
                sources={sources}
                destinations={destinations}
                integrations={integrations}
                idEmpresa={currentUser.idEmpresa ?? null}
                airbyteWorkspaceId={airbyteWorkspaceId}
                onAddSource={handleAddSource}
                onAddDestination={handleAddDestination}
                onCreateIntegration={handleCreateAutoIntegration}
                onNavigateToStudio={handleNavigateToStudio}
                canCreate={permissions.canCreatePipelines}
              />
            )}

            {activeTab === 'pipelines' && (
              <PipelinesOverview
                pipelines={pipelines}
                onSelectPipeline={handleSelectPipeline}
                onToggleStatus={handleTogglePipelineStatus}
                onTriggerRun={handleTriggerRun}
                onDeletePipeline={handleDeletePipeline}
                onCreatePipeline={handleCreatePipeline}
                onNavigateToAutoPipeline={() => setActiveTab('auto-pipeline')}
                canCreate={permissions.canCreatePipelines}
                canEdit={permissions.canEditPipelines}
                canTrigger={permissions.canTriggerExecutions}
              />
            )}

            {activeTab === 'execucoes' && (
              <ExecutionsView
                pipelines={pipelines}
                onNavigateToStudio={handleNavigateToStudio}
                idEmpresa={currentUser.idEmpresa}
              />
            )}

            {activeTab === 'governance' && (
              <LgpdHub
                requests={lgpdRequests}
                onUpdateRequestStatus={handleUpdateLgpdRequestStatus}
                canConfigureLGPDRules={permissions.canConfigureLGPDRules}
                canViewRawPII={permissions.canViewRawPII}
              />
            )}

            {activeTab === 'finops' && (
              <CostAnalytics
                finops={finops}
                onApplyRecommendation={handleApplyFinOpsRecommendation}
                canViewFinOps={permissions.canViewFinOps}
              />
            )}

            {activeTab === 'rbac' && (
              <RbacManager
                users={users}
                onUpdateUserRole={handleUpdateUserRole}
                onToggleUserRawPII={handleToggleUserRawPII}
                canManageUsers={permissions.canManageUsers}
                onNavigateToCadastro={() => setActiveTab('cadastro-usuario')}
              />
            )}

            {activeTab === 'cadastro-usuario' && (
              <CadastroUsuarioView
                onCancel={() => setActiveTab('rbac')}
                onUserCreated={(newUser) => {
                  handleUserCreated(newUser);
                  setActiveTab('rbac');
                }}
                canManageUsers={permissions.canManageUsers}
              />
            )}

            {activeTab === 'empresas' && (
              <EmpresasView canManage={permissions.canManageUsers} />
            )}
          </div>
        </main>
      </div>

      {/* Enterprise Status Footer */}
      <footer id="app-footer" className="h-8 bg-slate-900 text-slate-300 flex items-center justify-between px-6 shrink-0 text-[11px] font-medium hidden md:flex border-t border-slate-800 z-30">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            Sistemas Operacionais (100%)
          </span>
          <span className="text-slate-600">|</span>
          <span className="text-slate-400">
            Conformidade LGPD: <strong className="text-white">Art. 7º & 46 Auditados</strong>
          </span>
        </div>
        <div className="flex items-center gap-4 text-slate-400">
          <span>Worker Pods: <strong className="text-slate-200 font-mono">18 Ativos</strong></span>
          <span className="text-slate-600">|</span>
          <span>DataCore &copy; 2026</span>
        </div>
      </footer>

      {/* Mobile Bottom Navigation Bar */}
      <nav id="mobile-nav" className="md:hidden bg-white border-t border-slate-200 px-2 py-2 flex items-center justify-around z-30">
        <button
          onClick={() => setActiveTab('studio')}
          className={`flex flex-col items-center gap-1 text-[10px] ${activeTab === 'studio' ? 'text-indigo-600 font-bold' : 'text-slate-500'}`}
        >
          <Network className="w-4 h-4" />
          <span>Studio</span>
        </button>
        <button
          onClick={() => setActiveTab('auto-pipeline')}
          className={`flex flex-col items-center gap-1 text-[10px] ${activeTab === 'auto-pipeline' ? 'text-indigo-600 font-bold' : 'text-slate-500'}`}
        >
          <Wand2 className="w-4 h-4" />
          <span>Auto</span>
        </button>
        <button
          onClick={() => setActiveTab('pipelines')}
          className={`flex flex-col items-center gap-1 text-[10px] ${activeTab === 'pipelines' ? 'text-indigo-600 font-bold' : 'text-slate-500'}`}
        >
          <Layers className="w-4 h-4" />
          <span>Pipelines</span>
        </button>
        <button
          onClick={() => setActiveTab('monitoring')}
          className={`flex flex-col items-center gap-1 text-[10px] ${activeTab === 'monitoring' ? 'text-indigo-600 font-bold' : 'text-slate-500'}`}
        >
          <Activity className="w-4 h-4" />
          <span>Monitor</span>
        </button>
        <button
          onClick={() => setActiveTab('governance')}
          className={`flex flex-col items-center gap-1 text-[10px] ${activeTab === 'governance' ? 'text-emerald-600 font-bold' : 'text-slate-500'}`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>LGPD</span>
        </button>
        <button
          onClick={() => setActiveTab('finops')}
          className={`flex flex-col items-center gap-1 text-[10px] ${activeTab === 'finops' ? 'text-amber-600 font-bold' : 'text-slate-500'}`}
        >
          <DollarSign className="w-4 h-4" />
          <span>Custos</span>
        </button>
        <button
          onClick={() => setActiveTab('rbac')}
          className={`flex flex-col items-center gap-1 text-[10px] ${activeTab === 'rbac' ? 'text-indigo-600 font-bold' : 'text-slate-500'}`}
        >
          <Lock className="w-4 h-4" />
          <span>RBAC</span>
        </button>
      </nav>
    </div>
  );
}

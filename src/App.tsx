import React, { useState, useEffect, useRef } from 'react';
import {
  INITIAL_LOGS, INITIAL_ALERT_RULES,
  INITIAL_INCIDENTS, INITIAL_LGPD_REQUESTS,
  INITIAL_USERS, ROLE_DEFINITIONS,
  INITIAL_SOURCES, INITIAL_DESTINATIONS, INITIAL_INTEGRATIONS
} from './data/initialData';
import { 
  Pipeline, UserRole, AlertRule, LGPDRequest, 
  SourceConnectorConfig, DestinationConnectorConfig, AutoIntegration, TeamUser
} from './types';
import { Header } from './components/Header';
import { Sidebar, ActiveTab } from './components/Sidebar';
import { DataChatView } from './components/DataChat/DataChatView';
import { StudioGoldView } from './components/StudioGold/StudioGoldView';
import { AutoPipelineView } from './components/AutoPipeline/AutoPipelineView';
import { PipelinesOverview } from './components/PipelinesList/PipelinesOverview';
import { ExecutionsView } from './components/Executions/ExecutionsView';
import { ExecutionJobsProvider } from './components/Executions/ExecutionJobsProvider';
import { LgpdHub } from './components/Governance/LgpdHub';
import { CostAnalytics } from './components/FinOps/CostAnalytics';
import { RbacManager } from './components/Security/RbacManager';
import { AdministracaoView, AdminSection } from './components/Admin/AdministracaoView';
import { LoginScreen } from './components/Auth/LoginScreen';
import { ResetPasswordScreen } from './components/Auth/ResetPasswordScreen';
import { Workflow, Layers, Activity, ShieldCheck, DollarSign, Lock, Play, Wand2 } from 'lucide-react';
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
  const [adminSection, setAdminSection] = useState<AdminSection>('usuarios');
  const [sessionExpiredNotice, setSessionExpiredNotice] = useState<string | null>(null);
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
  const [logs, setLogs] = useState(INITIAL_LOGS);
  const [alertRules, setAlertRules] = useState(INITIAL_ALERT_RULES);
  const [incidents, setIncidents] = useState(INITIAL_INCIDENTS);
  const [lgpdRequests, setLgpdRequests] = useState(INITIAL_LGPD_REQUESTS);
  const [users, setUsers] = useState(INITIAL_USERS);

  // Auto Pipeline Connectors and Integrations State
  const [sources, setSources] = useState<SourceConnectorConfig[]>(INITIAL_SOURCES);
  const [destinations, setDestinations] = useState<DestinationConnectorConfig[]>(INITIAL_DESTINATIONS);
  const [integrations, setIntegrations] = useState<AutoIntegration[]>(INITIAL_INTEGRATIONS);
  // Integração aberta no modo edição da tela Pipeline Automático (botão Editar em
  // Pipelines & Fluxos). Null = assistente no modo cadastro.
  const [editingIntegration, setEditingIntegration] = useState<AutoIntegration | null>(null);

  // Empresa's own Airbyte workspace (Fase 3 — isolates each tenant's connectors
  // from every other tenant's). Null until resolved, which still works: the
  // gateway falls back to its single shared workspace.
  const [airbyteWorkspaceId, setAirbyteWorkspaceId] = useState<string | null>(null);

  // Enquanto true, a tela de Pipelines mostra um estado de carregamento em vez
  // de "Nenhum pipeline criado ainda" — sem isso, o usuário via essa mensagem
  // por alguns segundos toda vez que a busca real (Supabase + Airbyte) ainda
  // estava em andamento, achando que a conta não tinha pipelines de verdade.
  const [isLoadingEmpresaData, setIsLoadingEmpresaData] = useState(false);

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
    setIsLoadingEmpresaData(true);

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
      .catch(err => console.error('Erro ao carregar dados persistidos da empresa:', err))
      .finally(() => setIsLoadingEmpresaData(false));
  }, [currentUser.idEmpresa]);

  // Derived role permissions
  const roleDef = ROLE_DEFINITIONS[currentRole] || ROLE_DEFINITIONS.admin;
  const permissions = roleDef.permissions;

  // Pipeline handlers
  const handleUpdatePipeline = (updated: Pipeline) => {
    setPipelines(prev => prev.map(p => p.id === updated.id ? updated : p));
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

    if (pipeline.integrationId !== undefined) {
      deletarIntegracao(pipeline.integrationId).catch(err =>
        console.error('Erro ao excluir a integração no banco:', err)
      );
    }
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
    setIntegrations(prev => [integration, ...prev]);
  };

  // A integração por trás de um pipeline: pelo id do banco (pipelines recarregados)
  // ou pelo pipelineId (integração criada nesta sessão, ainda com id local).
  const findIntegrationForPipeline = (pipeline: Pipeline): AutoIntegration | undefined =>
    (pipeline.integrationId !== undefined ? integrations.find(i => i.id === String(pipeline.integrationId)) : undefined)
    || integrations.find(i => i.pipelineId === pipeline.id);

  // Sair da tela Pipeline Automático encerra a edição — ao voltar pelo menu, o
  // assistente abre no modo cadastro.
  useEffect(() => {
    if (activeTab !== 'auto-pipeline') setEditingIntegration(null);
  }, [activeTab]);

  const handleEditPipeline = (pipeline: Pipeline) => {
    const integration = findIntegrationForPipeline(pipeline);
    if (!integration) return;
    setEditingIntegration(integration);
    setActiveTab('auto-pipeline');
  };

  // Depois de salvar a edição: atualiza a integração e reconstrói o pipeline dela
  // (topologia derivada da lista de tabelas — ver buildPipelineFromIntegration),
  // mantendo o mesmo id/dbId para não perder o vínculo com pipeline_runs.
  const handleIntegrationEdited = (updated: AutoIntegration) => {
    setIntegrations(prev => prev.map(i => (i.id === updated.id ? updated : i)));
    const oldPipeline = pipelines.find(p =>
      (p.integrationId !== undefined && String(p.integrationId) === updated.id) || p.id === updated.pipelineId
    );
    const source = sources.find(s => s.id === updated.sourceConnectorId);
    const destination = destinations.find(d => d.id === updated.destinationConnectorId);
    if (!oldPipeline || !source || !destination) return;
    const rebuilt = buildPipelineFromIntegration(oldPipeline.id, updated, source, destination, oldPipeline.dbId);
    setPipelines(prev => prev.map(p => (p.id === oldPipeline.id ? { ...rebuilt, status: oldPipeline.status } : p)));
    const idEmpresa = currentUser.idEmpresa;
    if (idEmpresa && oldPipeline.dbId && updated.airbyteConnectionId) {
      refreshPipelineMetrics(idEmpresa, oldPipeline.dbId, updated.airbyteConnectionId, rebuilt)
        .then(withMetrics => setPipelines(prev => prev.map(p => (p.id === oldPipeline.id ? { ...withMetrics, status: oldPipeline.status } : p))))
        .catch(err => console.error('Erro ao atualizar as métricas do pipeline editado:', err));
    }
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
    setSessionExpiredNotice(null);
    localStorage.setItem('datacore_auth_active', 'true');
    localStorage.setItem('datacore_user_id', user.id);
    localStorage.setItem('datacore_user_profile', JSON.stringify(user));
  };

  const handleLogout = async (reason?: 'inactivity') => {
    try {
      await logoutFromSupabase();
    } catch (err) {
      console.error('Erro ao encerrar sessão no Supabase:', err);
    }
    setIsAuthenticated(false);
    localStorage.removeItem('datacore_auth_active');
    localStorage.removeItem('datacore_user_id');
    localStorage.removeItem('datacore_user_profile');
    setSessionExpiredNotice(reason === 'inactivity' ? 'Sua sessão expirou por inatividade. Faça login novamente.' : null);
  };

  // Encerra a sessão automaticamente após 30min sem nenhuma interação do usuário
  // (mouse, teclado, toque ou rolagem) — evita uma sessão autenticada aberta
  // indefinidamente numa máquina sem supervisão.
  useEffect(() => {
    if (!isAuthenticated) return;
    const INACTIVITY_LIMIT_MS = 30 * 60 * 1000;
    let timeoutId: ReturnType<typeof setTimeout>;
    let lastReset = 0;

    const scheduleLogout = () => {
      timeoutId = setTimeout(() => { void handleLogout('inactivity'); }, INACTIVITY_LIMIT_MS);
    };

    // Throttlado: reagir a todo mousemove/scroll reiniciaria o timer a uma taxa
    // muito maior do que necessário para apenas marcar "houve atividade".
    const onActivity = () => {
      const now = Date.now();
      if (now - lastReset < 1000) return;
      lastReset = now;
      clearTimeout(timeoutId);
      scheduleLogout();
    };

    const events: Array<keyof WindowEventMap> = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((evt) => window.addEventListener(evt, onActivity, { passive: true }));
    scheduleLogout();

    return () => {
      clearTimeout(timeoutId);
      events.forEach((evt) => window.removeEventListener(evt, onActivity));
    };
  }, [isAuthenticated]);

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
    return <LoginScreen onLogin={handleLogin} sessionExpiredNotice={sessionExpiredNotice} />;
  }

  const openIncidentsCount = incidents.filter(i => i.status !== 'resolved').length;
  const pendingDsrCount = lgpdRequests.filter(r => r.status === 'pendente' || r.status === 'em_analise').length;

  return (
    <ExecutionJobsProvider>
    <div id="app-root" className="h-screen bg-[#f8fafc] text-slate-900 flex flex-col font-sans selection:bg-indigo-600 selection:text-white pt-14 overflow-hidden">
      {/* Top Header (Fixed at top) */}
      <Header
        currentRole={currentRole}
        onChangeRole={setCurrentRole}
        currentUser={currentUser}
        onLogout={handleLogout}
        onLogoClick={() => setActiveTab('pipelines')}
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
            {activeTab === 'studio-gold' && (
              <StudioGoldView
                pipelines={pipelines}
                idEmpresa={currentUser.idEmpresa ?? null}
                canExecute={permissions.canTriggerExecutions}
                userName={currentUser.name}
              />
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
                onUpdatePipeline={handleUpdatePipeline}
                canCreate={permissions.canCreatePipelines}
                editIntegration={editingIntegration}
                userName={currentUser.name}
                onIntegrationEdited={handleIntegrationEdited}
                onExitEdit={(goTo) => {
                  setEditingIntegration(null);
                  if (goTo === 'pipelines') setActiveTab('pipelines');
                }}
              />
            )}

            {activeTab === 'pipelines' && (
              <PipelinesOverview
                pipelines={pipelines}
                isLoading={isLoadingEmpresaData}
                onToggleStatus={handleTogglePipelineStatus}
                onTriggerRun={handleTriggerRun}
                onDeletePipeline={handleDeletePipeline}
                onEditPipeline={permissions.canEditPipelines ? handleEditPipeline : undefined}
                isEditablePipeline={(p) => Boolean(findIntegrationForPipeline(p)?.airbyteConnectionId)}
                integrationForPipeline={(p) => {
                  const integ = findIntegrationForPipeline(p);
                  if (!integ) return undefined;
                  const dbId = /^\d+$/.test(integ.id) ? Number(integ.id) : p.integrationId ?? null;
                  return { id: dbId, name: integ.name, airbyteConnectionId: integ.airbyteConnectionId ?? null };
                }}
                userName={currentUser.name}
                canResolveAlerts={permissions.canTriggerExecutions}
                onNavigateToAutoPipeline={() => { setEditingIntegration(null); setActiveTab('auto-pipeline'); }}
                canCreate={permissions.canCreatePipelines}
                canEdit={permissions.canEditPipelines}
                canTrigger={permissions.canTriggerExecutions}
              />
            )}

            {activeTab === 'execucoes' && (
              <ExecutionsView userName={currentUser.name} canResolveAlerts={permissions.canTriggerExecutions} />
            )}

            {activeTab === 'chat-dados' && (
              <DataChatView
                idEmpresa={currentUser.idEmpresa ?? null}
                canEditModels={permissions.canEditPipelines}
              />
            )}

            {activeTab === 'governance' && (
              <LgpdHub
                requests={lgpdRequests}
                onUpdateRequestStatus={handleUpdateLgpdRequestStatus}
                canConfigureLGPDRules={permissions.canConfigureLGPDRules}
                canViewRawPII={permissions.canViewRawPII}
                pipelines={pipelines}
              />
            )}

            {activeTab === 'finops' && (
              <CostAnalytics
                canViewFinOps={permissions.canViewFinOps}
                idEmpresa={currentUser.idEmpresa}
              />
            )}

            {activeTab === 'rbac' && (
              <RbacManager
                users={users}
                onUpdateUserRole={handleUpdateUserRole}
                onToggleUserRawPII={handleToggleUserRawPII}
                canManageUsers={permissions.canManageUsers}
                onNavigateToCadastro={() => {
                  setAdminSection('cadastrar-usuario');
                  setActiveTab('administracao');
                }}
              />
            )}

            {activeTab === 'administracao' && (
              <AdministracaoView
                section={adminSection}
                onSelectSection={setAdminSection}
                canManage={permissions.canManageUsers}
                currentUserEmail={currentUser.email}
                onUserCreated={handleUserCreated}
              />
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
          onClick={() => setActiveTab('studio-gold')}
          className={`flex flex-col items-center gap-1 text-[10px] ${activeTab === 'studio-gold' ? 'text-indigo-600 font-bold' : 'text-slate-500'}`}
        >
          <Workflow className="w-4 h-4" />
          <span>Studio Gold</span>
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
    </ExecutionJobsProvider>
  );
}

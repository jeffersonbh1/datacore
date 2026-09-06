import React, { useState, useEffect } from 'react';
import { 
  INITIAL_PIPELINES, INITIAL_LOGS, INITIAL_ALERT_RULES, 
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
import { LgpdHub } from './components/Governance/LgpdHub';
import { CostAnalytics } from './components/FinOps/CostAnalytics';
import { RbacManager } from './components/Security/RbacManager';
import { CadastroUsuarioView } from './components/Security/CadastroUsuarioView';
import { LoginScreen } from './components/Auth/LoginScreen';
import { Network, Layers, Activity, ShieldCheck, DollarSign, Lock, Play, Wand2 } from 'lucide-react';
import { isSupabaseConfigured, supabase, mapSupabaseUserToTeamUser, logoutFromSupabase } from './lib/supabase';

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

  // Supabase Auth State Listener & Session Synchronization
  useEffect(() => {
    if (!isSupabaseConfigured() || !supabase) return;

    // Check active session on initial load
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        const teamUser = mapSupabaseUserToTeamUser(session.user);
        setCurrentUser(teamUser);
        setCurrentRole(teamUser.role);
        setIsAuthenticated(true);
        setActiveTab('pipelines');
        localStorage.setItem('datacore_auth_active', 'true');
        localStorage.setItem('datacore_user_id', teamUser.id);
      }
    });

    // Listen for real-time auth changes (sign in, sign out, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        const teamUser = mapSupabaseUserToTeamUser(session.user);
        setCurrentUser(teamUser);
        setCurrentRole(teamUser.role);
        setIsAuthenticated(true);
        setActiveTab('pipelines');
        localStorage.setItem('datacore_auth_active', 'true');
        localStorage.setItem('datacore_user_id', teamUser.id);
      } else if (event === 'SIGNED_OUT') {
        setIsAuthenticated(false);
        localStorage.removeItem('datacore_auth_active');
        localStorage.removeItem('datacore_user_id');
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Core Data States
  const [pipelines, setPipelines] = useState<Pipeline[]>(INITIAL_PIPELINES);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>(INITIAL_PIPELINES[0].id);
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
    setPipelines(prev => prev.map(p => {
      if (p.id === pipelineId) {
        const nextStatus = p.status === 'active' ? 'paused' : 'active';
        return { ...p, status: nextStatus };
      }
      return p;
    }));
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

                {/* Visual Studio Node Canvas */}
                <VisualCanvas
                  pipeline={currentPipeline}
                  onUpdatePipeline={handleUpdatePipeline}
                  canEdit={permissions.canEditPipelines}
                  canExecute={permissions.canTriggerExecutions}
                  canViewRawPII={permissions.canViewRawPII}
                />
              </div>
            )}

            {activeTab === 'auto-pipeline' && (
              <AutoPipelineView
                sources={sources}
                destinations={destinations}
                integrations={integrations}
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
                onCreatePipeline={handleCreatePipeline}
                onNavigateToAutoPipeline={() => setActiveTab('auto-pipeline')}
                canCreate={permissions.canCreatePipelines}
                canEdit={permissions.canEditPipelines}
                canTrigger={permissions.canTriggerExecutions}
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

import React, { useState, useEffect } from 'react';
import { 
  Activity, Bell, AlertTriangle, ShieldCheck, CheckCircle, RefreshCw, 
  Slack, Mail, PhoneCall, Globe, Plus, Trash2, Filter, Terminal, 
  Play, Pause, Flame, Server, ArrowUpRight, ArrowDownRight, Clock
} from 'lucide-react';
import { AlertRule, Incident, ExecutionLog } from '../../types';

interface MonitoringViewProps {
  logs: ExecutionLog[];
  alertRules: AlertRule[];
  incidents: Incident[];
  onToggleRule: (ruleId: string) => void;
  onAddRule: (rule: AlertRule) => void;
  onResolveIncident: (incidentId: string) => void;
  onAcknowledgeIncident: (incidentId: string) => void;
  canManageAlerts: boolean;
}

export const MonitoringView: React.FC<MonitoringViewProps> = ({
  logs,
  alertRules,
  incidents,
  onToggleRule,
  onAddRule,
  onResolveIncident,
  onAcknowledgeIncident,
  canManageAlerts
}) => {
  const [selectedLogLevel, setSelectedLogLevel] = useState<string>('all');
  const [isLiveStreamActive, setIsLiveStreamActive] = useState(true);
  const [localLogs, setLocalLogs] = useState<ExecutionLog[]>(logs);
  const [showAddRuleModal, setShowAddRuleModal] = useState(false);

  // New rule state
  const [ruleName, setRuleName] = useState('');
  const [ruleMetric, setRuleMetric] = useState<'latency' | 'failure_rate' | 'pii_leak_attempt' | 'cost_spike'>('latency');
  const [ruleThreshold, setRuleThreshold] = useState('> 300ms');
  const [ruleSeverity, setRuleSeverity] = useState<'critical' | 'high' | 'medium'>('high');
  const [selectedChannels, setSelectedChannels] = useState<('slack' | 'email' | 'pagerduty' | 'webhook')[]>(['slack']);

  // Real-time simulated log streaming generator
  useEffect(() => {
    if (!isLiveStreamActive) return;

    const interval = setInterval(() => {
      const simulatedMessages = [
        {
          pipeline: 'Pipeline Vendas & Transações E-Commerce',
          level: 'info' as const,
          msg: `Lote micro-batch #${Math.floor(10000 + Math.random() * 90000)} processado: ${Math.floor(2500 + Math.random() * 8000)} registros ingeridos em ${Math.floor(28 + Math.random() * 30)}ms.`
        },
        {
          pipeline: 'Telemetria IoT & Logs em Tempo Real',
          level: 'info' as const,
          msg: `Kafka consumer lag: 0 msgs. Throughput mantido em ${(41 + Math.random() * 5).toFixed(1)}k msg/s nos 6 brokers.`
        },
        {
          pipeline: 'Pipeline Vendas & Transações E-Commerce',
          level: 'security' as const,
          msg: `Auditoria Criptográfica LGPD: Validação de chave HSM para pseudonimização de ${Math.floor(100 + Math.random() * 400)} CPFs e cartões.`
        },
        {
          pipeline: 'Customer 360 Ingestão & Mascaramento PII',
          level: 'info' as const,
          msg: `Checkpoint de sincronização delta Snowflake atualizado. Zero desvios de schema detectados.`
        }
      ];

      const chosen = simulatedMessages[Math.floor(Math.random() * simulatedMessages.length)];
      const now = new Date();
      const timeStr = now.toTimeString().split(' ')[0];

      const newEntry: ExecutionLog = {
        id: `log-${Date.now()}`,
        timestamp: timeStr,
        pipelineId: 'pipe-ecommerce-bq',
        pipelineName: chosen.pipeline,
        level: chosen.level,
        message: chosen.msg
      };

      setLocalLogs(prev => [newEntry, ...prev.slice(0, 49)]);
    }, 4500);

    return () => clearInterval(interval);
  }, [isLiveStreamActive]);

  const filteredLogs = localLogs.filter(l => selectedLogLevel === 'all' || l.level === selectedLogLevel);

  const handleAddRuleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleName.trim()) return;

    const newRule: AlertRule = {
      id: `rule-${Date.now()}`,
      name: ruleName,
      metric: ruleMetric,
      threshold: ruleThreshold,
      channels: selectedChannels,
      enabled: true,
      severity: ruleSeverity
    };

    onAddRule(newRule);
    setShowAddRuleModal(false);
    setRuleName('');
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <span className="text-[10px] bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 rounded font-mono font-bold">CRÍTICO</span>;
      case 'high':
        return <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded font-mono font-bold">ALTO</span>;
      default:
        return <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded font-mono">MÉDIO</span>;
    }
  };

  const getLogBadge = (level: string) => {
    switch (level) {
      case 'security':
        return <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded font-mono flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> LGPD</span>;
      case 'warn':
        return <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded font-mono">WARN</span>;
      case 'error':
        return <span className="text-[10px] bg-rose-500/20 text-rose-300 border border-rose-500/30 px-2 py-0.5 rounded font-mono font-bold">ERROR</span>;
      default:
        return <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono">INFO</span>;
    }
  };

  return (
    <div id="monitoring-view-container" className="space-y-6">
      {/* Real-time Health Gauges */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1.5 font-medium">
            <span>Vazão Instantânea (Throughput)</span>
            <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-900 flex items-baseline gap-1 font-mono">
            48,250
            <span className="text-xs text-slate-500 font-sans font-normal">reg/seg</span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-emerald-600 font-medium mt-1">
            <ArrowUpRight className="w-3.5 h-3.5" />
            <span>+12.4% vs média histórica</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1.5 font-medium">
            <span>Latência Média p95</span>
            <div className="p-1.5 rounded-lg bg-sky-50 text-sky-600">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-900 flex items-baseline gap-1 font-mono">
            142
            <span className="text-xs text-slate-500 font-sans font-normal">milissegundos</span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-emerald-600 font-medium mt-1">
            <CheckCircle className="w-3.5 h-3.5" />
            <span>Dentro do SLA limite (&lt; 350ms)</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1.5 font-medium">
            <span>Taxa de Falha de Ingestão</span>
            <div className="p-1.5 rounded-lg bg-rose-50 text-rose-600">
              <Flame className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-900 flex items-baseline gap-1 font-mono">
            0.02%
            <span className="text-xs text-slate-500 font-sans font-normal">(99.98% sucesso)</span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-slate-500 mt-1">
            <span>Zero descarte de mensagens</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1.5 font-medium">
            <span>Clusters & Worker Pods</span>
            <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
              <Server className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-900 flex items-baseline gap-1 font-mono">
            18
            <span className="text-xs text-slate-500 font-sans font-normal">pods ativos (Kubernetes)</span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-indigo-600 font-medium mt-1">
            <span>Auto-scaling HPA calibrado</span>
          </div>
        </div>
      </div>

      {/* Main Grid: Live Logs Streamer + Active Incidents & Alert Rules */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Live Execution Log Streamer (2 cols) */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col h-[520px]">
          {/* Header of Console */}
          <div className="p-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-indigo-600" />
              <h3 className="text-xs font-semibold text-slate-800 uppercase tracking-wider">
                Stream de Logs em Tempo Real (Kafka, Spark & BigQuery)
              </h3>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            </div>

            <div className="flex items-center gap-2">
              {/* Level Filter */}
              <select
                value={selectedLogLevel}
                onChange={(e) => setSelectedLogLevel(e.target.value)}
                className="bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 shadow-sm"
              >
                <option value="all">Todos os Níveis</option>
                <option value="info">Apenas INFO</option>
                <option value="security">Segurança & LGPD</option>
                <option value="warn">Avisos (WARN)</option>
                <option value="error">Erros (ERROR)</option>
              </select>

              {/* Pause / Resume button */}
              <button
                onClick={() => setIsLiveStreamActive(!isLiveStreamActive)}
                className={`p-1.5 rounded-lg border text-xs transition cursor-pointer shadow-sm ${
                  isLiveStreamActive 
                    ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50' 
                    : 'bg-amber-50 border-amber-200 text-amber-700'
                }`}
                title={isLiveStreamActive ? 'Pausar streaming de logs' : 'Retomar streaming de logs'}
              >
                {isLiveStreamActive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Log Window */}
          <div className="p-4 flex-1 overflow-y-auto font-mono text-xs space-y-2.5 bg-slate-950">
            {filteredLogs.map((log) => (
              <div 
                key={log.id} 
                className="flex items-start gap-3 p-2 rounded hover:bg-slate-900 transition text-slate-300"
              >
                <span className="text-slate-500 shrink-0 select-none text-[11px]">
                  {log.timestamp}
                </span>
                <div className="shrink-0">{getLogBadge(log.level)}</div>
                <div className="flex-1 min-w-0">
                  <span className="text-slate-400 text-[11px] block truncate mb-0.5">
                    [{log.pipelineName}]
                  </span>
                  <span className={`break-words leading-relaxed ${
                    log.level === 'security' ? 'text-emerald-300' :
                    log.level === 'warn' ? 'text-amber-300' :
                    log.level === 'error' ? 'text-rose-400' : 'text-slate-200'
                  }`}>
                    {log.message}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="p-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
            <span>Buffer de visualização: {filteredLogs.length} eventos em memória</span>
            <span className="flex items-center gap-1.5 text-emerald-700 font-medium">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              Auditoria de logs imutável com retenção de 365 dias (LGPD Art. 16)
            </span>
          </div>
        </div>

        {/* Right Column: Alert Rules & Active Incidents */}
        <div className="space-y-6">
          {/* Active Incidents */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                Incidentes Recentes
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-mono font-medium border border-slate-200">
                {incidents.filter(i => i.status !== 'resolved').length} Abertos
              </span>
            </div>

            <div className="space-y-2.5">
              {incidents.map((incident) => (
                <div 
                  key={incident.id} 
                  className={`p-3 rounded-lg border space-y-2 ${
                    incident.status === 'resolved' 
                      ? 'bg-slate-50 border-slate-200 opacity-60' 
                      : 'bg-amber-50/50 border-amber-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-slate-900 truncate max-w-[180px]">
                      {incident.title}
                    </span>
                    {getSeverityBadge(incident.severity)}
                  </div>
                  <p className="text-[11px] text-slate-600 leading-normal">
                    {incident.description}
                  </p>
                  <div className="flex items-center justify-between pt-1 border-t border-slate-200/80 text-[10px] text-slate-500">
                    <span>{incident.createdAt}</span>
                    <div className="flex items-center gap-1.5">
                      {incident.status === 'open' && (
                        <button
                          onClick={() => onAcknowledgeIncident(incident.id)}
                          className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition cursor-pointer font-medium"
                        >
                          Reconhecer
                        </button>
                      )}
                      {incident.status !== 'resolved' && (
                        <button
                          onClick={() => onResolveIncident(incident.id)}
                          className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-medium transition cursor-pointer shadow-sm"
                        >
                          Resolver
                        </button>
                      )}
                      {incident.status === 'resolved' && (
                        <span className="text-emerald-600 font-semibold flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" /> Resolvido
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Configured Alert Rules */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
                <Bell className="w-4 h-4 text-indigo-600" />
                Regras de Alerta
              </span>
              {canManageAlerts && (
                <button
                  onClick={() => setShowAddRuleModal(true)}
                  className="flex items-center gap-1 px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-medium border border-indigo-200 transition cursor-pointer"
                >
                  <Plus className="w-3 h-3 text-indigo-600" /> Nova Regra
                </button>
              )}
            </div>

            <div className="space-y-2.5 max-h-72 overflow-y-auto">
              {alertRules.map((rule) => (
                <div key={rule.id} className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-800 truncate max-w-[190px]">{rule.name}</span>
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      disabled={!canManageAlerts}
                      onChange={() => onToggleRule(rule.id)}
                      className="w-3.5 h-3.5 rounded text-indigo-600 focus:ring-indigo-500 bg-white border-slate-300 cursor-pointer"
                    />
                  </div>

                  <p className="text-[11px] text-slate-500 font-mono">
                    Gatilho: <span className="text-indigo-600 font-semibold">{rule.threshold}</span>
                  </p>

                  <div className="flex items-center justify-between pt-1 border-t border-slate-200 text-[10px]">
                    <div className="flex items-center gap-1 text-slate-500">
                      <span>Canais:</span>
                      {rule.channels.map(ch => (
                        <span key={ch} className="px-1.5 py-0.2 rounded bg-white border border-slate-200 text-slate-700 font-mono uppercase text-[9px] font-medium">
                          {ch}
                        </span>
                      ))}
                    </div>
                    {getSeverityBadge(rule.severity)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Add Alert Rule Modal */}
      {showAddRuleModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
                  <Bell className="w-5 h-5" />
                </div>
                <h3 className="text-base font-semibold text-slate-900">Criar Regra de Monitoramento</h3>
              </div>
              <button onClick={() => setShowAddRuleModal(false)} className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-200 transition">
                ✕
              </button>
            </div>

            <form onSubmit={handleAddRuleSubmit} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Nome do Alerta *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Alerta de Queda de Throughput Kafka"
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Métrica Monitorada</label>
                  <select
                    value={ruleMetric}
                    onChange={(e) => setRuleMetric(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="latency">Latência de Ingestão (ms)</option>
                    <option value="failure_rate">Taxa de Falha de Lote (%)</option>
                    <option value="pii_leak_attempt">Tentativa de Escoamento PII (LGPD)</option>
                    <option value="cost_spike">Pico Anômalo de Custo FinOps</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Severidade</label>
                  <select
                    value={ruleSeverity}
                    onChange={(e) => setRuleSeverity(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="critical">Crítico (Page On-Call)</option>
                    <option value="high">Alto (Slack + Email)</option>
                    <option value="medium">Médio (Notificação Diária)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Expressão do Limiar (Threshold)</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: > 450ms durante 5 minutos"
                  value={ruleThreshold}
                  onChange={(e) => setRuleThreshold(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 font-mono focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-2">Canais de Notificação</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['slack', 'email', 'pagerduty', 'webhook'] as const).map((channel) => {
                    const isChecked = selectedChannels.includes(channel);
                    return (
                      <label 
                        key={channel} 
                        className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition ${
                          isChecked ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-slate-50 border-slate-200 text-slate-600'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            if (isChecked) {
                              setSelectedChannels(selectedChannels.filter(c => c !== channel));
                            } else {
                              setSelectedChannels([...selectedChannels, channel]);
                            }
                          }}
                          className="w-4 h-4 rounded text-indigo-600 bg-white border-slate-300"
                        />
                        <span className="font-semibold uppercase text-[11px]">{channel}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddRuleModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold transition cursor-pointer shadow-sm"
                >
                  Salvar Regra
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

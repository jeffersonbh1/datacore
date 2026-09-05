export type CloudProvider = 'gcp' | 'aws' | 'azure' | 'snowflake' | 'generic';

export type NodeType = 'source' | 'raw_data' | 'bronze' | 'silver' | 'transform' | 'filter' | 'lgpd_mask' | 'aggregate' | 'destination';

export type NodeStatus = 'idle' | 'running' | 'success' | 'warning' | 'error';

export type PIIType = 'cpf' | 'rg' | 'email' | 'phone' | 'credit_card' | 'name' | 'salary' | 'ip_address';

export type MaskingMethod = 'anonymize' | 'sha256_hash' | 'partial_redact' | 'tokenization' | 'nullify';

export type PipelineTrigger = 'cron' | 'event' | 'webhook' | 'manual';

export type PipelineMode = 'batch' | 'streaming';

export type UserRole = 'admin' | 'data_engineer' | 'data_analyst' | 'dpo_compliance' | 'viewer';

export interface CanvasNode {
  id: string;
  type: NodeType;
  title: string;
  subtitle: string;
  provider: CloudProvider;
  iconName: string;
  x: number;
  y: number;
  status: NodeStatus;
  config: {
    connector?: string;
    tableOrBucket?: string;
    format?: string;
    query?: string;
    filterCondition?: string;
    maskingRules?: { field: string; piiType: PIIType; method: MaskingMethod }[];
    aggregation?: { groupBy: string; metric: string };
    destinationTable?: string;
    writeMode?: 'append' | 'overwrite' | 'merge_upsert';
  };
  metrics?: {
    recordsIn: number;
    recordsOut: number;
    durationMs: number;
  };
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  animated?: boolean;
}

export interface Pipeline {
  id: string;
  name: string;
  description: string;
  category: string;
  status: 'active' | 'paused' | 'failed' | 'deploying';
  trigger: PipelineTrigger;
  cronExpression?: string;
  mode: PipelineMode;
  cloudProviders: CloudProvider[];
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  lastRunAt: string;
  nextRunAt?: string;
  slaTarget: number;
  actualSla: number;
  recordsProcessedToday: number;
  avgLatencyMs: number;
  monthlyCostUsd: number;
  owner: string;
  containsPII: boolean;
  legalBasis: string;
  version: string;
}

export interface ExecutionLog {
  id: string;
  timestamp: string;
  pipelineId: string;
  pipelineName: string;
  nodeId?: string;
  level: 'info' | 'warn' | 'error' | 'security';
  message: string;
  details?: Record<string, unknown>;
}

export interface AlertRule {
  id: string;
  name: string;
  pipelineId?: string;
  metric: 'latency' | 'failure_rate' | 'pii_leak_attempt' | 'cost_spike' | 'unauthorized_access';
  threshold: string;
  channels: ('slack' | 'email' | 'pagerduty' | 'webhook')[];
  enabled: boolean;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface Incident {
  id: string;
  title: string;
  pipelineName: string;
  severity: 'critical' | 'high' | 'medium';
  status: 'open' | 'acknowledged' | 'resolved';
  createdAt: string;
  description: string;
}

export interface LGPDRequest {
  id: string;
  titularName: string;
  documentType: 'CPF' | 'Email';
  documentValue: string;
  requestType: 'esquecimento' | 'acesso' | 'portabilidade' | 'retificacao';
  status: 'pendente' | 'em_analise' | 'executado' | 'rejeitado';
  dateRequested: string;
  deadlineDate: string;
  legalBasis: string;
  affectedPipelines: string[];
  auditNotes: string;
}

export interface FinOpsMetric {
  totalMonthlyCostUsd: number;
  dailySpendTrend: { day: string; aws: number; gcp: number; azure: number; snowflake: number }[];
  providerBreakdown: { provider: string; cost: number; percentage: number; color: string }[];
  costPerMillionRecords: number;
  idleResourcesCost: number;
  recommendations: {
    id: string;
    pipelineId: string;
    pipelineName: string;
    type: 'auto_scale' | 'storage_lifecycle' | 'partition_prune' | 'spot_instance';
    potentialSavingsUsd: number;
    effort: 'baixo' | 'medio' | 'alto';
    description: string;
    applied: boolean;
  }[];
}

export interface TeamUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department: string;
  avatar: string;
  lastActive: string;
  mfaEnabled: boolean;
  canViewUnmaskedPII: boolean;
}

export interface RolePermissions {
  role: UserRole;
  name: string;
  description: string;
  permissions: {
    canCreatePipelines: boolean;
    canEditPipelines: boolean;
    canTriggerExecutions: boolean;
    canViewPipelines: boolean;
    canViewRawPII: boolean;
    canConfigureLGPDRules: boolean;
    canManageAlerts: boolean;
    canViewFinOps: boolean;
    canManageUsers: boolean;
  };
}

export type SourceType = 'postgresql' | 'mysql' | 'mongodb' | 'kafka' | 'salesforce' | 's3' | 'oracle' | 'rest_api' | 'sqlserver';

export interface DiscoveredTable {
  name: string;
  rowCount: number;
  columns: string[];
  hasPII?: boolean;
  piiFields?: string[];
}

export interface SourceConnectorConfig {
  id: string;
  name: string;
  type: SourceType;
  provider: CloudProvider;
  host: string;
  port: number | string;
  database: string;
  username: string;
  password?: string;
  schema?: string;
  ssl: boolean;
  extraParams?: Record<string, string>;
  discoveredTables: DiscoveredTable[];
  status: 'connected' | 'untested' | 'failed';
  lastTestedAt?: string;
  createdAt: string;
}

export type DestinationType = 'bigquery' | 'snowflake' | 'redshift' | 'databricks' | 'postgresql_dw' | 's3_lakehouse' | 'synapse';

export interface DestinationConnectorConfig {
  id: string;
  name: string;
  type: DestinationType;
  provider: CloudProvider;
  accountOrProject: string;
  warehouseOrCluster?: string;
  databaseOrDataset: string;
  schema?: string;
  authMethod: 'service_account' | 'key_pair' | 'user_pass' | 'iam_role';
  credentials?: string;
  writeMode: 'append' | 'merge_upsert' | 'overwrite';
  status: 'connected' | 'untested' | 'failed';
  lastTestedAt?: string;
  createdAt: string;
}

export type SyncScheduleType = 'diaria' | 'semanal' | 'mensal' | 'unica';

export type WeekDay = 'domingo' | 'segunda' | 'terca' | 'quarta' | 'quinta' | 'sexta' | 'sabado';

export interface SyncScheduleEntry {
  id: string;
  time: string;
  dayOfWeek?: WeekDay;
  dayOfMonth?: number;
}

export interface AutoIntegration {
  id: string;
  name: string;
  sourceConnectorId: string;
  sourceConnectorName: string;
  sourceType: SourceType;
  destinationConnectorId: string;
  destinationConnectorName: string;
  destinationType: DestinationType;
  selectedTables: string[];
  syncFrequency: SyncScheduleType;
  scheduleEntries: SyncScheduleEntry[];
  scheduleSummary: string;
  applyLgpdSanitization: boolean;
  status: 'active' | 'paused';
  pipelineId: string;
  createdAt: string;
  tablesCount: number;
}


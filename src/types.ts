export type CloudProvider = 'gcp' | 'aws' | 'azure' | 'snowflake' | 'generic';

export type NodeType = 'source' | 'raw_data' | 'bronze' | 'silver' | 'gold' | 'transform' | 'filter' | 'lgpd_mask' | 'aggregate' | 'destination';

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
    dbtSql?: string;
    dbtModelName?: string;
    dbtMaterialization?: 'view' | 'table' | 'incremental' | 'ephemeral';
    /** Bronze/Silver nodes only, BigQuery destinations only — inputs for the real
     *  "Construir Camada Bronze/Silver" actions. Bronze nodes carry one table each;
     *  the single Silver node carries every table selected in the integration. */
    bigquery?: {
      projectId: string;
      rawDataset: string;
      bronzeDataset: string;
      /** Silver node only. Default (server-side): bronzeDataset com bronze_ trocado por silver_. */
      silverDataset?: string;
      tables: string[];
      location?: string;
      /** Nome da origem — casa com os modelos em models/medallion/<camada>/<sistema>/. */
      sistema?: string;
    };
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
  /** id (bigint) da linha em `pipelines`, quando persistida — necessário para
   *  gravar/ler `pipeline_runs` (ver ExecutionsView e VisualCanvas.handleExecutePipeline).
   *  Ausente para um pipeline recém-criado nesta sessão, antes do reload que o
   *  busca de volta via fetchPipelinesPorEmpresa (ver App.tsx). */
  dbId?: number;
  /** id (bigint) da integração de origem em `integracoes`, quando persistida.
   *  Usado para excluir a integração (e seu pipeline/runs, por cascade) do banco. */
  integrationId?: number;
  /** Conexão real no Airbyte (quando existe) — usado para checar ao vivo se a
   *  sincronização da Raw (nó "source") já terminou (ver VisualCanvas). */
  airbyteConnectionId?: string;
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
  idEmpresa?: number | null;
}

export interface Empresa {
  id: number;
  nome: string;
  slug: string;
  airbyteWorkspaceId?: string | null;
  status: 'ativo' | 'suspenso' | 'trial' | 'cancelado';
  plano?: string | null;
  criadoEm: string;
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

export type SourceType = 'postgresql' | 'postgres' | 'mysql' | 'mongodb' | 'kafka' | 'salesforce' | 's3' | 'oracle' | 'rest_api' | 'sqlserver' | 'faker' | 'google-sheets';

export type ConnectorFieldType = 'text' | 'number' | 'password' | 'textarea' | 'checkbox';

export interface ConnectorField {
  key: string;
  label: string;
  type: ConnectorFieldType;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string | number | boolean;
}

export interface SourceCatalogEntry {
  id: string;
  label: string;
  description: string;
  airbyteSourceType: string;
  fields: ConnectorField[];
}

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

export type SyncFrequencyOption = 'daily' | 'weekly' | 'monthly' | 'once' | 'realtime' | '15m' | 'hourly' | 'manual';

export interface AirbyteStreamSummary {
  streamName: string;
  primaryKey: string[][];
  cursorField: string[];
  sourceDefinedCursorField: boolean;
  columns: string[];
}

// Mirrors Airbyte's per-stream "Sync mode" choice as exposed when configuring a
// connection manually in the Airbyte UI: Full Refresh (no cursor) or Incremental
// (requires a cursor field chosen from the table's own columns).
export type TableLoadType = 'full_refresh' | 'incremental';

export interface TableSyncConfig {
  loadType: TableLoadType;
  cursorField: string;
  selectedColumns: string[];
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
  tableSyncConfigs?: Record<string, TableSyncConfig>;
  syncFrequency: SyncFrequencyOption;
  executionTimes?: string[];
  weeklyDays?: string[];
  monthlyDay?: number;
  onceDate?: string;
  scheduleSummary?: string;
  applyLgpdSanitization: boolean;
  airbyteConnectionId?: string;
  status: 'active' | 'paused';
  pipelineId: string;
  createdAt: string;
  tablesCount: number;
}

export interface NewUsuarioPayload {
  nome: string;
  email: string;
  senha: string;
  papel: UserRole;
  departamento: string;
  mfa_habilitado: boolean;
  pode_visualizar_pii_bruto: boolean;
  id_empresa?: number | null;
}



import { AirbyteStreamSummary, GcpCostReport, SourceCatalogEntry } from '../types';

const gatewayUrl = import.meta.env.VITE_AIRBYTE_GATEWAY_URL || '';
const gatewayApiKey = import.meta.env.VITE_AIRBYTE_GATEWAY_API_KEY || '';

/** URL e chave do gateway — para chamadas que não cabem em gatewayFetch (ex.: SSE do agente). */
export const gatewayConfig = () => ({ url: gatewayUrl, apiKey: gatewayApiKey });

async function gatewayFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!gatewayUrl) {
    throw new Error('VITE_AIRBYTE_GATEWAY_URL não configurada.');
  }

  const res = await fetch(`${gatewayUrl}${path}`, {
    // Toda chamada ao gateway é uma leitura/ação "ao vivo" (status de pipeline,
    // SQL de modelo dbt recém-regenerado, etc.) — nunca deve vir do cache HTTP
    // do navegador, ou o app pode mostrar um estado desatualizado mesmo com o
    // servidor já correto (foi exatamente o que aconteceu com o SQL do dbt).
    cache: 'no-store',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${gatewayApiKey}`,
      ...(init.headers || {}),
    },
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message = (json && json.error) || res.statusText;
    throw new Error(message);
  }

  return json as T;
}

export interface AirbyteWorkspace {
  workspaceId: string;
  name: string;
}

/** Provisions a new, isolated Airbyte workspace for a tenant (Fase 3). */
export async function createAirbyteWorkspace(name: string): Promise<AirbyteWorkspace> {
  return gatewayFetch<AirbyteWorkspace>('/api/airbyte/workspaces', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function fetchSourceCatalog(): Promise<SourceCatalogEntry[]> {
  const data = await gatewayFetch<{ data: SourceCatalogEntry[] }>('/api/connectors/sources');
  return data.data;
}

export interface AirbyteSource {
  sourceId: string;
  name: string;
  sourceType: string;
  workspaceId: string;
  configuration?: Record<string, unknown>;
  createdAt?: number;
}

export async function createAirbyteSource(payload: {
  name: string;
  catalogId: string;
  config: Record<string, unknown>;
  /** Empresa's own Airbyte workspace (Fase 3). Omit to fall back to the gateway's shared workspace. */
  workspaceId?: string;
}): Promise<AirbyteSource> {
  return gatewayFetch<AirbyteSource>('/api/airbyte/sources', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchExistingSources(workspaceId?: string): Promise<AirbyteSource[]> {
  const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
  const data = await gatewayFetch<{ data: AirbyteSource[] }>(`/api/airbyte/sources${query}`);
  return data.data;
}

export async function deleteAirbyteSource(sourceId: string): Promise<void> {
  await gatewayFetch<null>(`/api/airbyte/sources/${sourceId}`, { method: 'DELETE' });
}

export interface AirbyteDestination {
  destinationId: string;
  name: string;
  destinationType: string;
  workspaceId: string;
  configuration?: Record<string, unknown>;
  createdAt?: number;
}

export async function createBigQueryDestination(payload: {
  name: string;
  config: {
    projectId: string;
    datasetId: string;
    datasetLocation?: string;
    credentialsJson: string;
  };
  /** Empresa's own Airbyte workspace (Fase 3). Omit to fall back to the gateway's shared workspace. */
  workspaceId?: string;
}): Promise<AirbyteDestination> {
  return gatewayFetch<AirbyteDestination>('/api/airbyte/destinations', {
    method: 'POST',
    body: JSON.stringify({
      name: payload.name,
      destinationType: 'bigquery',
      config: payload.config,
      workspaceId: payload.workspaceId,
    }),
  });
}

export async function fetchExistingDestinations(workspaceId?: string): Promise<AirbyteDestination[]> {
  const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
  const data = await gatewayFetch<{ data: AirbyteDestination[] }>(`/api/airbyte/destinations${query}`);
  return data.data;
}

export async function deleteAirbyteDestination(destinationId: string): Promise<void> {
  await gatewayFetch<null>(`/api/airbyte/destinations/${destinationId}`, { method: 'DELETE' });
}

interface RawAirbyteStream {
  streamName: string;
  defaultCursorField?: string[];
  sourceDefinedCursorField?: boolean;
  sourceDefinedPrimaryKey?: string[][];
  propertyFields: string[][];
}

/** `refresh`: consulta a origem de novo (tabelas criadas depois da última descoberta) — mais lento. */
export async function fetchStreams(sourceId: string, refresh = false): Promise<AirbyteStreamSummary[]> {
  const data = await gatewayFetch<{ data: RawAirbyteStream[] }>(`/api/airbyte/streams?sourceId=${sourceId}${refresh ? '&refresh=true' : ''}`);
  return data.data.map(s => ({
    streamName: s.streamName,
    primaryKey: s.sourceDefinedPrimaryKey || [],
    cursorField: s.defaultCursorField || [],
    sourceDefinedCursorField: Boolean(s.sourceDefinedCursorField),
    columns: s.propertyFields.map(path => path.join('.')),
  }));
}

export interface AirbyteConnection {
  connectionId: string;
  name: string;
  sourceId: string;
  destinationId: string;
  status: string;
}

export interface AirbyteConnectionStreamInput {
  name: string;
  loadType: 'full_refresh' | 'incremental';
  cursorField?: string;
  /** All columns for the stream, minus the ones the user unchecked. Omitted (or equal to all columns) means "sync every column". */
  columns?: string[];
}

export interface AirbyteConnectionScheduleInput {
  frequency: 'daily' | 'weekly' | 'monthly' | 'once';
  executionTimes: string[];
  /** Only for "weekly". Unix cron convention: '0'-'6', Sunday = '0' (matches the wizard's weekday picker). */
  weeklyDays?: string[];
  /** Only for "monthly". Day of month, 1-31. */
  monthlyDay?: number;
}

export async function createAirbyteConnection(payload: {
  name: string;
  sourceId: string;
  destinationId: string;
  streams: AirbyteConnectionStreamInput[];
  writeMode: 'append' | 'merge_upsert' | 'overwrite';
  schedule: AirbyteConnectionScheduleInput;
  /** BigQuery dataset ("raw_..." completo) onde ESTA connection deve gravar —
   *  omitido usa o dataset padrão já configurado no destino Airbyte. Necessário
   *  sempre que duas integrações reusam o mesmo destino com datasets diferentes
   *  (ver "Default Dataset ID" em AutoPipelineView), senão o Airbyte ignora o
   *  dataset escolhido no wizard e grava tudo no dataset padrão do destino. */
  datasetOverride?: string;
}): Promise<AirbyteConnection> {
  return gatewayFetch<AirbyteConnection>('/api/airbyte/connections', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Edição de integração: inclui/remove tabelas (streams) de uma conexão existente.
 * As tabelas que continuam mantêm a configuração atual no Airbyte.
 */
export async function updateAirbyteConnectionStreams(
  connectionId: string,
  payload: { add: AirbyteConnectionStreamInput[]; remove: string[]; writeMode: 'append' | 'merge_upsert' | 'overwrite' }
): Promise<AirbyteConnection> {
  return gatewayFetch<AirbyteConnection>(`/api/airbyte/connections/${connectionId}/streams`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

/** Pauses ('inactive') or resumes ('active') a connection's own Airbyte schedule. */
export async function updateAirbyteConnectionStatus(
  connectionId: string,
  status: 'active' | 'inactive'
): Promise<AirbyteConnection> {
  return gatewayFetch<AirbyteConnection>(`/api/airbyte/connections/${connectionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

/**
 * Dispara uma sincronização manual imediata da conexão. Usado ao criar a
 * integração: o bloco "Frequência de Sincronização" está desativado nesta
 * versão (reservado para o agendamento via Airflow), então a execução de
 * imediato depende deste disparo em vez do cron do Airbyte.
 */
export async function triggerAirbyteSync(connectionId: string): Promise<{ jobId: number; status: string }> {
  return gatewayFetch(`/api/airbyte/connections/${connectionId}/sync`, {
    method: 'POST',
  });
}

export interface AirbyteJob {
  jobId: number;
  status: 'pending' | 'running' | 'incomplete' | 'failed' | 'succeeded' | 'cancelled';
  jobType: string;
  connectionId: string;
  startTime: string;
  lastUpdatedTime?: string;
  duration?: string;
  bytesSynced?: number;
  rowsSynced?: number;
}

/** Real sync/execution history for a connection, most recent first. */
export async function fetchConnectionJobs(connectionId: string, limit = 30): Promise<AirbyteJob[]> {
  const data = await gatewayFetch<{ data: AirbyteJob[] }>(
    `/api/airbyte/connections/${connectionId}/jobs?limit=${limit}`
  );
  return data.data;
}

/** Espelho de RawFailureDiagnosis (server/rawFailurePolicy.ts). */
export interface RawFailureDiagnosis {
  categoria: 'schema_incompativel' | 'schema_desatualizado' | 'configuracao' | 'origem' | 'destino' | 'transitorio' | 'plataforma' | 'desconhecido';
  severidade: 'critica' | 'alta';
  mensagem: string;
  detalhe: string | null;
}

/** Motivo real (classificado) da falha de um job de sync — a API pública do Airbyte só diz 'failed'. */
export async function fetchSyncFailureDiagnosis(connectionId: string, jobId: number): Promise<RawFailureDiagnosis> {
  return gatewayFetch(`/api/airbyte/connections/${connectionId}/jobs/${jobId}/diagnosis`);
}

export interface SchemaCheckResult {
  /** true na primeira verificação: só gravou a "foto" do schema, sem alertas. */
  baseline: boolean;
  alerts: Array<{ categoria: string; severidade: string; mensagem: string; detalhe: string | null; tabela: string; bloqueante: boolean }>;
  verificadoEm: string;
  /** O catálogo da conexão no Airbyte foi atualizado com o schema atual. */
  catalogoAtualizado: boolean;
  catalogoErro: string | null;
}

/** Compara o schema atual da origem com a última foto e grava um alerta por mudança (~15-40 s). */
export async function checkSchemaChanges(connectionId: string): Promise<SchemaCheckResult> {
  return gatewayFetch(`/api/airbyte/connections/${connectionId}/schema-check`, { method: 'POST', body: '{}' });
}

export interface BronzeTableResult {
  table: string;
  status: 'ok' | 'error';
  error?: string;
  /** Modelo dbt que produziu a tabela (bronze_<sistema>_<tabela>). */
  model?: string;
  /** Linhas gravadas nesta tabela (adapter_response.rows_affected do dbt-bigquery). */
  rowsAffected?: number;
}

export interface BronzeDbtSummary {
  ok: boolean;
  select: string;
  target: string;
  models: Array<{ name: string; uniqueId: string; status: string; message?: string; executionTime?: number }>;
  error?: string;
  stderrTail?: string;
}

export interface DbtModelTableSpec {
  /** Nome do stream / base da tabela (a tabela real é raw_<name>). */
  name: string;
  columns: string[];
  /** Chave primária (do stream Airbyte) — habilita dedup CDC + unique_key. */
  primaryKey?: string[];
  cursorField?: string | null;
  loadType?: 'full_refresh' | 'incremental';
}

export interface DbtModelsResult {
  files: string[];
  models: string[];
  sources: string[];
  git: string;
  gitDetail?: string;
}

/**
 * Gera/regenera os modelos dbt da Bronze (um bronze_<tabela>.sql por tabela em
 * dbt/models/medallion/bronze/, sobrescrevendo). Chamado logo após criar a
 * conexão no Airbyte.
 */
export async function generateDbtModels(payload: {
  /** Nome da origem — vira a subpasta e o prefixo do modelo Bronze. */
  sistema: string;
  projectId: string;
  rawDataset: string;
  bronzeDataset: string;
  applyLgpd?: boolean;
  tables: DbtModelTableSpec[];
}): Promise<DbtModelsResult> {
  return gatewayFetch('/api/dbt/models', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Regenera os modelos dbt de uma integração a partir do estado persistido
 * (Supabase + PKs do Airbyte). Idempotente — usar para retry/garantia e, no
 * futuro, como o hook chamado pela orquestração (Airflow).
 */
export async function regenerateDbtModelsFromIntegration(connectionId: string): Promise<DbtModelsResult> {
  return gatewayFetch('/api/dbt/models/from-integration', {
    method: 'POST',
    body: JSON.stringify({ connectionId }),
  });
}

/**
 * Camada Bronze: 100% dbt. O gateway roda `dbt build --select bronze_<t1> ...`
 * sobre os modelos em models/medallion/bronze/ — um por tabela, com tipagem
 * leve, deduplicação CDC e anonimização LGPD. Sem fallback: tabela sem modelo
 * => erro. Disparada pelo nó Bronze do canvas do Studio.
 */
export async function buildBronzeLayer(payload: {
  projectId: string;
  rawDataset: string;
  bronzeDataset: string;
  tables: string[];
  /** Nome da origem — casa com os modelos gerados. */
  sistema?: string;
  location?: string;
  /** `--full-refresh`: reconstrói modelos incrementais do zero. Necessário na 1ª
   *  construção quando `bronze_<sistema>_<t>` já existe com schema incompatível. */
  fullRefresh?: boolean;
}): Promise<{ dataset: string; results: BronzeTableResult[]; dbt?: BronzeDbtSummary }> {
  return gatewayFetch('/api/bigquery/bronze/build', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Camada Silver: mesmo mecanismo real da Bronze — `dbt build --select
 * silver_<sistema>_<t1> ...` sobre os modelos em models/medallion/silver/,
 * gerados a partir do Bronze correspondente (ver server/dbtCodegen.ts).
 * Reaproveita os tipos de resultado da Bronze (mesmo formato).
 */
export async function buildSilverLayer(payload: {
  projectId: string;
  rawDataset: string;
  bronzeDataset: string;
  silverDataset?: string;
  tables: string[];
  sistema?: string;
  location?: string;
  fullRefresh?: boolean;
}): Promise<{ dataset: string; results: BronzeTableResult[]; dbt?: BronzeDbtSummary }> {
  return gatewayFetch('/api/bigquery/silver/build', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface RawColumnInfo {
  name: string;
  dataType: string;
  description: string | null;
  isPii: boolean;
  quality: {
    totalRows: number;
    nullCount: number;
    nullPct: number;
    distinctCount: number;
    status: 'sem_dados' | 'completo' | 'atencao' | 'critico';
  };
}

/**
 * Dicionário de Dados da camada Raw (Hub de Governança & LGPD): colunas reais
 * da tabela (ao vivo, via BigQuery INFORMATION_SCHEMA), com métricas simples
 * de qualidade, a descrição documentada (lida do _properties.yml Bronze do
 * sistema) e o sinalizador de dado pessoal (LGPD).
 */
export async function fetchRawTableColumns(payload: {
  projectId: string;
  rawDataset: string;
  table: string;
  sistema: string;
  location?: string;
}): Promise<{ table: string; physicalTable: string; totalRows: number; columns: RawColumnInfo[] }> {
  const qs = new URLSearchParams({
    projectId: payload.projectId,
    rawDataset: payload.rawDataset,
    table: payload.table,
    sistema: payload.sistema,
  });
  if (payload.location) qs.set('location', payload.location);
  return gatewayFetch(`/api/raw-catalog/columns?${qs.toString()}`);
}

/**
 * Atualiza a descrição de uma coluna da camada Raw — reflete imediatamente no
 * _properties.yml Bronze do sistema (dbt/models/medallion/bronze/<sistema>/_properties.yml),
 * no modelo/coluna correspondente (ver server/bronzeColumnDocs.ts).
 */
/**
 * Custos & FinOps com dados reais: inventário real de recursos GCP + custo
 * estimado (uso real medido × preço público de lista do GCP — ver
 * server/routes/costs.ts). Cacheado no servidor por 1h; passe force=true
 * (botão "Atualizar") pra recalcular na hora.
 */
export async function fetchGcpCostReport(
  force = false,
  /** 'YYYY-MM-DD' (fuso São Paulo) — omitido = mês atual (default do servidor). */
  range?: { start: string; end: string },
): Promise<GcpCostReport> {
  const qs = new URLSearchParams();
  if (force) qs.set('refresh', '1');
  if (range) { qs.set('start', range.start); qs.set('end', range.end); }
  const query = qs.toString();
  return gatewayFetch(`/api/costs/gcp${query ? `?${query}` : ''}`);
}

export async function updateRawColumnDescription(
  sistema: string,
  table: string,
  column: string,
  description: string,
): Promise<{ ok: boolean; standardizedName: string; isPii: boolean }> {
  return gatewayFetch('/api/raw-catalog/columns', {
    method: 'PUT',
    body: JSON.stringify({ sistema, table, column, description }),
  });
}

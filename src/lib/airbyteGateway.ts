import { AirbyteStreamSummary, SourceCatalogEntry } from '../types';

const gatewayUrl = import.meta.env.VITE_AIRBYTE_GATEWAY_URL || '';
const gatewayApiKey = import.meta.env.VITE_AIRBYTE_GATEWAY_API_KEY || '';

async function gatewayFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!gatewayUrl) {
    throw new Error('VITE_AIRBYTE_GATEWAY_URL não configurada.');
  }

  const res = await fetch(`${gatewayUrl}${path}`, {
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

export async function fetchStreams(sourceId: string): Promise<AirbyteStreamSummary[]> {
  const data = await gatewayFetch<{ data: RawAirbyteStream[] }>(`/api/airbyte/streams?sourceId=${sourceId}`);
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
}): Promise<AirbyteConnection> {
  return gatewayFetch<AirbyteConnection>('/api/airbyte/connections', {
    method: 'POST',
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

/**
 * Lê o .sql real de um modelo Bronze/Silver gerado (o mesmo arquivo que `dbt
 * build` executa) — usado pelo editor visual do Studio ao abrir um nó Bronze
 * ou Silver, em vez do template genérico de demonstração.
 */
export async function getBronzeModelSql(sistema: string, table: string, layer: 'bronze' | 'silver' = 'bronze'): Promise<{ name: string; sql: string }> {
  const qs = new URLSearchParams({ sistema, table, layer });
  return gatewayFetch(`/api/dbt/models/by-table/sql?${qs.toString()}`);
}

/**
 * Sobrescreve o .sql de um modelo Bronze/Silver já gerado. Edição manual: a
 * próxima regeração da integração (criação/re-sync) sobrescreve de novo, como
 * qualquer outro arquivo gerado por server/dbtCodegen.ts.
 */
export async function saveBronzeModelSql(sistema: string, table: string, sql: string, layer: 'bronze' | 'silver' = 'bronze'): Promise<{ ok: boolean; name: string }> {
  const qs = new URLSearchParams({ sistema, table, layer });
  return gatewayFetch(`/api/dbt/models/by-table/sql?${qs.toString()}`, {
    method: 'PUT',
    body: JSON.stringify({ sql }),
  });
}

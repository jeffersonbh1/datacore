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
}): Promise<AirbyteSource> {
  return gatewayFetch<AirbyteSource>('/api/airbyte/sources', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchExistingSources(): Promise<AirbyteSource[]> {
  const data = await gatewayFetch<{ data: AirbyteSource[] }>('/api/airbyte/sources');
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
}): Promise<AirbyteDestination> {
  return gatewayFetch<AirbyteDestination>('/api/airbyte/destinations', {
    method: 'POST',
    body: JSON.stringify({ name: payload.name, destinationType: 'bigquery', config: payload.config }),
  });
}

export async function fetchExistingDestinations(): Promise<AirbyteDestination[]> {
  const data = await gatewayFetch<{ data: AirbyteDestination[] }>('/api/airbyte/destinations');
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

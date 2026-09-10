import { BigQuery } from '@google-cloud/bigquery';

let client: BigQuery | null = null;

// Single shared service account for the gateway (server-only, never exposed to the
// browser) — every empresa today lives in the same GCP project, so one credential
// with BigQuery access covers all tenants' raw_/bronze_ datasets. Per-tenant
// credentials would require persisting each destination's service account key in
// Supabase, which we deliberately don't do (see registrarDestino in src/lib/supabase.ts).
export function getBigQueryClient(): BigQuery {
  if (client) return client;

  const rawCredentials = process.env.BIGQUERY_CREDENTIALS_JSON;
  if (!rawCredentials) {
    throw new Error('BIGQUERY_CREDENTIALS_JSON não configurada no servidor.');
  }

  const credentials = JSON.parse(rawCredentials) as { client_email: string; private_key: string; project_id: string };
  client = new BigQuery({ credentials, projectId: credentials.project_id });
  return client;
}

import { airbyteConfigFetch } from './airbyteClient';

// -----------------------------------------------------------------------------
// Última carga BEM-SUCEDIDA da Raw de uma conexão — o que a Bronze full lê
// (macro filtro_ultima_carga_ok, dbt/macros/filtro_ultima_carga_ok.sql).
//
// A Raw full empilha as cargas (full_refresh_append). "Maior sync_id" não basta:
//   - um sync que falhou/foi cancelado no meio deixa uma carga PARCIAL com
//     sync_id próprio (e maior);
//   - uma tentativa que falha e é refeita no MESMO job grava as duas com o mesmo
//     sync_id — a parcial e a completa.
// Por isso a Bronze filtra pelo job que terminou com sucesso (sync_id = id do
// job) e só pelo que foi extraído a partir do início da tentativa que deu certo.
// -----------------------------------------------------------------------------

/** Vai para o dbt como var `raw_carga_ok`. */
export interface RawCargaOk {
  /** Id do último job de sync com status succeeded (= _airbyte_meta.sync_id). */
  sync_id: number;
  /** Início da tentativa bem-sucedida desse job (ISO, UTC). */
  desde: string;
}

interface JobsListResponse {
  jobs?: Array<{
    job: { id: number; status: string };
    attempts?: Array<{ status: string; createdAt: number }>;
  }>;
}

/** null = a conexão ainda não tem nenhum sync bem-sucedido. Erro de API propaga. */
export async function lastSuccessfulLoad(connectionId: string): Promise<RawCargaOk | null> {
  const data = await airbyteConfigFetch<JobsListResponse>('/jobs/list', {
    configTypes: ['sync'],
    configId: connectionId,
    statuses: ['succeeded'],
    pagination: { pageSize: 1 },
  });
  const latest = data.jobs?.[0];
  if (!latest) return null;
  const ok = [...(latest.attempts || [])].reverse().find((a) => a.status === 'succeeded');
  if (!ok) return null;
  return { sync_id: latest.job.id, desde: new Date(ok.createdAt * 1000).toISOString() };
}

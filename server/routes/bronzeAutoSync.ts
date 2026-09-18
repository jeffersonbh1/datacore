import { Router } from 'express';
import { airbyteFetch } from '../airbyteClient';
import { getSupabaseAdmin } from '../supabaseAdmin';
import { buildBronzeForTables } from './bronze';

export const bronzeAutoSyncRouter = Router();

interface AirbyteJob {
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

/** Airbyte's job "duration" is an ISO-8601 duration string (e.g. "PT1M16.8S"); this converts it to ms.
 *  Duplicated from src/lib/supabase.ts's parseIsoDurationMs — server and src don't share code (see the
 *  duplicated AirbyteJob interface pattern already in server/routes/connections.ts). */
function parseIsoDurationMs(duration?: string): number | null {
  if (!duration) return null;
  const match = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(duration);
  if (!match) return null;
  const hours = parseFloat(match[1] || '0');
  const minutes = parseFloat(match[2] || '0');
  const seconds = parseFloat(match[3] || '0');
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

const OPEN_JOB_STATUSES = new Set(['pending', 'running']);

interface IntegracaoRow {
  id: number;
  id_empresa: number;
  airbyte_connection_id: string | null;
  tabelas_selecionadas: string[];
  // Dataset desta integração específica — ver sql/012_integracoes_dataset_override.sql.
  // NULL = usa o dataset compartilhado do destino (destinos.configuracao.databaseOrDataset).
  dataset_override: string | null;
  destinos: { tipo: string; configuracao: Record<string, unknown> } | null;
  origens: { nome: string | null } | { nome: string | null }[] | null;
  pipelines: { id: number } | { id: number }[] | null;
}

interface StepResult {
  integracaoId: number;
  action: 'skipped' | 'bronze_built' | 'bronze_failed';
  detail: string;
}

// Fase 6: automatic Bronze trigger, no longer dependent on the manual Studio
// button. Meant to be hit by a Cloud Scheduler job every few minutes (see
// cloudbuild/README for the gcloud scheduler command) — NOT wired to run on
// its own inside this Node process, since Cloud Run scales to zero and can't
// host a background interval/loop reliably.
//
// For every active integration on a BigQuery destination, this: (1) asks
// Airbyte for its most recent sync jobs, (2) upserts them into pipeline_runs
// — the same shape src/lib/supabase.ts's upsertPipelineRuns() writes from the
// browser, so run history stays complete even if nobody has the Studio open
// — and (3) if the latest job succeeded and Bronze hasn't been built for it
// yet (pipeline_runs.bronze_status), builds it via buildBronzeForTables() and
// records the outcome. Idempotent: safe to call again for the same job.
bronzeAutoSyncRouter.post('/', async (_req, res) => {
  try {
    const supabase = getSupabaseAdmin();
    const { data: integracoes, error } = await supabase
      .from('integracoes')
      .select('id, id_empresa, airbyte_connection_id, tabelas_selecionadas, dataset_override, destinos(tipo, configuracao), origens(nome), pipelines(id)')
      .eq('status', 'active')
      .not('airbyte_connection_id', 'is', null);

    if (error) throw new Error(error.message);

    const results: StepResult[] = [];

    for (const integ of (integracoes || []) as unknown as IntegracaoRow[]) {
      const destino = integ.destinos;
      const pipelineRow = Array.isArray(integ.pipelines) ? integ.pipelines[0] : integ.pipelines;

      if (!destino || destino.tipo !== 'bigquery' || !pipelineRow || !integ.airbyte_connection_id) {
        continue; // não-BigQuery, ou pipeline ainda não persistido (buildPipelineFromIntegration/registrarPipeline) — nada a fazer.
      }

      const cfg = destino.configuracao as { accountOrProject?: string; databaseOrDataset?: string; warehouseOrCluster?: string };
      // dataset_override (por integração) tem prioridade sobre o dataset
      // compartilhado do destino — ver comentário em IntegracaoRow acima.
      const rawDataset = integ.dataset_override || cfg.databaseOrDataset;
      const projectId = cfg.accountOrProject;
      if (!rawDataset || !projectId || !rawDataset.startsWith('raw_')) {
        results.push({ integracaoId: integ.id, action: 'skipped', detail: 'destino BigQuery sem dataset raw_ configurado' });
        continue;
      }
      const bronzeDataset = rawDataset.replace(/^raw_/, 'bronze_');

      let jobsData: { data: AirbyteJob[] };
      try {
        // orderBy=createdAt|DESC: sem isso o Airbyte devolve os jobs mais ANTIGOS
        // primeiro (mesmo motivo do comentário em connectionsRouter.ts) — com
        // limit=5, uma conexão com mais de 5 syncs no histórico nunca via um job
        // novo, porque o corte acontecia ANTES do sort abaixo (bug real: o
        // auto-sync ficava preso pra sempre nos 5 jobs mais antigos).
        jobsData = await airbyteFetch<{ data: AirbyteJob[] }>(
          `/jobs?connectionId=${integ.airbyte_connection_id}&jobType=sync&limit=5&orderBy=${encodeURIComponent('createdAt|DESC')}`
        );
      } catch (err) {
        results.push({ integracaoId: integ.id, action: 'skipped', detail: `falha ao consultar jobs do Airbyte: ${err instanceof Error ? err.message : err}` });
        continue;
      }

      // Airbyte's /jobs list is NOT guaranteed most-recent-first mesmo com
      // orderBy (observado ascendente por startTime em algumas conexões) —
      // sort explícito continua necessário, só que agora sobre os 5 jobs
      // corretos (os mais recentes), não os 5 mais antigos.
      const jobs = [...(jobsData.data || [])].sort(
        (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
      );
      const latest = jobs[0];
      if (!latest) {
        results.push({ integracaoId: integ.id, action: 'skipped', detail: 'sem jobs de sync ainda' });
        continue;
      }

      // Mantém pipeline_runs completo independente do resultado da Bronze — mesmo
      // formato de upsertPipelineRuns() (src/lib/supabase.ts), só que gravado pelo
      // gateway (service role) em vez do navegador.
      const runRows = jobs.map(job => ({
        pipeline_id: pipelineRow.id,
        id_empresa: integ.id_empresa,
        airbyte_job_id: job.jobId,
        status: job.status,
        records_synced: job.rowsSynced ?? null,
        bytes_synced: job.bytesSynced ?? null,
        duration_ms: parseIsoDurationMs(job.duration),
        iniciado_em: job.startTime,
        finalizado_em: OPEN_JOB_STATUSES.has(job.status) ? null : (job.lastUpdatedTime || null),
      }));
      await supabase.from('pipeline_runs').upsert(runRows, { onConflict: 'pipeline_id,airbyte_job_id' });

      if (latest.status !== 'succeeded') {
        results.push({ integracaoId: integ.id, action: 'skipped', detail: `último job com status "${latest.status}"` });
        continue;
      }

      const { data: runRow } = await supabase
        .from('pipeline_runs')
        .select('bronze_status')
        .eq('pipeline_id', pipelineRow.id)
        .eq('airbyte_job_id', latest.jobId)
        .maybeSingle();

      if (runRow?.bronze_status === 'built') {
        results.push({ integracaoId: integ.id, action: 'skipped', detail: 'Bronze já construída para este job' });
        continue;
      }

      const tables = integ.tabelas_selecionadas || [];
      if (tables.length === 0) {
        results.push({ integracaoId: integ.id, action: 'skipped', detail: 'integração sem tabelas selecionadas' });
        continue;
      }

      const origem = Array.isArray(integ.origens) ? integ.origens[0] : integ.origens;
      const sistema = origem?.nome || 'sistema';

      const tableResults = await buildBronzeForTables({
        projectId,
        rawDataset,
        bronzeDataset,
        tables,
        sistema,
        location: cfg.warehouseOrCluster || undefined,
      });
      // Normaliza para o formato TableBuildResult (src/lib/pipelineBuilder.ts) que a
      // tela Execuções espera em bronze_tables — TableResult (server/routes/bronze.ts)
      // usa campos opcionais (undefined), o front usa `| null`. Sem isso, o detalhe por
      // tabela nunca era gravado e a tela sempre mostrava "Sem detalhe disponível".
      const bronzeTables = tableResults.map(r => ({
        table: r.table,
        status: r.status,
        rowsAffected: r.rowsAffected ?? null,
        error: r.error ?? null,
      }));
      const failed = bronzeTables.filter(r => r.status === 'error');
      const hasFailure = failed.length > 0;

      await supabase
        .from('pipeline_runs')
        .update({
          bronze_status: hasFailure ? 'failed' : 'built',
          bronze_built_em: new Date().toISOString(),
          bronze_error: hasFailure ? failed.map(t => `${t.table}: ${t.error}`).join(' | ') : null,
          bronze_tables: bronzeTables,
        })
        .eq('pipeline_id', pipelineRow.id)
        .eq('airbyte_job_id', latest.jobId);

      results.push({
        integracaoId: integ.id,
        action: hasFailure ? 'bronze_failed' : 'bronze_built',
        detail: `${tableResults.length} tabela(s), job ${latest.jobId}`,
      });
    }

    res.json({ processed: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Erro no auto-sync da camada Bronze.' });
  }
});

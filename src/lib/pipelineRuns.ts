import { Pipeline } from '../types';
import { fetchConnectionJobs } from './airbyteGateway';
import { applyRealMetrics, PipelineRunSummary } from './pipelineBuilder';
import { fetchPipelineRunsForPipeline, upsertPipelineRuns } from './supabase';

/**
 * Pulls real sync history from Airbyte for one pipeline's connection, persists
 * it (pipeline_runs) and returns the latest runs. Safe to call repeatedly —
 * Airbyte jobs are upserted by their own id, so re-running never duplicates
 * history.
 */
export async function syncPipelineRuns(
  idEmpresa: number,
  pipelineDbId: number,
  airbyteConnectionId: string
): Promise<PipelineRunSummary[]> {
  const jobs = await fetchConnectionJobs(airbyteConnectionId, 30);
  if (jobs.length) {
    await upsertPipelineRuns(idEmpresa, pipelineDbId, jobs);
  }
  return fetchPipelineRunsForPipeline(pipelineDbId, 30);
}

/**
 * Fase 2 entry point: syncPipelineRuns + the pipeline with real metrics
 * overlaid via applyRealMetrics.
 *
 * Called from the manual "Atualizar métricas" action in Pipelines & Fluxos /
 * Studio and after editing an integration. The initial load (App.tsx) uses
 * syncPipelineRuns directly, in the background, so the list shows up before
 * Airbyte answers.
 */
export async function refreshPipelineMetrics(
  idEmpresa: number,
  pipelineDbId: number,
  airbyteConnectionId: string,
  pipeline: Pipeline
): Promise<Pipeline> {
  const runs = await syncPipelineRuns(idEmpresa, pipelineDbId, airbyteConnectionId);
  return applyRealMetrics(pipeline, runs);
}

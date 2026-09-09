import { Pipeline } from '../types';
import { fetchConnectionJobs } from './airbyteGateway';
import { applyRealMetrics } from './pipelineBuilder';
import { fetchPipelineRunsForPipeline, upsertPipelineRuns } from './supabase';

/**
 * Fase 2 entry point: pulls real sync history from Airbyte for one pipeline's
 * connection, persists it (pipeline_runs), then returns the pipeline with real
 * metrics overlaid via applyRealMetrics. Safe to call repeatedly — Airbyte jobs
 * are upserted by their own id, so re-running never duplicates history.
 *
 * Called once per real pipeline on load (App.tsx) and from the manual
 * "Atualizar métricas" action in Pipelines & Fluxos / Studio.
 */
export async function refreshPipelineMetrics(
  idEmpresa: number,
  pipelineDbId: number,
  airbyteConnectionId: string,
  pipeline: Pipeline
): Promise<Pipeline> {
  const jobs = await fetchConnectionJobs(airbyteConnectionId, 30);
  if (jobs.length) {
    await upsertPipelineRuns(idEmpresa, pipelineDbId, jobs);
  }
  const runs = await fetchPipelineRunsForPipeline(pipelineDbId, 30);
  return applyRealMetrics(pipeline, runs);
}

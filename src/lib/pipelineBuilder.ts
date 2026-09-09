import {
  AutoIntegration, CanvasEdge, CanvasNode, DestinationConnectorConfig,
  NodeStatus, Pipeline, SourceConnectorConfig, SyncFrequencyOption
} from '../types';

// Shared with the wizard's schedule step (Passo 3) — the UI works with weekday
// keys ('seg', 'ter', ...) but Airbyte/cron need the Unix cron day-of-week
// values ('0'-'6', Sun=0).
export const WEEKDAYS = [
  { key: 'seg', label: 'Seg', full: 'Segunda-feira', cronVal: '1' },
  { key: 'ter', label: 'Ter', full: 'Terça-feira', cronVal: '2' },
  { key: 'qua', label: 'Qua', full: 'Quarta-feira', cronVal: '3' },
  { key: 'qui', label: 'Qui', full: 'Quinta-feira', cronVal: '4' },
  { key: 'sex', label: 'Sex', full: 'Sexta-feira', cronVal: '5' },
  { key: 'sab', label: 'Sáb', full: 'Sábado', cronVal: '6' },
  { key: 'dom', label: 'Dom', full: 'Domingo', cronVal: '0' },
];

function buildCronExpression(integration: AutoIntegration): string | undefined {
  const { syncFrequency, executionTimes, weeklyDays, monthlyDay } = integration;
  if (!executionTimes || executionTimes.length === 0) return undefined;

  if (syncFrequency === 'daily') {
    return executionTimes.map(t => {
      const [h, m] = t.split(':');
      return `${parseInt(m, 10)} ${parseInt(h, 10)} * * *`;
    }).join('; ');
  }
  if (syncFrequency === 'weekly') {
    const cronDays = (weeklyDays || []).map(d => WEEKDAYS.find(w => w.key === d)?.cronVal || '1').join(',');
    return executionTimes.map(t => {
      const [h, m] = t.split(':');
      return `${parseInt(m, 10)} ${parseInt(h, 10)} * * ${cronDays}`;
    }).join('; ');
  }
  if (syncFrequency === 'monthly') {
    return executionTimes.map(t => {
      const [h, m] = t.split(':');
      return `${parseInt(m, 10)} ${parseInt(h, 10)} ${integration.monthlyDay ?? 1} * *`;
    }).join('; ');
  }
  return undefined;
}

function buildNextRunText(integration: AutoIntegration): string {
  if (integration.syncFrequency === 'once' && integration.onceDate) {
    return `Agendado para ${integration.onceDate.split('-').reverse().join('/')} às ${(integration.executionTimes || []).join(', ')}`;
  }
  return `Próxima execução: ${(integration.executionTimes || [])[0] || '02:00'}`;
}

/**
 * Deterministically rebuilds the Studio canvas (4-layer Source -> Raw -> Bronze ->
 * Silver topology) for an AutoIntegration. Used both right after a wizard
 * submission and when reloading integrations persisted in Supabase, so a
 * pipeline never depends on being freshly created in the current session to
 * show up in Pipelines & Fluxos / Studio Visual ETL.
 *
 * Node/edge ids are namespaced with pipelineId so two pipelines never collide,
 * but are otherwise stable — safe to call again for the same integration.
 */
export function buildPipelineFromIntegration(
  pipelineId: string,
  integration: AutoIntegration,
  source: SourceConnectorConfig,
  destination: DestinationConnectorConfig
): Pipeline {
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  const selectedTables = integration.selectedTables;

  const sourceNodeId = `${pipelineId}-src`;
  nodes.push({
    id: sourceNodeId,
    type: 'source',
    title: source.name,
    subtitle: `${source.type.toUpperCase()} • ${source.database}`,
    provider: source.provider,
    iconName: source.type === 'kafka' ? 'Radio' : 'Database',
    x: 60,
    y: 190,
    status: 'idle',
    config: {
      connector: source.name,
      tableOrBucket: selectedTables.join(', '),
      format: source.type === 'kafka' ? 'AVRO/JSON CDC Stream' : 'CDC Relacional (Debezium Engine)'
    }
    // No `metrics` here — filled in from real Airbyte job history by applyRealMetrics()
    // once at least one sync has run. Never fabricated placeholder numbers.
  });

  const rawNodeId = `${pipelineId}-raw`;
  nodes.push({
    id: rawNodeId,
    type: 'raw_data',
    title: 'Raw Data Landing Zone',
    subtitle: `s3://corp-lakehouse-raw/${source.database}/`,
    provider: source.provider === 'generic' ? 'aws' : source.provider,
    iconName: 'FolderArchive',
    x: 330,
    y: 190,
    status: 'idle',
    config: {
      tableOrBucket: `datalake-raw/${source.database}/staging/`,
      format: 'Snappy Parquet Raw (Metadados CDC: _op, _source_ts, _ingested_at)'
    }
  });
  edges.push({ id: `${pipelineId}-e-src-raw`, source: sourceNodeId, target: rawNodeId, animated: true });

  const bronzeNodeId = `${pipelineId}-bronze`;
  nodes.push({
    id: bronzeNodeId,
    type: 'bronze',
    title: 'Camada Bronze (Validação & LGPD)',
    subtitle: integration.applyLgpdSanitization ? 'Delta Lake • Cifragem PII Ativa' : 'Delta Lake • Validação & Dedup',
    provider: 'generic',
    iconName: 'ShieldCheck',
    x: 600,
    y: 190,
    status: 'idle',
    config: {
      query: `VALIDATE SCHEMA & DEDUPLICATE (${selectedTables.join(', ')})`,
      maskingRules: integration.applyLgpdSanitization ? [
        { field: 'cpf', piiType: 'cpf', method: 'anonymize' },
        { field: 'email', piiType: 'email', method: 'sha256_hash' },
        { field: 'telefone', piiType: 'phone', method: 'partial_redact' },
        { field: 'cartao_token', piiType: 'credit_card', method: 'tokenization' }
      ] : undefined
    }
    // dbt bronze/silver execution isn't wired to real runs yet (Fase 3) — no metrics.
  });
  edges.push({ id: `${pipelineId}-e-raw-bronze`, source: rawNodeId, target: bronzeNodeId, animated: true });

  const silverNodeId = `${pipelineId}-silver`;
  nodes.push({
    id: silverNodeId,
    type: 'silver',
    title: `Camada Silver (${destination.name})`,
    subtitle: `${destination.type.toUpperCase()} • ${destination.databaseOrDataset}`,
    provider: destination.provider,
    iconName: 'Boxes',
    x: 870,
    y: 190,
    status: 'idle',
    config: {
      destinationTable: `${destination.databaseOrDataset}.[${selectedTables.join(', ')}]`,
      writeMode: destination.writeMode
    }
  });
  edges.push({ id: `${pipelineId}-e-bronze-silver`, source: bronzeNodeId, target: silverNodeId, animated: true });

  const cronExpr = buildCronExpression(integration);
  const nextRun = buildNextRunText(integration);
  const realScheduleFrequencies: SyncFrequencyOption[] = ['daily', 'weekly', 'monthly', 'once'];

  return {
    id: pipelineId,
    name: integration.name,
    description: `Pipeline automático 4 passos (1. Source ➔ 2. Raw Data ➔ 3. Bronze ➔ 4. Silver) integrando ${source.name} com ${destination.name}. Tabelas: ${selectedTables.join(', ')}. ${integration.scheduleSummary || ''}.`,
    category: 'Integração Automática Lakehouse',
    status: integration.status === 'paused' ? 'paused' : 'active',
    trigger: integration.syncFrequency === 'once' ? 'manual' : 'cron',
    cronExpression: cronExpr,
    mode: 'batch',
    cloudProviders: Array.from(new Set([source.provider, destination.provider])),
    nodes,
    edges,
    lastRunAt: 'Pronto para execução',
    nextRunAt: realScheduleFrequencies.includes(integration.syncFrequency) ? nextRun : undefined,
    slaTarget: 99.9,
    // actualSla/recordsProcessedToday/avgLatencyMs start at their honest "nothing
    // synced yet" values — applyRealMetrics() (see below) overwrites them once
    // pipeline_runs has real Airbyte job history for this pipeline.
    actualSla: 100,
    recordsProcessedToday: 0,
    avgLatencyMs: 0,
    monthlyCostUsd: 48.00,
    owner: 'Engenheiro de Dados (Auto-Pipeline)',
    containsPII: integration.applyLgpdSanitization,
    legalBasis: 'Art. 7º, I - Consentimento / Art. 7º, V - Execução de Contrato',
    version: 'v1.0.0'
  };
}

// =============================================================================
// Fase 2 — real execution telemetry (see sql/003_pipeline_runs.sql). A run's
// only job is to describe one real Airbyte sync; converting/persisting Airbyte's
// raw job payload into this shape lives in src/lib/pipelineRuns.ts, which is the
// only writer of pipeline_runs. This function only ever reads runs, never fakes them.
// =============================================================================

export interface PipelineRunSummary {
  status: 'pending' | 'running' | 'incomplete' | 'failed' | 'succeeded' | 'cancelled';
  recordsSynced: number | null;
  durationMs: number | null;
  iniciadoEm: string;
  finalizadoEm: string | null;
}

const FINISHED_STATUSES: PipelineRunSummary['status'][] = ['succeeded', 'failed', 'cancelled', 'incomplete'];

/**
 * Overlays real Airbyte sync history onto a deterministically-built pipeline.
 * `runs` must be ordered most-recent-first. A pipeline with no runs yet is
 * returned unchanged — its honest "nothing synced" defaults from
 * buildPipelineFromIntegration stand until a real sync happens.
 */
export function applyRealMetrics(pipeline: Pipeline, runs: PipelineRunSummary[]): Pipeline {
  if (runs.length === 0) return pipeline;

  const latest = runs[0];
  const todayUtc = new Date().toISOString().split('T')[0];
  const recordsProcessedToday = runs
    .filter(r => r.iniciadoEm.startsWith(todayUtc))
    .reduce((sum, r) => sum + (r.recordsSynced || 0), 0);

  const timedRuns = runs.filter(r => r.durationMs != null);
  const avgLatencyMs = timedRuns.length
    ? Math.round(timedRuns.reduce((sum, r) => sum + (r.durationMs || 0), 0) / timedRuns.length)
    : pipeline.avgLatencyMs;

  const finished = runs.filter(r => FINISHED_STATUSES.includes(r.status));
  const actualSla = finished.length
    ? Math.round((finished.filter(r => r.status === 'succeeded').length / finished.length) * 10000) / 100
    : pipeline.actualSla;

  const sourceNodeStatus: NodeStatus =
    latest.status === 'succeeded' ? 'success'
    : latest.status === 'failed' ? 'error'
    : latest.status === 'running' ? 'running'
    : 'warning';

  const lastRunAt = latest.finalizadoEm
    ? new Date(latest.finalizadoEm).toLocaleString('pt-BR')
    : `Em execução desde ${new Date(latest.iniciadoEm).toLocaleString('pt-BR')}`;

  return {
    ...pipeline,
    // A paused pipeline stays "paused" regardless of past run outcomes; otherwise
    // a failed latest run surfaces as 'failed' instead of the generic 'active'.
    status: pipeline.status === 'paused' ? 'paused' : latest.status === 'failed' ? 'failed' : pipeline.status,
    lastRunAt,
    recordsProcessedToday,
    avgLatencyMs,
    actualSla,
    nodes: pipeline.nodes.map(n => n.type !== 'source' ? n : {
      ...n,
      status: sourceNodeStatus,
      metrics: latest.recordsSynced != null
        ? { recordsIn: latest.recordsSynced, recordsOut: latest.recordsSynced, durationMs: latest.durationMs || 0 }
        : n.metrics,
    }),
  };
}

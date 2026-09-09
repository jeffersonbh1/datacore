-- =============================================================================
-- Fase 2 da persistência de pipelines: histórico real de execuções, uma linha
-- por job de sync do Airbyte, em vez das métricas estáticas/placeholder que o
-- canvas mostrava (320500 registros, 120ms de latência etc. em toda pipeline).
--
-- Rode este script no SQL Editor do Supabase, depois de 002_pipelines.sql.
--
-- Escrito só por upsertPipelineRuns() em src/lib/supabase.ts, a partir do
-- histórico de jobs que o gateway expõe em GET /api/airbyte/connections/:id/jobs
-- (proxy read-only para a Job API pública do Airbyte). Lido só por
-- fetchPipelineRunsForPipeline(), cujo resultado alimenta applyRealMetrics()
-- em src/lib/pipelineBuilder.ts — nunca um número inventado.
-- =============================================================================

create table if not exists pipeline_runs (
  id bigint generated always as identity primary key,
  pipeline_id bigint not null references pipelines(id) on delete cascade,
  id_empresa bigint not null references empresas(id) on delete cascade,
  airbyte_job_id bigint not null,
  status text not null
    check (status in ('pending', 'running', 'incomplete', 'failed', 'succeeded', 'cancelled')),
  records_synced bigint,
  bytes_synced bigint,
  duration_ms integer,
  iniciado_em timestamptz not null,
  finalizado_em timestamptz,
  criado_em timestamptz not null default now(),
  unique (pipeline_id, airbyte_job_id)
);

comment on table pipeline_runs is
  'Uma linha por job de sync real do Airbyte. Fonte de verdade das métricas de execução exibidas em Pipelines & Fluxos / Studio — nunca campos estáticos no objeto Pipeline.';

create index if not exists idx_pipeline_runs_pipeline on pipeline_runs(pipeline_id, iniciado_em desc);
create index if not exists idx_pipeline_runs_empresa on pipeline_runs(id_empresa);

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

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pipeline_id BIGINT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  id_empresa BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  airbyte_job_id BIGINT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'running', 'incomplete', 'failed', 'succeeded', 'cancelled')),
  records_synced BIGINT,
  bytes_synced BIGINT,
  duration_ms INTEGER,
  iniciado_em TIMESTAMPTZ NOT NULL,
  finalizado_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pipeline_id, airbyte_job_id)
);

COMMENT ON TABLE pipeline_runs IS
  'Uma linha por job de sync real do Airbyte. Fonte de verdade das métricas de execução exibidas em Pipelines & Fluxos / Studio — nunca campos estáticos no objeto Pipeline.';

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_pipeline ON pipeline_runs(pipeline_id, iniciado_em DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_empresa ON pipeline_runs(id_empresa);

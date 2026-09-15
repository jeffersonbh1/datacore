-- =============================================================================
-- Fase 7: acompanhamento de execução (Studio Visual ETL) — espelha em pipeline_runs
-- o mesmo padrão que 007 criou para a Bronze, agora também para a Silver, e
-- passa a ser gravado também pelo botão manual "Executar Pipeline" (não só pelo
-- auto-sync), via updatePipelineRunLayerStatus() em src/lib/supabase.ts.
--
-- Rode este script no SQL Editor do Supabase (mesmo projeto de 001..007).
-- =============================================================================

ALTER TABLE pipeline_runs
  ADD COLUMN IF NOT EXISTS silver_status TEXT
    CHECK (silver_status IN ('not_applicable', 'built', 'failed'))
    DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS silver_built_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS silver_error TEXT;

COMMENT ON COLUMN pipeline_runs.silver_status IS
  'Estado da construção da Camada Silver para este job do Airbyte (gravado por handleExecutePipeline no Studio, via updatePipelineRunLayerStatus). "not_applicable" até a tentativa acontecer; "built"/"failed" depois da tentativa real.';
COMMENT ON COLUMN pipeline_runs.silver_error IS
  'Detalhe do erro (tabelas que falharam) quando silver_status = ''failed''. Nulo em qualquer outro estado.';

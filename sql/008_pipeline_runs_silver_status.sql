-- =============================================================================
-- Fase 7: acompanhamento de execução (Studio Visual ETL) — espelha em pipeline_runs
-- o mesmo padrão que 007 criou para a Bronze, agora também para a Silver, e
-- passa a ser gravado também pelo botão manual "Executar Pipeline" (não só pelo
-- auto-sync), via updatePipelineRunLayerStatus() em src/lib/supabase.ts.
--
-- Rode este script no SQL Editor do Supabase (mesmo projeto de 001..007).
-- =============================================================================

alter table pipeline_runs
  add column if not exists silver_status text
    check (silver_status in ('not_applicable', 'built', 'failed'))
    default 'not_applicable',
  add column if not exists silver_built_em timestamptz,
  add column if not exists silver_error text;

comment on column pipeline_runs.silver_status is
  'Estado da construção da Camada Silver para este job do Airbyte (gravado por handleExecutePipeline no Studio, via updatePipelineRunLayerStatus). "not_applicable" até a tentativa acontecer; "built"/"failed" depois da tentativa real.';
comment on column pipeline_runs.silver_error is
  'Detalhe do erro (tabelas que falharam) quando silver_status = ''failed''. Nulo em qualquer outro estado.';

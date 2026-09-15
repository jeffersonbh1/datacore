-- =============================================================================
-- Fase 6: dispara a Camada Bronze automaticamente depois de cada sync do
-- Airbyte, em vez de depender do botão manual no Studio (Fase 5).
--
-- Rode este script no SQL Editor do Supabase (mesmo projeto de 001..006).
--
-- Um Cloud Scheduler job chama POST /api/bigquery/bronze/auto-sync no gateway
-- a cada poucos minutos (Cloud Run escala a zero, não dá pra manter um loop
-- vivo dentro do processo). Essas colunas em pipeline_runs evitam que a mesma
-- rodada da Bronze seja disparada duas vezes para o mesmo job do Airbyte.
-- =============================================================================

ALTER TABLE pipeline_runs
  ADD COLUMN IF NOT EXISTS bronze_status TEXT
    CHECK (bronze_status IN ('not_applicable', 'built', 'failed'))
    DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS bronze_built_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bronze_error TEXT;

COMMENT ON COLUMN pipeline_runs.bronze_status IS
  'Estado da construção da Camada Bronze para este job do Airbyte (ver POST /api/bigquery/bronze/auto-sync). "not_applicable" até a tentativa acontecer (destino não-BigQuery, job ainda não sucedido, etc.); "built"/"failed" depois da tentativa real.';
COMMENT ON COLUMN pipeline_runs.bronze_error IS
  'Detalhe do erro (JSON com as tabelas que falharam) quando bronze_status = ''failed''. Nulo em qualquer outro estado.';

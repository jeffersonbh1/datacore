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

alter table pipeline_runs
  add column if not exists bronze_status text
    check (bronze_status in ('not_applicable', 'built', 'failed'))
    default 'not_applicable',
  add column if not exists bronze_built_em timestamptz,
  add column if not exists bronze_error text;

comment on column pipeline_runs.bronze_status is
  'Estado da construção da Camada Bronze para este job do Airbyte (ver POST /api/bigquery/bronze/auto-sync). "not_applicable" até a tentativa acontecer (destino não-BigQuery, job ainda não sucedido, etc.); "built"/"failed" depois da tentativa real.';
comment on column pipeline_runs.bronze_error is
  'Detalhe do erro (JSON com as tabelas que falharam) quando bronze_status = ''failed''. Nulo em qualquer outro estado.';

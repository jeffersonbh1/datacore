-- =============================================================================
-- Fase 7 (continuação): detalhe por tabela de cada construção de Bronze/Silver,
-- para a tela "Execuções" — a linha do run continua mostrando só o resumo
-- (Raw/Bronze/Silver), mas o usuário pode expandir e ver quais tabelas compõem
-- a integração, o status e a quantidade de registros de cada uma.
--
-- Gravado por VisualCanvas.handleExecutePipeline (a partir de BronzeTableResult/
-- rowsAffected, que vem de adapter_response.rows_affected do dbt-bigquery — ver
-- server/dbtRunner.ts) via updatePipelineRunLayerStatus() em src/lib/supabase.ts.
--
-- Rode este script no SQL Editor do Supabase (mesmo projeto de 001..009).
-- =============================================================================

alter table pipeline_runs
  add column if not exists bronze_tables jsonb,
  add column if not exists silver_tables jsonb;

comment on column pipeline_runs.bronze_tables is
  'Detalhe por tabela da construção da Bronze deste job: [{"table":"clientes","status":"ok","rowsAffected":123,"error":null}, ...]. Null até a primeira tentativa.';
comment on column pipeline_runs.silver_tables is
  'Mesma coisa, para a Silver.';

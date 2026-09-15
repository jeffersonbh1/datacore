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

ALTER TABLE pipeline_runs
  ADD COLUMN IF NOT EXISTS bronze_tables JSONB,
  ADD COLUMN IF NOT EXISTS silver_tables JSONB;

COMMENT ON COLUMN pipeline_runs.bronze_tables IS
  'Detalhe por tabela da construção da Bronze deste job: [{"table":"clientes","status":"ok","rowsAffected":123,"error":null}, ...]. Null até a primeira tentativa.';
COMMENT ON COLUMN pipeline_runs.silver_tables IS
  'Mesma coisa, para a Silver.';

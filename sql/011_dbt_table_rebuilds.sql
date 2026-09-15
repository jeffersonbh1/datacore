-- =============================================================================
-- Reexecução manual de UMA tabela da Bronze/Silver que falhou (tela "Execuções"),
-- sem precisar rodar o pipeline inteiro de novo. Duas gravações por tentativa:
--
--   1) pipeline_runs.bronze_tables/silver_tables (já existe, sql/010) — a linha
--      do run mais recente é atualizada com o novo resultado dessa tabela
--      (mescla com as demais, que não são retocadas), via updatePipelineRunLayerStatus()
--      — mantém o status "atual" da tabela correto sem criar uma linha nova.
--
--   2) esta tabela nova, dbt_table_rebuilds — um INSERT (nunca update) por
--      tentativa, pra empilhar o histórico de reexecuções manuais de uma mesma
--      tabela: se falhar 3 vezes seguidas, as 3 tentativas ficam visíveis no
--      botão "Log" (fetchTableRebuildHistory), em vez da última sobrescrever
--      a anterior.
--
-- Gravado por insertTableRebuildAttempt() em src/lib/supabase.ts, chamado pelo
-- botão "Executar" de ExecutionsView.tsx (LayerTablesList). Lido só por
-- fetchTableRebuildHistory(), pro modal de log da tabela.
--
-- Rode este script no SQL Editor do Supabase (mesmo projeto de 001..010).
-- =============================================================================

CREATE TABLE IF NOT EXISTS dbt_table_rebuilds (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pipeline_id BIGINT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  id_empresa BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  layer TEXT NOT NULL CHECK (layer IN ('bronze', 'silver')),
  table_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
  rows_affected BIGINT,
  error TEXT,
  executado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE dbt_table_rebuilds IS
  'Histórico empilhado (1 linha por tentativa, nunca sobrescrita) de reexecuções manuais de uma tabela específica da Bronze/Silver via botão "Executar" em Execuções. Complementar a pipeline_runs.bronze_tables/silver_tables, que só guarda o resultado mais recente por run.';

CREATE INDEX IF NOT EXISTS idx_dbt_table_rebuilds_lookup
  ON dbt_table_rebuilds(pipeline_id, layer, table_name, executado_em DESC);

ALTER TABLE dbt_table_rebuilds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dbt_table_rebuilds_tenant_isolation" ON dbt_table_rebuilds
  FOR ALL
  USING (id_empresa = (SELECT id_empresa FROM usuarios WHERE auth_user_id = auth.uid()))
  WITH CHECK (id_empresa = (SELECT id_empresa FROM usuarios WHERE auth_user_id = auth.uid()));

-- Rollback de emergência:
-- drop table if exists dbt_table_rebuilds;

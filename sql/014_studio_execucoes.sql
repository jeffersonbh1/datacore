-- =============================================================================
-- Registro de TODA execução feita no "Studio Visual ETL Gold" — do fluxo inteiro
-- ("Executar fluxo até aqui") ou de uma única tabela ("Executar esta tabela"),
-- com ou sem sincronização no Airbyte, em qualquer camada (inclusive Gold).
--
-- Por que uma tabela nova: pipeline_runs (sql/003) guarda um job do Airbyte por
-- linha e é por integração. Uma execução sem sync não tem job, uma tabela isolada
-- não tem "run" onde caber e o Gold (que cruza integrações) não pertence a pipeline
-- nenhum. Aqui a unidade é a EXECUÇÃO: uma linha por clique em "Executar", com o
-- resultado de cada tabela dentro de `itens`.
--
-- Ciclo de vida de uma linha (src/lib/studioExecutions.ts, ExecutionRecorder):
--   1) INSERT ao começar (status 'running', itens vazio) — assim a tela Execuções
--      já mostra "Em andamento" e a linha sobrevive se o usuário fechar a aba;
--   2) UPDATE de `itens` a cada tabela concluída;
--   3) UPDATE final: status success | failed | cancelled + finalizado_em.
-- Uma linha presa em 'running' há muito tempo (aba fechada no meio) é exibida como
-- "Interrompida" pela tela — ver StudioExecutionsSection.tsx.
--
-- Formato de cada elemento de `itens` (ver ExecItem em studioExecutions.ts):
--   { "layer": "raw|bronze|silver|gold", "name": "...", "integration": "..."|null,
--     "status": "ok|error|skipped", "rowsAffected": 123|null, "error": "..."|null,
--     "tests": { "total": 15, "failed": ["nome_do_teste"] } | null }
--   layer 'raw' = a sincronização da integração no Airbyte (name = nome da integração).
--
-- Rode este script no SQL Editor do Supabase (mesmo projeto de 001..013).
-- =============================================================================

CREATE TABLE IF NOT EXISTS studio_execucoes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_empresa BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  escopo TEXT NOT NULL CHECK (escopo IN ('tabela', 'fluxo')),
  alvo_nome TEXT NOT NULL,
  alvo_camada TEXT NOT NULL CHECK (alvo_camada IN ('raw', 'bronze', 'silver', 'gold')),
  com_sincronizacao BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed', 'cancelled')),
  itens JSONB NOT NULL DEFAULT '[]'::jsonb,
  executado_por TEXT,
  iniciado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalizado_em TIMESTAMPTZ
);

COMMENT ON TABLE studio_execucoes IS
  'Uma linha por execução disparada no Studio Visual ETL Gold (fluxo ou tabela única), com o resultado de cada tabela em `itens`. Lida pela tela Execuções.';

CREATE INDEX IF NOT EXISTS idx_studio_execucoes_empresa
  ON studio_execucoes(id_empresa, iniciado_em DESC);

ALTER TABLE studio_execucoes ENABLE ROW LEVEL SECURITY;

-- Isolamento por empresa, no mesmo padrão de dbt_table_rebuilds (sql/011).
CREATE POLICY "studio_execucoes_tenant_isolation" ON studio_execucoes
  FOR ALL
  USING (id_empresa = (SELECT id_empresa FROM usuarios WHERE auth_user_id = auth.uid()))
  WITH CHECK (id_empresa = (SELECT id_empresa FROM usuarios WHERE auth_user_id = auth.uid()));

-- Rollback de emergência:
-- drop table if exists studio_execucoes;

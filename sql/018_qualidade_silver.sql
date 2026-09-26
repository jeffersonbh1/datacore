-- =============================================================================
-- Qualidade de dados na camada Silver (fase 1): regras declaradas na tela
-- "Qualidade de Dados" e o resultado de cada execução da Silver.
--
-- qualidade_regras     regras de linha por tabela Silver (not_null,
--                      accepted_values, range). Linha que viola alguma regra
--                      vai para a quarentena silver_<sistema>_<tabela>_rejeitados
--                      (BigQuery) em vez da Silver.
-- qualidade_execucoes  uma linha por tabela Silver construída: contagens
--                      (Bronze, Silver, rejeitadas por motivo) e testes dbt.
--
-- Escrita SÓ pelo gateway (service role): a regra vira SQL no modelo dbt, então
-- é o gateway que valida coluna/tipo/parâmetros antes de gravar
-- (server/routes/quality.ts). O navegador só lê, isolado por empresa via RLS
-- (mesmo padrão de 015_raw_failure_policy.sql).
--
-- Rode este script no SQL Editor do Supabase, depois de 001..017.
-- =============================================================================

CREATE TABLE IF NOT EXISTS qualidade_regras (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_empresa BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  integracao_id BIGINT NOT NULL REFERENCES integracoes(id) ON DELETE CASCADE,
  -- Tabela de origem (stream) e o modelo Silver gerado a partir dela.
  tabela TEXT NOT NULL,
  modelo TEXT NOT NULL,
  -- Nome da coluna NA SILVER (padronizado, ex.: vlr_total).
  coluna TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('not_null', 'accepted_values', 'range')),
  -- accepted_values: {"valores": ["PAGO", "PENDENTE"]}
  -- range:           {"min": 0, "max": 100}  (número, ou data 'AAAA-MM-DD'; um dos dois pode faltar)
  parametros JSONB NOT NULL DEFAULT '{}'::jsonb,
  acao TEXT NOT NULL DEFAULT 'quarentena' CHECK (acao IN ('quarentena')),
  origem TEXT NOT NULL DEFAULT 'usuario' CHECK (origem IN ('usuario')),
  status TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'inativa')),
  criado_por TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE qualidade_regras IS
  'Regras de qualidade de linha por tabela Silver. Viram SQL no modelo gerado (server/dbtCodegen.ts); linha que viola vai para silver_<sistema>_<tabela>_rejeitados.';

CREATE INDEX IF NOT EXISTS idx_qualidade_regras_modelo
  ON qualidade_regras(id_empresa, integracao_id, tabela);

CREATE TABLE IF NOT EXISTS qualidade_execucoes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_empresa BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  integracao_id BIGINT NOT NULL REFERENCES integracoes(id) ON DELETE CASCADE,
  tabela TEXT NOT NULL,
  modelo TEXT NOT NULL,
  dbt_invocation_id TEXT,
  executado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Total de linhas nas tabelas depois do build.
  linhas_bronze BIGINT,
  linhas_silver BIGINT,
  -- Nesta execução: linhas gravadas na Silver (rows_affected do dbt) e
  -- linhas que foram para a quarentena.
  linhas_processadas BIGINT,
  linhas_rejeitadas BIGINT NOT NULL DEFAULT 0,
  -- {"<id da regra>": <qtd de linhas>} desta execução.
  motivos JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- [{"nome": "...", "status": "pass|fail|warn|error|skipped", "mensagem": "..."}]
  testes JSONB NOT NULL DEFAULT '[]'::jsonb,
  testes_aprovados INT NOT NULL DEFAULT 0,
  testes_total INT NOT NULL DEFAULT 0,
  -- Regras ativas no modelo no momento da execução.
  regras_ativas INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('ok', 'rejeicoes', 'teste_falhou', 'erro')),
  erro TEXT
);

COMMENT ON TABLE qualidade_execucoes IS
  'Resultado de qualidade de cada tabela Silver por execução (gravado pelo gateway ao fim do dbt build). Base da tela Qualidade de Dados.';

CREATE INDEX IF NOT EXISTS idx_qualidade_execucoes_tabela
  ON qualidade_execucoes(id_empresa, integracao_id, tabela, executado_em DESC);

ALTER TABLE qualidade_regras ENABLE ROW LEVEL SECURITY;
ALTER TABLE qualidade_execucoes ENABLE ROW LEVEL SECURITY;

-- Só leitura pelo navegador; o gateway (service role) ignora RLS para gravar.
CREATE POLICY "qualidade_regras_tenant_select" ON qualidade_regras
  FOR SELECT
  USING (id_empresa = (SELECT id_empresa FROM usuarios WHERE auth_user_id = auth.uid()));

CREATE POLICY "qualidade_execucoes_tenant_select" ON qualidade_execucoes
  FOR SELECT
  USING (id_empresa = (SELECT id_empresa FROM usuarios WHERE auth_user_id = auth.uid()));

-- Rollback de emergência:
-- drop table if exists qualidade_execucoes;
-- drop table if exists qualidade_regras;

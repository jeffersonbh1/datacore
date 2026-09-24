-- =============================================================================
-- Política de falha da camada Raw (ver docs/ARQUITETURA.md, "Política de falha
-- da Raw", e server/rawFailurePolicy.ts).
--
-- 1) pipeline_runs.raw_erro / raw_erro_categoria: o MOTIVO de um sync que
--    falhou no Airbyte (antes só havia status = 'failed', sem explicação).
-- 2) alertas_ingestao: um alerta por sync que falhou, visível para TODOS os
--    usuários da empresa na tela Execuções (não só para quem clicou em
--    "Executar") até alguém marcá-lo como resolvido. Ainda não há SMTP/domínio,
--    então o alerta é dentro do app.
--
-- Gravado por: gateway (bronzeAutoSync, service role) e pelo Studio Gold
-- (src/lib/lineageExecution.ts, sessão do usuário — por isso a RLS abaixo).
--
-- Rode este script no SQL Editor do Supabase (mesmo projeto de 001..014).
-- =============================================================================

ALTER TABLE pipeline_runs
  ADD COLUMN IF NOT EXISTS raw_erro TEXT,
  ADD COLUMN IF NOT EXISTS raw_erro_categoria TEXT;

COMMENT ON COLUMN pipeline_runs.raw_erro IS
  'Motivo da falha do sync no Airbyte (mensagem acionável + mensagem original). Nulo se o job não falhou.';
COMMENT ON COLUMN pipeline_runs.raw_erro_categoria IS
  'schema_incompativel | configuracao | origem | destino | transitorio | plataforma | desconhecido.';

CREATE TABLE IF NOT EXISTS alertas_ingestao (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_empresa BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  integracao_id BIGINT REFERENCES integracoes(id) ON DELETE CASCADE,
  integracao_nome TEXT NOT NULL,
  airbyte_job_id BIGINT,
  categoria TEXT NOT NULL,
  severidade TEXT NOT NULL CHECK (severidade IN ('critica', 'alta')),
  mensagem TEXT NOT NULL,
  detalhe TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolvido_em TIMESTAMPTZ,
  resolvido_por TEXT
);

COMMENT ON TABLE alertas_ingestao IS
  'Um alerta por sync da Raw que falhou no Airbyte. Aberto até resolvido_em ser preenchido (tela Execuções).';

-- O mesmo job nunca gera dois alertas (auto-sync e Studio podem ver a mesma falha).
CREATE UNIQUE INDEX IF NOT EXISTS uq_alertas_ingestao_job
  ON alertas_ingestao(integracao_id, airbyte_job_id);

CREATE INDEX IF NOT EXISTS idx_alertas_ingestao_abertos
  ON alertas_ingestao(id_empresa, criado_em DESC) WHERE resolvido_em IS NULL;

ALTER TABLE alertas_ingestao ENABLE ROW LEVEL SECURITY;

CREATE POLICY "alertas_ingestao_tenant_isolation" ON alertas_ingestao
  FOR ALL
  USING (id_empresa = (SELECT id_empresa FROM usuarios WHERE auth_user_id = auth.uid()))
  WITH CHECK (id_empresa = (SELECT id_empresa FROM usuarios WHERE auth_user_id = auth.uid()));

-- Rollback de emergência:
-- drop table if exists alertas_ingestao;
-- alter table pipeline_runs drop column if exists raw_erro, drop column if exists raw_erro_categoria;

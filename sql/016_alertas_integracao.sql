-- =============================================================================
-- Alertas por integração (tela Pipelines & Fluxos): toda alteração relevante de
-- uma integração vira um alerta em alertas_ingestao (sql/015), que o engenheiro
-- de dados marca como ciente/resolvido — e ele passa para o histórico.
--
-- 1) alertas_ingestao.tipo: de onde veio o alerta
--      falha_sync           sync da Raw falhou no Airbyte (sql/015)
--      mudanca_schema       schema da origem mudou (server/schemaChangeCheck.ts)
--      alteracao_integracao tabelas incluídas/removidas pelo Editar
--      falha_construcao     Bronze/Silver falhou no Studio Visual ETL Gold
-- 2) severidade ganha 'media' e 'info' (mudanças que não quebram nada).
-- 3) integracoes.schema_snapshot: última "foto" do schema da origem (tabelas,
--    colunas + tipo, chave primária) — base da comparação que gera os alertas
--    de mudança de schema. A primeira verificação só grava a foto.
--
-- Rode este script no SQL Editor do Supabase (mesmo projeto de 001..015).
-- =============================================================================

ALTER TABLE alertas_ingestao
  ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'falha_sync';

ALTER TABLE alertas_ingestao DROP CONSTRAINT IF EXISTS alertas_ingestao_tipo_check;
ALTER TABLE alertas_ingestao ADD CONSTRAINT alertas_ingestao_tipo_check
  CHECK (tipo IN ('falha_sync', 'mudanca_schema', 'alteracao_integracao', 'falha_construcao'));

ALTER TABLE alertas_ingestao DROP CONSTRAINT IF EXISTS alertas_ingestao_severidade_check;
ALTER TABLE alertas_ingestao ADD CONSTRAINT alertas_ingestao_severidade_check
  CHECK (severidade IN ('critica', 'alta', 'media', 'info'));

COMMENT ON COLUMN alertas_ingestao.tipo IS
  'falha_sync | mudanca_schema | alteracao_integracao | falha_construcao.';

CREATE INDEX IF NOT EXISTS idx_alertas_ingestao_integracao
  ON alertas_ingestao(integracao_id, criado_em DESC);

ALTER TABLE integracoes
  ADD COLUMN IF NOT EXISTS schema_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS schema_verificado_em TIMESTAMPTZ;

COMMENT ON COLUMN integracoes.schema_snapshot IS
  'Última foto do schema da origem: {"<tabela>": {"columns": {"<coluna>": "<tipo>"}, "pk": ["<coluna>"]}}. Base da detecção de mudança de schema.';

-- Rollback de emergência:
-- alter table integracoes drop column if exists schema_snapshot, drop column if exists schema_verificado_em;
-- alter table alertas_ingestao drop constraint if exists alertas_ingestao_tipo_check, drop column if exists tipo;
-- alter table alertas_ingestao drop constraint if exists alertas_ingestao_severidade_check;
-- alter table alertas_ingestao add constraint alertas_ingestao_severidade_check check (severidade in ('critica','alta'));

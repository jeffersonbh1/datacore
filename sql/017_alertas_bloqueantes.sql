-- =============================================================================
-- Alertas bloqueantes: mudança de schema que pode quebrar as camadas seguintes
-- (tipo de coluna alterado, coluna removida, chave primária alterada, tabela
-- integrada removida da origem) BLOQUEIA a atualização da tabela.
--
-- Enquanto houver um alerta aberto com bloqueante = true para uma tabela, a
-- Bronze, a Silver e o Gold que dependem dela não são construídos — continuam
-- com os dados da última carga que deu certo (a Raw, área de pouso, segue
-- recebendo). Marcar o alerta como ciente/resolvido libera a atualização.
--
-- Quem grava: server/schemaChangeCheck.ts. Quem respeita o bloqueio: Studio
-- Visual ETL Gold (src/lib/lineageExecution.ts) e os auto-syncs do gateway.
--
-- Rode este script no SQL Editor do Supabase (mesmo projeto de 001..016).
-- =============================================================================

ALTER TABLE alertas_ingestao
  ADD COLUMN IF NOT EXISTS tabela TEXT,
  ADD COLUMN IF NOT EXISTS bloqueante BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN alertas_ingestao.tabela IS
  'Tabela (stream da origem) a que o alerta se refere, quando for de uma tabela específica.';
COMMENT ON COLUMN alertas_ingestao.bloqueante IS
  'true = enquanto aberto, Bronze/Silver/Gold desta tabela não são atualizados. Resolver libera.';

CREATE INDEX IF NOT EXISTS idx_alertas_ingestao_bloqueantes
  ON alertas_ingestao(integracao_id) WHERE bloqueante AND resolvido_em IS NULL;

-- Rollback de emergência:
-- drop index if exists idx_alertas_ingestao_bloqueantes;
-- alter table alertas_ingestao drop column if exists tabela, drop column if exists bloqueante;

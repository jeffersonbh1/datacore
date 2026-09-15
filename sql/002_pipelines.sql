-- =============================================================================
-- Fase 1 da persistência de pipelines: até aqui, o "Pipeline" (topologia visual
-- no Studio) só existia como estado React, gerado uma única vez no momento da
-- criação da integração e perdido a cada refresh — mesmo a "integracoes" já
-- sendo persistida. Esta migration cria a tabela que fecha esse gap.
--
-- Rode este script no SQL Editor do Supabase (mesmo projeto de 001_multi_tenant_empresas.sql).
--
-- Design: "pipelines" NÃO guarda a topologia (nodes/edges) como fonte da
-- verdade — isso é derivado deterministicamente de "integracoes" (origem,
-- destino, tabelas, sanitização LGPD) por buildPipelineFromIntegration()
-- em src/lib/pipelineBuilder.ts, tanto na criação quanto ao recarregar a
-- página. Esta tabela guarda só o que não é derivável: o vínculo estável
-- com a integração, metadados de exibição e customizações do usuário no
-- canvas (layout_overrides). Métricas de execução (registros processados,
-- latência, status do último sync) ficam para a Fase 2, numa tabela própria
-- de séries temporais (pipeline_runs) alimentada pelo histórico real de
-- jobs do Airbyte — não campos estáticos aqui.
-- =============================================================================

CREATE TABLE IF NOT EXISTS pipelines (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_empresa BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  integracao_id BIGINT NOT NULL UNIQUE REFERENCES integracoes(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  categoria TEXT NOT NULL DEFAULT 'Integração Automática Lakehouse',
  camadas TEXT[] NOT NULL DEFAULT '{raw,bronze,silver}',
  layout_overrides JSONB NOT NULL DEFAULT '{}'::JSONB,
  criado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE pipelines IS
  'Vitrine 1:1 de uma integração no Studio Visual ETL. A topologia (nodes/edges) é derivada de integracoes por buildPipelineFromIntegration(), não armazenada aqui — só o vínculo estável, metadados de exibição e layout_overrides (posições de nó customizadas pelo usuário).';
COMMENT ON COLUMN pipelines.layout_overrides IS
  'Só posições {node_id: {x,y}} arrastadas pelo usuário no canvas. Nunca a topologia inteira.';

CREATE INDEX IF NOT EXISTS idx_pipelines_empresa ON pipelines(id_empresa);
CREATE INDEX IF NOT EXISTS idx_pipelines_integracao ON pipelines(integracao_id);

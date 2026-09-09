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

create table if not exists pipelines (
  id bigint generated always as identity primary key,
  id_empresa bigint not null references empresas(id) on delete cascade,
  integracao_id bigint not null unique references integracoes(id) on delete cascade,
  nome text not null,
  categoria text not null default 'Integração Automática Lakehouse',
  camadas text[] not null default '{raw,bronze,silver}',
  layout_overrides jsonb not null default '{}'::jsonb,
  criado_por uuid references usuarios(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table pipelines is
  'Vitrine 1:1 de uma integração no Studio Visual ETL. A topologia (nodes/edges) é derivada de integracoes por buildPipelineFromIntegration(), não armazenada aqui — só o vínculo estável, metadados de exibição e layout_overrides (posições de nó customizadas pelo usuário).';
comment on column pipelines.layout_overrides is
  'Só posições {node_id: {x,y}} arrastadas pelo usuário no canvas. Nunca a topologia inteira.';

create index if not exists idx_pipelines_empresa on pipelines(id_empresa);
create index if not exists idx_pipelines_integracao on pipelines(integracao_id);

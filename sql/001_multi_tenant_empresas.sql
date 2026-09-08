-- =============================================================================
-- Multi-tenant isolation for DataCore: empresas (tenants) + persistência real
-- de origens, destinos e integrações (hoje só existem em memória no React).
--
-- Rode este script no SQL Editor do Supabase (projeto usado em VITE_SUPABASE_URL).
--
-- IMPORTANTE: o login do DataCore não cria uma sessão real do Supabase Auth
-- (autenticação customizada contra a tabela "usuarios" com a anon key — ver
-- authenticateWithUsuarioTable em src/lib/supabase.ts). Isso significa que
-- políticas de RLS baseadas em auth.uid() NÃO funcionam aqui: auth.uid()
-- sempre retorna null nas requisições desta app. Por isso este script não
-- cria políticas de RLS por empresa — o isolamento por id_empresa precisa
-- ser garantido no código da aplicação/gateway (sempre filtrar/gravar com
-- WHERE id_empresa = ...), não no banco. Se um dia migrar para sessões reais
-- do Supabase Auth, revisite isso e adicione RLS de verdade.
-- =============================================================================

-- 1. Empresas (tenants) ------------------------------------------------------
create table if not exists empresas (
  id bigint generated always as identity primary key,
  nome text not null,
  slug text not null unique,
  airbyte_workspace_id uuid,
  status text not null default 'ativo'
    check (status in ('ativo', 'suspenso', 'trial', 'cancelado')),
  plano text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table empresas is
  'Empresas (tenants) que usam a plataforma DataCore. Cada empresa deve ter seu próprio workspace no Airbyte para isolamento real de conectores/conexões.';
comment on column empresas.airbyte_workspace_id is
  'Workspace ID no Airbyte dedicado a esta empresa. Nulo até o workspace ser provisionado.';

-- 2. usuarios.id_empresa passa a ser uma FK de verdade -----------------------
-- (a coluna já existe hoje solta, sem constraint — ver UsuarioDbRecord em src/types.ts)
alter table usuarios
  add constraint fk_usuarios_empresa
  foreign key (id_empresa) references empresas(id) on delete set null;

-- 3. Origens por empresa (hoje só existe como SourceConnectorConfig no React) -
create table if not exists origens (
  id bigint generated always as identity primary key,
  id_empresa bigint not null references empresas(id) on delete cascade,
  airbyte_source_id uuid not null,
  nome text not null,
  tipo text not null,
  configuracao jsonb not null default '{}'::jsonb,
  status text not null default 'connected'
    check (status in ('connected', 'untested', 'failed')),
  criado_em timestamptz not null default now(),
  unique (id_empresa, airbyte_source_id)
);

-- 4. Destinos por empresa (hoje só existe como DestinationConnectorConfig) ---
create table if not exists destinos (
  id bigint generated always as identity primary key,
  id_empresa bigint not null references empresas(id) on delete cascade,
  airbyte_destination_id uuid not null,
  nome text not null,
  tipo text not null,
  configuracao jsonb not null default '{}'::jsonb,
  modo_escrita text not null default 'merge_upsert'
    check (modo_escrita in ('append', 'merge_upsert', 'overwrite')),
  status text not null default 'connected'
    check (status in ('connected', 'untested', 'failed')),
  criado_em timestamptz not null default now(),
  unique (id_empresa, airbyte_destination_id)
);

-- 5. Integrações do Pipeline Automático por empresa --------------------------
-- (hoje só existe como AutoIntegration no React — table_sync_configs guarda
-- o que foi implementado na Etapa 3: tipo de carga/cursor/colunas por tabela)
create table if not exists integracoes (
  id bigint generated always as identity primary key,
  id_empresa bigint not null references empresas(id) on delete cascade,
  origem_id bigint not null references origens(id) on delete restrict,
  destino_id bigint not null references destinos(id) on delete restrict,
  airbyte_connection_id uuid,
  nome text not null,
  tabelas_selecionadas text[] not null default '{}',
  table_sync_configs jsonb not null default '{}'::jsonb,
  frequencia_sync text not null
    check (frequencia_sync in ('daily', 'weekly', 'monthly', 'once')),
  horarios_execucao text[] not null default '{}',
  dias_semana text[],
  dia_mensal smallint,
  data_execucao_unica date,
  resumo_agendamento text,
  aplicar_sanitizacao_lgpd boolean not null default true,
  status text not null default 'active'
    check (status in ('active', 'paused')),
  pipeline_id text,
  criado_em timestamptz not null default now()
);

-- Índices para consultas sempre escopadas por empresa ------------------------
create index if not exists idx_usuarios_empresa on usuarios(id_empresa);
create index if not exists idx_origens_empresa on origens(id_empresa);
create index if not exists idx_destinos_empresa on destinos(id_empresa);
create index if not exists idx_integracoes_empresa on integracoes(id_empresa);

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
CREATE TABLE IF NOT EXISTS empresas (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  airbyte_workspace_id UUID,
  status TEXT NOT NULL DEFAULT 'ativo'
    CHECK (status IN ('ativo', 'suspenso', 'trial', 'cancelado')),
  plano TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE empresas IS
  'Empresas (tenants) que usam a plataforma DataCore. Cada empresa deve ter seu próprio workspace no Airbyte para isolamento real de conectores/conexões.';
COMMENT ON COLUMN empresas.airbyte_workspace_id IS
  'Workspace ID no Airbyte dedicado a esta empresa. Nulo até o workspace ser provisionado.';

-- 2. usuarios.id_empresa passa a ser uma FK de verdade -----------------------
-- (a coluna já existe hoje solta, sem constraint — ver UsuarioDbRecord em src/types.ts)
ALTER TABLE usuarios
  ADD CONSTRAINT fk_usuarios_empresa
  FOREIGN KEY (id_empresa) REFERENCES empresas(id) ON DELETE SET NULL;

-- 3. Origens por empresa (hoje só existe como SourceConnectorConfig no React) -
CREATE TABLE IF NOT EXISTS origens (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_empresa BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  airbyte_source_id UUID NOT NULL,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL,
  configuracao JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'untested', 'failed')),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id_empresa, airbyte_source_id)
);

-- 4. Destinos por empresa (hoje só existe como DestinationConnectorConfig) ---
CREATE TABLE IF NOT EXISTS destinos (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_empresa BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  airbyte_destination_id UUID NOT NULL,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL,
  configuracao JSONB NOT NULL DEFAULT '{}'::JSONB,
  modo_escrita TEXT NOT NULL DEFAULT 'merge_upsert'
    CHECK (modo_escrita IN ('append', 'merge_upsert', 'overwrite')),
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'untested', 'failed')),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id_empresa, airbyte_destination_id)
);

-- 5. Integrações do Pipeline Automático por empresa --------------------------
-- (hoje só existe como AutoIntegration no React — table_sync_configs guarda
-- o que foi implementado na Etapa 3: tipo de carga/cursor/colunas por tabela)
CREATE TABLE IF NOT EXISTS integracoes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_empresa BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  origem_id BIGINT NOT NULL REFERENCES origens(id) ON DELETE RESTRICT,
  destino_id BIGINT NOT NULL REFERENCES destinos(id) ON DELETE RESTRICT,
  airbyte_connection_id UUID,
  nome TEXT NOT NULL,
  tabelas_selecionadas TEXT[] NOT NULL DEFAULT '{}',
  table_sync_configs JSONB NOT NULL DEFAULT '{}'::JSONB,
  frequencia_sync TEXT NOT NULL
    CHECK (frequencia_sync IN ('daily', 'weekly', 'monthly', 'once')),
  horarios_execucao TEXT[] NOT NULL DEFAULT '{}',
  dias_semana TEXT[],
  dia_mensal SMALLINT,
  data_execucao_unica DATE,
  resumo_agendamento TEXT,
  aplicar_sanitizacao_lgpd BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused')),
  pipeline_id TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices para consultas sempre escopadas por empresa ------------------------
CREATE INDEX IF NOT EXISTS idx_usuarios_empresa ON usuarios(id_empresa);
CREATE INDEX IF NOT EXISTS idx_origens_empresa ON origens(id_empresa);
CREATE INDEX IF NOT EXISTS idx_destinos_empresa ON destinos(id_empresa);
CREATE INDEX IF NOT EXISTS idx_integracoes_empresa ON integracoes(id_empresa);

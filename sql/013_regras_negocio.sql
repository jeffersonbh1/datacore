-- =============================================================================
-- Base de conhecimento do agente "Converse com os dados": regras de negócio,
-- métricas/KPIs, relacionamentos entre tabelas e padrões, POR EMPRESA.
--
-- O agente (gateway, service role) lê esta tabela pela ferramenta
-- search_knowledge; a tela "Converse com os dados" grava/edita direto do
-- navegador com a sessão real do usuário — por isso o isolamento por empresa é
-- feito por RLS (mesmo padrão de 005_rls_policies.sql: id_empresa do próprio
-- usuário via auth.uid()).
--
-- Rode este script no SQL Editor do Supabase, depois de 001..012.
-- =============================================================================

CREATE TABLE IF NOT EXISTS regras_negocio (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_empresa BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL
    CHECK (tipo IN ('regra_negocio', 'metrica', 'relacionamento', 'padrao')),
  titulo TEXT NOT NULL CHECK (char_length(titulo) BETWEEN 3 AND 200),
  descricao TEXT NOT NULL CHECK (char_length(descricao) BETWEEN 3 AND 4000),
  -- Modelos/tabelas a que a regra se refere (ex.: {silver_crm_pedidos,silver_crm_clientes}).
  tabelas_relacionadas TEXT[] NOT NULL DEFAULT '{}',
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_por UUID DEFAULT auth.uid(),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE regras_negocio IS
  'Conhecimento semântico por empresa consumido pelo agente "Converse com os dados": regras de negócio (ex.: "Faturamento = soma de valor_total dos pedidos APROVADO"), métricas, relacionamentos e padrões. Recuperado por palavras-chave na v1 (sem embeddings).';
COMMENT ON COLUMN regras_negocio.tipo IS
  'regra_negocio | metrica | relacionamento (ex.: "pedidos.id_cliente -> clientes.id_cliente, N:1") | padrao (convenção de modelagem).';

CREATE INDEX IF NOT EXISTS idx_regras_negocio_empresa ON regras_negocio(id_empresa, ativo);

ALTER TABLE regras_negocio ENABLE ROW LEVEL SECURITY;

CREATE POLICY "regras_negocio_tenant_isolation" ON regras_negocio
  FOR ALL
  USING (id_empresa = (SELECT id_empresa FROM usuarios WHERE auth_user_id = auth.uid()))
  WITH CHECK (id_empresa = (SELECT id_empresa FROM usuarios WHERE auth_user_id = auth.uid()));

-- =============================================================================
-- Rollback:
--   drop table regras_negocio;
-- =============================================================================

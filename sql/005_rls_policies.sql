-- =============================================================================
-- Fase 4 (passo 2 de 2): RLS de verdade. Só faz sentido depois de 004 (login
-- real via Supabase Auth) estar validado em produção — antes disso auth.uid()
-- é sempre null e estas políticas bloqueariam qualquer acesso.
--
-- Rode este script no SQL Editor do Supabase, depois de confirmar que o login
-- novo (e-mail/senha real, Supabase Auth) está funcionando.
--
-- Design: cada policy se apoia em "meu id_empresa" — a subquery
--   (select id_empresa from usuarios where auth_user_id = auth.uid())
-- só funciona porque a policy de SELECT em "usuarios" abaixo permite ler a
-- própria linha; não há recursão porque cada policy só enxerga a linha do
-- próprio usuário autenticado.
-- =============================================================================

-- 1. usuarios ------------------------------------------------------------
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usuarios_select_own_or_admin" ON usuarios
  FOR SELECT
  USING (
    auth_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM usuarios me WHERE me.auth_user_id = auth.uid() AND me.papel = 'admin')
  );

CREATE POLICY "usuarios_update_own" ON usuarios
  FOR UPDATE
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- Sem policy de INSERT/DELETE para anon/authenticated: contas só são criadas
-- pelo gateway via service role (Admin API), que ignora RLS.

-- 2. empresas --------------------------------------------------------------
ALTER TABLE empresas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "empresas_select_own_or_admin" ON empresas
  FOR SELECT
  USING (
    id = (SELECT id_empresa FROM usuarios WHERE auth_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM usuarios me WHERE me.auth_user_id = auth.uid() AND me.papel = 'admin')
  );

CREATE POLICY "empresas_write_admin_only" ON empresas
  FOR ALL
  USING (EXISTS (SELECT 1 FROM usuarios me WHERE me.auth_user_id = auth.uid() AND me.papel = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM usuarios me WHERE me.auth_user_id = auth.uid() AND me.papel = 'admin'));

-- 3. origens / destinos / integracoes / pipelines / pipeline_runs ----------
-- Isolamento por tenant: só enxerga/grava linhas da própria empresa.
ALTER TABLE origens ENABLE ROW LEVEL SECURITY;
ALTER TABLE destinos ENABLE ROW LEVEL SECURITY;
ALTER TABLE integracoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "origens_tenant_isolation" ON origens
  FOR ALL
  USING (id_empresa = (SELECT id_empresa FROM usuarios WHERE auth_user_id = auth.uid()))
  WITH CHECK (id_empresa = (SELECT id_empresa FROM usuarios WHERE auth_user_id = auth.uid()));

CREATE POLICY "destinos_tenant_isolation" ON destinos
  FOR ALL
  USING (id_empresa = (SELECT id_empresa FROM usuarios WHERE auth_user_id = auth.uid()))
  WITH CHECK (id_empresa = (SELECT id_empresa FROM usuarios WHERE auth_user_id = auth.uid()));

CREATE POLICY "integracoes_tenant_isolation" ON integracoes
  FOR ALL
  USING (id_empresa = (SELECT id_empresa FROM usuarios WHERE auth_user_id = auth.uid()))
  WITH CHECK (id_empresa = (SELECT id_empresa FROM usuarios WHERE auth_user_id = auth.uid()));

CREATE POLICY "pipelines_tenant_isolation" ON pipelines
  FOR ALL
  USING (id_empresa = (SELECT id_empresa FROM usuarios WHERE auth_user_id = auth.uid()))
  WITH CHECK (id_empresa = (SELECT id_empresa FROM usuarios WHERE auth_user_id = auth.uid()));

CREATE POLICY "pipeline_runs_tenant_isolation" ON pipeline_runs
  FOR ALL
  USING (id_empresa = (SELECT id_empresa FROM usuarios WHERE auth_user_id = auth.uid()))
  WITH CHECK (id_empresa = (SELECT id_empresa FROM usuarios WHERE auth_user_id = auth.uid()));

-- =============================================================================
-- Rollback de emergência (rode manualmente se algo travar o acesso):
--
-- alter table usuarios disable row level security;
-- alter table empresas disable row level security;
-- alter table origens disable row level security;
-- alter table destinos disable row level security;
-- alter table integracoes disable row level security;
-- alter table pipelines disable row level security;
-- alter table pipeline_runs disable row level security;
-- =============================================================================

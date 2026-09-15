-- =============================================================================
-- Correção urgente: sql/005 causou "infinite recursion detected in policy for
-- relation usuarios" — a própria policy de SELECT em "usuarios" consultava
-- "usuarios" de novo (pra checar papel='admin'), o que reaplica a mesma policy
-- recursivamente. Bloqueava até o login.
--
-- Fix padrão do Postgres/Supabase: funções SECURITY DEFINER, que rodam com o
-- privilégio de quem as criou (bypassa RLS), usadas nas policies em vez de
-- subqueries cruas que reacionam RLS na própria tabela.
--
-- Rode este script no SQL Editor do Supabase AGORA, antes de testar login de novo.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS BOOLEAN
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuarios WHERE auth_user_id = auth.uid() AND papel = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.my_empresa_id() RETURNS BIGINT
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT id_empresa FROM usuarios WHERE auth_user_id = auth.uid();
$$;

DROP POLICY IF EXISTS "usuarios_select_own_or_admin" ON usuarios;
CREATE POLICY "usuarios_select_own_or_admin" ON usuarios
  FOR SELECT
  USING (auth_user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "empresas_select_own_or_admin" ON empresas;
CREATE POLICY "empresas_select_own_or_admin" ON empresas
  FOR SELECT
  USING (id = public.my_empresa_id() OR public.is_admin());

DROP POLICY IF EXISTS "empresas_write_admin_only" ON empresas;
CREATE POLICY "empresas_write_admin_only" ON empresas
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "origens_tenant_isolation" ON origens;
CREATE POLICY "origens_tenant_isolation" ON origens
  FOR ALL
  USING (id_empresa = public.my_empresa_id())
  WITH CHECK (id_empresa = public.my_empresa_id());

DROP POLICY IF EXISTS "destinos_tenant_isolation" ON destinos;
CREATE POLICY "destinos_tenant_isolation" ON destinos
  FOR ALL
  USING (id_empresa = public.my_empresa_id())
  WITH CHECK (id_empresa = public.my_empresa_id());

DROP POLICY IF EXISTS "integracoes_tenant_isolation" ON integracoes;
CREATE POLICY "integracoes_tenant_isolation" ON integracoes
  FOR ALL
  USING (id_empresa = public.my_empresa_id())
  WITH CHECK (id_empresa = public.my_empresa_id());

DROP POLICY IF EXISTS "pipelines_tenant_isolation" ON pipelines;
CREATE POLICY "pipelines_tenant_isolation" ON pipelines
  FOR ALL
  USING (id_empresa = public.my_empresa_id())
  WITH CHECK (id_empresa = public.my_empresa_id());

DROP POLICY IF EXISTS "pipeline_runs_tenant_isolation" ON pipeline_runs;
CREATE POLICY "pipeline_runs_tenant_isolation" ON pipeline_runs
  FOR ALL
  USING (id_empresa = public.my_empresa_id())
  WITH CHECK (id_empresa = public.my_empresa_id());

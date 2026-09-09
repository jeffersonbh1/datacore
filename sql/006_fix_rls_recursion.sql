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

create or replace function public.is_admin() returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from usuarios where auth_user_id = auth.uid() and papel = 'admin'
  );
$$;

create or replace function public.my_empresa_id() returns bigint
language sql security definer stable
set search_path = public
as $$
  select id_empresa from usuarios where auth_user_id = auth.uid();
$$;

drop policy if exists "usuarios_select_own_or_admin" on usuarios;
create policy "usuarios_select_own_or_admin" on usuarios
  for select
  using (auth_user_id = auth.uid() or public.is_admin());

drop policy if exists "empresas_select_own_or_admin" on empresas;
create policy "empresas_select_own_or_admin" on empresas
  for select
  using (id = public.my_empresa_id() or public.is_admin());

drop policy if exists "empresas_write_admin_only" on empresas;
create policy "empresas_write_admin_only" on empresas
  for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "origens_tenant_isolation" on origens;
create policy "origens_tenant_isolation" on origens
  for all
  using (id_empresa = public.my_empresa_id())
  with check (id_empresa = public.my_empresa_id());

drop policy if exists "destinos_tenant_isolation" on destinos;
create policy "destinos_tenant_isolation" on destinos
  for all
  using (id_empresa = public.my_empresa_id())
  with check (id_empresa = public.my_empresa_id());

drop policy if exists "integracoes_tenant_isolation" on integracoes;
create policy "integracoes_tenant_isolation" on integracoes
  for all
  using (id_empresa = public.my_empresa_id())
  with check (id_empresa = public.my_empresa_id());

drop policy if exists "pipelines_tenant_isolation" on pipelines;
create policy "pipelines_tenant_isolation" on pipelines
  for all
  using (id_empresa = public.my_empresa_id())
  with check (id_empresa = public.my_empresa_id());

drop policy if exists "pipeline_runs_tenant_isolation" on pipeline_runs;
create policy "pipeline_runs_tenant_isolation" on pipeline_runs
  for all
  using (id_empresa = public.my_empresa_id())
  with check (id_empresa = public.my_empresa_id());

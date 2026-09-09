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
alter table usuarios enable row level security;

create policy "usuarios_select_own_or_admin" on usuarios
  for select
  using (
    auth_user_id = auth.uid()
    or exists (select 1 from usuarios me where me.auth_user_id = auth.uid() and me.papel = 'admin')
  );

create policy "usuarios_update_own" on usuarios
  for update
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- Sem policy de INSERT/DELETE para anon/authenticated: contas só são criadas
-- pelo gateway via service role (Admin API), que ignora RLS.

-- 2. empresas --------------------------------------------------------------
alter table empresas enable row level security;

create policy "empresas_select_own_or_admin" on empresas
  for select
  using (
    id = (select id_empresa from usuarios where auth_user_id = auth.uid())
    or exists (select 1 from usuarios me where me.auth_user_id = auth.uid() and me.papel = 'admin')
  );

create policy "empresas_write_admin_only" on empresas
  for all
  using (exists (select 1 from usuarios me where me.auth_user_id = auth.uid() and me.papel = 'admin'))
  with check (exists (select 1 from usuarios me where me.auth_user_id = auth.uid() and me.papel = 'admin'));

-- 3. origens / destinos / integracoes / pipelines / pipeline_runs ----------
-- Isolamento por tenant: só enxerga/grava linhas da própria empresa.
alter table origens enable row level security;
alter table destinos enable row level security;
alter table integracoes enable row level security;
alter table pipelines enable row level security;
alter table pipeline_runs enable row level security;

create policy "origens_tenant_isolation" on origens
  for all
  using (id_empresa = (select id_empresa from usuarios where auth_user_id = auth.uid()))
  with check (id_empresa = (select id_empresa from usuarios where auth_user_id = auth.uid()));

create policy "destinos_tenant_isolation" on destinos
  for all
  using (id_empresa = (select id_empresa from usuarios where auth_user_id = auth.uid()))
  with check (id_empresa = (select id_empresa from usuarios where auth_user_id = auth.uid()));

create policy "integracoes_tenant_isolation" on integracoes
  for all
  using (id_empresa = (select id_empresa from usuarios where auth_user_id = auth.uid()))
  with check (id_empresa = (select id_empresa from usuarios where auth_user_id = auth.uid()));

create policy "pipelines_tenant_isolation" on pipelines
  for all
  using (id_empresa = (select id_empresa from usuarios where auth_user_id = auth.uid()))
  with check (id_empresa = (select id_empresa from usuarios where auth_user_id = auth.uid()));

create policy "pipeline_runs_tenant_isolation" on pipeline_runs
  for all
  using (id_empresa = (select id_empresa from usuarios where auth_user_id = auth.uid()))
  with check (id_empresa = (select id_empresa from usuarios where auth_user_id = auth.uid()));

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

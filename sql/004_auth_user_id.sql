-- =============================================================================
-- Fase 4 (passo 1 de 2): liga cada linha de "usuarios" a uma identidade real do
-- Supabase Auth. Até aqui o login consultava "usuarios" direto com a anon key
-- e comparava bcrypt NO NAVEGADOR (ver authenticateWithUsuarioTable, removida
-- do código) — qualquer um com a anon key (pública, embutida no bundle JS)
-- conseguia ler senha_hash de qualquer usuário. Isso substitui a senha por
-- sessões reais do Supabase Auth, único jeito de auth.uid() funcionar e RLS
-- de verdade (isolamento por empresa) ser possível.
--
-- Rode este script no SQL Editor do Supabase, depois de 001..003.
-- NÃO habilita RLS ainda — isso é o passo 2 (005_rls_policies.sql), aplicado só
-- depois de confirmar que o login novo funciona de ponta a ponta.
-- =============================================================================

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE;

COMMENT ON COLUMN usuarios.auth_user_id IS
  'Identidade real no Supabase Auth (auth.users). Senha e sessão vivem só ali agora — usuarios.senha_hash está obsoleta, o app não lê nem escreve mais nela (mantida só por ser NOT NULL no schema atual).';

CREATE INDEX IF NOT EXISTS idx_usuarios_auth_user_id ON usuarios(auth_user_id);

import { Router } from 'express';
import { getSupabaseAdmin } from '../supabaseAdmin';

export const authAdminRouter = Router();

interface RegisterBody {
  nome: string;
  email: string;
  senha: string;
  papel: string;
  departamento?: string | null;
  mfa_habilitado?: boolean;
  pode_visualizar_pii_bruto?: boolean;
  id_empresa?: number | null;
}

// Fase 4: the only place that creates a login-capable account. Creates the real
// Supabase Auth identity (Admin API — needs the service role key, so this can't
// run in the browser) and the matching "usuarios" profile row in one call,
// linked by auth_user_id. Rolls back the Auth user if the profile insert fails,
// so a failed registration never leaves an orphaned login with no profile.
authAdminRouter.post('/register', async (req, res) => {
  try {
    const body = req.body as RegisterBody;
    const email = body.email?.trim().toLowerCase();
    const nome = body.nome?.trim();

    if (!nome || !email || !body.senha || !body.papel) {
      res.status(400).json({ error: 'Campos "nome", "email", "senha" e "papel" são obrigatórios.' });
      return;
    }
    if (body.senha.length < 6) {
      res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres (mínimo exigido pelo Supabase Auth).' });
      return;
    }

    const admin = getSupabaseAdmin();

    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email,
      password: body.senha,
      email_confirm: true,
    });
    if (authError || !authData.user) {
      res.status(400).json({ error: authError?.message || 'Falha ao criar usuário no Supabase Auth.' });
      return;
    }

    const avatarIniciais = nome
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(p => p[0]?.toUpperCase() || '')
      .join('') || email.substring(0, 2).toUpperCase();

    const { data: profileData, error: profileError } = await admin
      .from('usuarios')
      .insert([{
        auth_user_id: authData.user.id,
        nome,
        email,
        papel: body.papel,
        departamento: body.departamento?.trim() || 'Engenharia de Dados & Governança',
        avatar_iniciais: avatarIniciais,
        mfa_habilitado: Boolean(body.mfa_habilitado),
        pode_visualizar_pii_bruto: Boolean(body.pode_visualizar_pii_bruto),
        ind_cadastro_ativo: true,
        id_empresa: body.id_empresa ?? null,
        // Deprecated (Supabase Auth owns the password now) but still NOT NULL in
        // the current schema — a random unusable value keeps old assumptions from
        // silently working again without touching the table's constraints here.
        senha_hash: `supabase-auth:${authData.user.id}`,
      }])
      .select()
      .single();

    if (profileError) {
      await admin.auth.admin.deleteUser(authData.user.id).catch(() => {});
      if (profileError.code === '23505') {
        res.status(409).json({ error: `Já existe um usuário cadastrado com o e-mail "${email}".` });
        return;
      }
      res.status(500).json({ error: `Falha ao gravar o perfil do usuário: ${profileError.message}` });
      return;
    }

    res.status(201).json(profileData);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Erro desconhecido ao registrar usuário.' });
  }
});

// One-off migration helper: links a "usuarios" row created before Fase 4 (no
// real login, just a row) to a brand-new Supabase Auth identity, so its owner
// can log in for real. Not used by the running app's normal flows.
authAdminRouter.post('/link-existing', async (req, res) => {
  try {
    const { usuarioId, senha } = req.body as { usuarioId?: string; senha?: string };
    if (!usuarioId || !senha) {
      res.status(400).json({ error: 'Campos "usuarioId" e "senha" são obrigatórios.' });
      return;
    }
    if (senha.length < 6) {
      res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
      return;
    }

    const admin = getSupabaseAdmin();

    const { data: usuario, error: fetchError } = await admin
      .from('usuarios')
      .select('id, email, auth_user_id')
      .eq('id', usuarioId)
      .single();
    if (fetchError || !usuario) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }
    if (usuario.auth_user_id) {
      res.status(409).json({ error: 'Este usuário já está vinculado a uma conta do Supabase Auth.' });
      return;
    }

    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email: usuario.email,
      password: senha,
      email_confirm: true,
    });
    if (authError || !authData.user) {
      res.status(400).json({ error: authError?.message || 'Falha ao criar usuário no Supabase Auth.' });
      return;
    }

    const { error: linkError } = await admin
      .from('usuarios')
      .update({ auth_user_id: authData.user.id })
      .eq('id', usuarioId);
    if (linkError) {
      await admin.auth.admin.deleteUser(authData.user.id).catch(() => {});
      res.status(500).json({ error: `Falha ao vincular a conta: ${linkError.message}` });
      return;
    }

    res.status(201).json({ authUserId: authData.user.id, email: usuario.email });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Erro desconhecido ao vincular usuário.' });
  }
});

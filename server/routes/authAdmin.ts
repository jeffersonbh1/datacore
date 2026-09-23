import { randomBytes } from 'crypto';
import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { getSupabaseAdmin } from '../supabaseAdmin';

export const authAdminRouter = Router();

const PAPEIS_VALIDOS = ['admin', 'data_engineer', 'data_analyst', 'dpo_compliance', 'viewer'];

interface RegisterBody {
  nome: string;
  email: string;
  papel: string;
  departamento?: string | null;
  mfa_habilitado?: boolean;
  pode_visualizar_pii_bruto?: boolean;
  id_empresa?: number | null;
  redirect_to?: string;
}

// Marca no user_metadata do Supabase Auth que o usuário ainda não criou a
// própria senha. Quem limpa é o próprio usuário, na tela de definir senha
// (ResetPasswordScreen), no mesmo updateUser que grava a senha.
const SENHA_PENDENTE = 'senha_pendente';

/**
 * Link de uso único para o usuário definir a própria senha. É um link de
 * "recovery" gerado pela Admin API SEM enviar e-mail (o projeto ainda não tem
 * SMTP próprio): o admin copia e manda por onde quiser. Ao abrir, o app cai na
 * ResetPasswordScreen (hash type=recovery). Validade = "Email OTP Expiration"
 * do Supabase Auth.
 */
async function gerarLinkDefinirSenha(email: string, redirectTo?: string): Promise<string> {
  const { data, error } = await getSupabaseAdmin().auth.admin.generateLink({
    type: 'recovery',
    email,
    options: redirectTo && /^https?:\/\//.test(redirectTo) ? { redirectTo } : undefined,
  });
  if (error || !data?.properties?.action_link) {
    throw new Error(error?.message || 'O Supabase não devolveu o link de acesso.');
  }
  return data.properties.action_link;
}

// Fase 4: the only place that creates a login-capable account. Creates the real
// Supabase Auth identity (Admin API — needs the service role key, so this can't
// run in the browser) and the matching "usuarios" profile row in one call,
// linked by auth_user_id. Rolls back the Auth user if the profile insert fails,
// so a failed registration never leaves an orphaned login with no profile.
// O admin não define senha: a conta nasce com uma senha aleatória que ninguém
// conhece, e a resposta traz o link para o próprio usuário criar a dele.
authAdminRouter.post('/register', requireAdminSession, async (req, res) => {
  try {
    const body = req.body as RegisterBody;
    const email = body.email?.trim().toLowerCase();
    const nome = body.nome?.trim();

    if (!nome || !email || !body.papel) {
      res.status(400).json({ error: 'Campos "nome", "email" e "papel" são obrigatórios.' });
      return;
    }
    if (!PAPEIS_VALIDOS.includes(body.papel)) {
      res.status(400).json({ error: `Papel inválido: "${body.papel}".` });
      return;
    }

    const admin = getSupabaseAdmin();

    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email,
      password: randomBytes(32).toString('base64url'),
      email_confirm: true,
      user_metadata: { [SENHA_PENDENTE]: true },
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

    // O usuário já existe; se só o link falhar, o admin gera outro na lista de Usuários.
    let linkAcesso: string | null = null;
    let linkErro: string | null = null;
    try {
      linkAcesso = await gerarLinkDefinirSenha(email, body.redirect_to);
    } catch (err) {
      linkErro = err instanceof Error ? err.message : 'Falha ao gerar o link de acesso.';
    }

    res.status(201).json({ ...profileData, link_acesso: linkAcesso, link_erro: linkErro });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Erro desconhecido ao registrar usuário.' });
  }
});

// =============================================================================
// Administração de usuários (listar / editar cadastro, e-mail e senha)
// =============================================================================
// Estas rotas (e o /register) criam ou alteram credenciais de login de
// terceiros, então não basta a chave do gateway (que vai no bundle do
// navegador): exigem a sessão real do Supabase (X-User-Token) de um admin.

// Supabase Auth não tem "desativar"; um ban longo é o equivalente — impede login
// e renovação de sessão até ser removido com 'none'.
const BAN_INATIVO = '876000h';

async function requireAdminSession(req: Request, res: Response, next: NextFunction) {
  try {
    const token = String(req.headers['x-user-token'] || '').trim();
    if (!token) {
      res.status(401).json({ error: 'Sessão do usuário ausente — faça login novamente.' });
      return;
    }
    const admin = getSupabaseAdmin();
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData?.user) {
      res.status(401).json({ error: 'Sessão inválida ou expirada — faça login novamente.' });
      return;
    }
    const { data: me, error: meError } = await admin
      .from('usuarios')
      .select('id, papel, ind_cadastro_ativo')
      .eq('auth_user_id', authData.user.id)
      .maybeSingle();
    if (meError) throw new Error(meError.message);
    if (!me || me.papel !== 'admin' || me.ind_cadastro_ativo === false) {
      res.status(403).json({ error: 'Apenas administradores podem gerenciar usuários.' });
      return;
    }
    res.locals.adminUsuarioId = String(me.id);
    next();
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao validar a sessão do administrador.' });
  }
}

const USUARIO_COLUNAS =
  'id, auth_user_id, nome, email, papel, departamento, avatar_iniciais, mfa_habilitado, ' +
  'pode_visualizar_pii_bruto, ind_cadastro_ativo, id_empresa, ultimo_acesso_em';

authAdminRouter.get('/usuarios', requireAdminSession, async (_req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const [{ data, error }, authList] = await Promise.all([
      admin.from('usuarios').select(USUARIO_COLUNAS).order('nome', { ascending: true }),
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);
    if (error) throw new Error(error.message);

    // "Aguardando senha" = conta criada pelo admin cujo dono ainda não abriu o
    // link e definiu a própria senha (ver SENHA_PENDENTE).
    const pendentes = new Set(
      (authList.data?.users || [])
        .filter(u => u.user_metadata?.[SENHA_PENDENTE] === true)
        .map(u => u.id)
    );
    res.json((data || []).map(row => {
      const r = row as unknown as Record<string, unknown>;
      return { ...r, senha_pendente: pendentes.has(String(r.auth_user_id)) };
    }));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Erro ao listar usuários.' });
  }
});

// Gera um novo link para o usuário definir a senha — convite vencido, ou
// "esqueci a senha" resolvido pelo admin sem precisar de e-mail.
authAdminRouter.post('/usuarios/:id/link-acesso', requireAdminSession, async (req, res) => {
  try {
    const { data: row, error } = await getSupabaseAdmin()
      .from('usuarios')
      .select('email, auth_user_id, ind_cadastro_ativo')
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }
    if (!row.auth_user_id) {
      res.status(409).json({ error: 'Este cadastro ainda não tem login no Supabase Auth — defina uma senha em "Alterar" para criá-lo.' });
      return;
    }
    if (row.ind_cadastro_ativo === false) {
      res.status(409).json({ error: 'Cadastro inativo — reative o usuário antes de gerar um link de acesso.' });
      return;
    }
    const redirectTo = (req.body as { redirect_to?: string } | undefined)?.redirect_to;
    const link = await gerarLinkDefinirSenha(String(row.email), redirectTo);
    res.json({ link_acesso: link });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Erro ao gerar o link de acesso.' });
  }
});

interface UpdateUsuarioBody {
  nome?: string;
  email?: string;
  senha?: string;
  papel?: string;
  departamento?: string | null;
  mfa_habilitado?: boolean;
  pode_visualizar_pii_bruto?: boolean;
  id_empresa?: number | null;
  ind_cadastro_ativo?: boolean;
}

authAdminRouter.patch('/usuarios/:id', requireAdminSession, async (req, res) => {
  try {
    const usuarioId = req.params.id;
    const body = req.body as UpdateUsuarioBody;
    const admin = getSupabaseAdmin();

    const { data: atual, error: fetchError } = await admin
      .from('usuarios')
      .select(USUARIO_COLUNAS)
      .eq('id', usuarioId)
      .maybeSingle();
    if (fetchError) throw new Error(fetchError.message);
    if (!atual) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }
    const row = atual as unknown as Record<string, unknown>;

    const nome = body.nome !== undefined ? body.nome.trim() : undefined;
    const email = body.email !== undefined ? body.email.trim().toLowerCase() : undefined;
    const senha = body.senha || undefined;

    if (nome !== undefined && !nome) {
      res.status(400).json({ error: 'O nome não pode ficar vazio.' });
      return;
    }
    if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Informe um e-mail válido.' });
      return;
    }
    if (senha !== undefined && senha.length < 6) {
      res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres (mínimo exigido pelo Supabase Auth).' });
      return;
    }
    if (body.papel !== undefined && !PAPEIS_VALIDOS.includes(body.papel)) {
      res.status(400).json({ error: `Papel inválido: "${body.papel}".` });
      return;
    }

    // Um admin não pode se trancar para fora (tirar o próprio papel de admin ou se desativar).
    const editandoASiMesmo = String(row.id) === res.locals.adminUsuarioId;
    if (editandoASiMesmo && ((body.papel !== undefined && body.papel !== 'admin') || body.ind_cadastro_ativo === false)) {
      res.status(400).json({ error: 'Você não pode remover o próprio papel de administrador nem desativar o próprio cadastro.' });
      return;
    }

    const emailMudou = email !== undefined && email !== row.email;
    const ativoMudou = body.ind_cadastro_ativo !== undefined && body.ind_cadastro_ativo !== (row.ind_cadastro_ativo !== false);
    let authUserId = (row.auth_user_id as string | null) || null;
    let authCriadoAgora = false;

    // 1. Credenciais no Supabase Auth (antes do perfil, pra falhas de e-mail
    //    duplicado/senha fraca não deixarem o perfil divergente do login).
    if (authUserId) {
      const authUpdate: Record<string, unknown> = {};
      if (emailMudou) { authUpdate.email = email; authUpdate.email_confirm = true; }
      if (senha) {
        authUpdate.password = senha;
        // Senha definida pelo admin: deixa de estar "aguardando senha".
        const { data: authUser } = await admin.auth.admin.getUserById(authUserId);
        if (authUser?.user?.user_metadata?.[SENHA_PENDENTE]) {
          authUpdate.user_metadata = { ...authUser.user.user_metadata, [SENHA_PENDENTE]: false };
        }
      }
      if (ativoMudou) authUpdate.ban_duration = body.ind_cadastro_ativo ? 'none' : BAN_INATIVO;
      if (Object.keys(authUpdate).length > 0) {
        const { error: authError } = await admin.auth.admin.updateUserById(authUserId, authUpdate);
        if (authError) {
          res.status(400).json({ error: `Falha ao atualizar o login no Supabase Auth: ${authError.message}` });
          return;
        }
      }
    } else if (senha) {
      // Cadastro antigo sem login real: definir uma senha cria a identidade no Auth.
      const { data: authData, error: authError } = await admin.auth.admin.createUser({
        email: email ?? String(row.email),
        password: senha,
        email_confirm: true,
      });
      if (authError || !authData.user) {
        res.status(400).json({ error: authError?.message || 'Falha ao criar o login no Supabase Auth.' });
        return;
      }
      authUserId = authData.user.id;
      authCriadoAgora = true;
    }

    // 2. Perfil em "usuarios".
    const update: Record<string, unknown> = {};
    if (nome !== undefined) {
      update.nome = nome;
      update.avatar_iniciais = nome.split(' ').filter(Boolean).slice(0, 2)
        .map(p => p[0]?.toUpperCase() || '').join('') || String(email ?? row.email).substring(0, 2).toUpperCase();
    }
    if (email !== undefined) update.email = email;
    if (body.papel !== undefined) update.papel = body.papel;
    if (body.departamento !== undefined) update.departamento = body.departamento?.trim() || null;
    if (body.mfa_habilitado !== undefined) update.mfa_habilitado = Boolean(body.mfa_habilitado);
    if (body.pode_visualizar_pii_bruto !== undefined) update.pode_visualizar_pii_bruto = Boolean(body.pode_visualizar_pii_bruto);
    if (body.id_empresa !== undefined) update.id_empresa = body.id_empresa ?? null;
    if (body.ind_cadastro_ativo !== undefined) update.ind_cadastro_ativo = Boolean(body.ind_cadastro_ativo);
    if (authCriadoAgora) {
      update.auth_user_id = authUserId;
      update.senha_hash = `supabase-auth:${authUserId}`;
    }

    // Só a senha mudou (ela vive no Supabase Auth, não em "usuarios"): não há o
    // que gravar no perfil. Um UPDATE vazio no PostgREST não devolve linha
    // nenhuma e o .single() falharia, então só relê o perfil.
    const { data: salvo, error: saveError } = Object.keys(update).length > 0
      ? await admin.from('usuarios').update(update).eq('id', usuarioId).select(USUARIO_COLUNAS).single()
      : await admin.from('usuarios').select(USUARIO_COLUNAS).eq('id', usuarioId).single();

    if (saveError) {
      // Desfaz o que foi mexido no Auth pra não deixar login e perfil divergentes.
      if (authCriadoAgora && authUserId) {
        await admin.auth.admin.deleteUser(authUserId).catch(() => {});
      } else if (authUserId && emailMudou) {
        await admin.auth.admin.updateUserById(authUserId, { email: String(row.email), email_confirm: true }).catch(() => {});
      }
      if (saveError.code === '23505') {
        res.status(409).json({ error: `Já existe um usuário cadastrado com o e-mail "${email}".` });
        return;
      }
      res.status(500).json({ error: `Falha ao gravar o perfil do usuário: ${saveError.message}` });
      return;
    }

    res.json(salvo);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Erro desconhecido ao atualizar usuário.' });
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

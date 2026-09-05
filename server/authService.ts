import bcrypt from 'bcryptjs';
import { pool } from './db';

export interface AuthenticatedUser {
  id: string;
  nome: string;
  email: string;
  papel: string;
  departamento: string | null;
  avatarIniciais: string | null;
  mfaHabilitado: boolean;
  podeVisualizarPiiBruto: boolean;
}

export type LoginFailureReason = 'not_found' | 'inactive' | 'invalid_password';

export interface LoginResult {
  ok: boolean;
  user?: AuthenticatedUser;
  reason?: LoginFailureReason;
}

export async function authenticateUser(email: string, password: string): Promise<LoginResult> {
  const { rows } = await pool.query(
    `SELECT id, nome, email, senha_hash, papel, departamento, avatar_iniciais,
            mfa_habilitado, pode_visualizar_pii_bruto, ind_cadastro_ativo
     FROM usuarios
     WHERE lower(email) = lower($1)`,
    [email.trim()]
  );

  const row = rows[0];
  if (!row) return { ok: false, reason: 'not_found' };
  if (!row.ind_cadastro_ativo) return { ok: false, reason: 'inactive' };

  const passwordMatches = await bcrypt.compare(password, row.senha_hash);
  if (!passwordMatches) return { ok: false, reason: 'invalid_password' };

  await pool.query('UPDATE usuarios SET ultimo_acesso_em = now() WHERE id = $1', [row.id]);

  return {
    ok: true,
    user: {
      id: row.id,
      nome: row.nome,
      email: row.email,
      papel: row.papel,
      departamento: row.departamento,
      avatarIniciais: row.avatar_iniciais,
      mfaHabilitado: row.mfa_habilitado,
      podeVisualizarPiiBruto: row.pode_visualizar_pii_bruto
    }
  };
}

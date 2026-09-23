import { gatewayConfig } from './airbyteGateway';
import { supabase } from './supabase';
import { UserRole } from '../types';

// -----------------------------------------------------------------------------
// Cliente da Administração de usuários (gateway /api/auth/usuarios). Alterar
// e-mail/senha de outra pessoa exige a service role key, então passa pelo
// gateway — que além da chave compartilhada confere, pelo JWT da sessão
// (X-User-Token), se quem pede é mesmo um admin.
// -----------------------------------------------------------------------------

export interface UsuarioAdmin {
  id: string;
  authUserId: string | null;
  nome: string;
  email: string;
  papel: UserRole;
  departamento: string;
  avatarIniciais: string;
  mfaHabilitado: boolean;
  podeVisualizarPiiBruto: boolean;
  ativo: boolean;
  idEmpresa: number | null;
  ultimoAcessoEm: string | null;
}

export interface UpdateUsuarioPayload {
  nome?: string;
  email?: string;
  senha?: string;
  papel?: UserRole;
  departamento?: string;
  mfa_habilitado?: boolean;
  pode_visualizar_pii_bruto?: boolean;
  id_empresa?: number | null;
  ind_cadastro_ativo?: boolean;
}

function mapRow(row: Record<string, unknown>): UsuarioAdmin {
  return {
    id: String(row.id),
    authUserId: (row.auth_user_id as string) || null,
    nome: String(row.nome || ''),
    email: String(row.email || ''),
    papel: (row.papel as UserRole) || 'viewer',
    departamento: String(row.departamento || ''),
    avatarIniciais: String(row.avatar_iniciais || ''),
    mfaHabilitado: Boolean(row.mfa_habilitado),
    podeVisualizarPiiBruto: Boolean(row.pode_visualizar_pii_bruto),
    ativo: row.ind_cadastro_ativo !== false,
    idEmpresa: row.id_empresa !== null && row.id_empresa !== undefined ? Number(row.id_empresa) : null,
    ultimoAcessoEm: row.ultimo_acesso_em ? String(row.ultimo_acesso_em) : null,
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { url, apiKey } = gatewayConfig();
  if (!url) throw new Error('VITE_AIRBYTE_GATEWAY_URL não configurada.');
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
  const token = data.session?.access_token;
  if (!token) throw new Error('Sessão expirada — faça login novamente.');

  const res = await fetch(`${url}/api/auth${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, 'X-User-Token': token },
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((json && json.error) || `Erro ${res.status} na administração de usuários.`);
  return json as T;
}

export async function listUsuarios(): Promise<UsuarioAdmin[]> {
  const rows = await request<Record<string, unknown>[]>('/usuarios');
  return rows.map(mapRow);
}

export async function updateUsuario(id: string, payload: UpdateUsuarioPayload): Promise<UsuarioAdmin> {
  const row = await request<Record<string, unknown>>(`/usuarios/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return mapRow(row);
}

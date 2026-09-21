import type { NextFunction, Request, Response } from 'express';
import { getSupabaseAdmin } from './supabaseAdmin';

/**
 * Usuário autenticado que originou a requisição, resolvido NO SERVIDOR a partir
 * do JWT da sessão real do Supabase Auth (header `X-User-Token`). O gateway em
 * si só valida uma chave compartilhada (requireGatewayApiKey), que não diz quem
 * está do outro lado — para qualquer rota que precise de isolamento por empresa
 * (ex.: o agente "Converse com os dados", que consulta o BigQuery), o
 * `idEmpresa` tem que vir daqui, nunca do corpo/query da requisição.
 */
export interface DataCoreUser {
  authUserId: string;
  idEmpresa: number;
  nome: string;
  email: string;
  papel: string;
}

/**
 * Quem pode SALVAR modelos Gold (escrever no repositório dbt): admin e
 * engenheiro de dados. Espelha a normalização de `papel` do cliente
 * (mapUsuarioRowToTeamUser em src/lib/supabase.ts) — o RBAC da tela é só do
 * navegador, então a rota que grava código precisa checar o papel real aqui.
 */
export function canSaveGoldModels(papel: string): boolean {
  const p = (papel || '').toLowerCase();
  if (p.includes('engineer') || p.includes('engenheir') || p.includes('dev')) return true;
  if (p.includes('dpo') || p.includes('compliance') || p.includes('privacid')) return false;
  if (p.includes('analyst') || p.includes('analist')) return false;
  return p.includes('admin') || p.includes('gestor') || p.includes('coord');
}

export function getDataCoreUser(res: Response): DataCoreUser {
  return res.locals.dataCoreUser as DataCoreUser;
}

export async function requireUserSession(req: Request, res: Response, next: NextFunction) {
  try {
    const token = String(req.headers['x-user-token'] || '').trim();
    if (!token) {
      res.status(401).json({ error: 'Sessão do usuário ausente — faça login novamente.' });
      return;
    }

    const supabase = getSupabaseAdmin();
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user) {
      res.status(401).json({ error: 'Sessão inválida ou expirada — faça login novamente.' });
      return;
    }

    const { data: row, error: rowError } = await supabase
      .from('usuarios')
      .select('*')
      .eq('auth_user_id', authData.user.id)
      .maybeSingle();
    if (rowError) throw new Error(rowError.message);
    if (!row) {
      res.status(403).json({ error: 'Usuário autenticado sem perfil cadastrado no DataCore.' });
      return;
    }

    const idEmpresa = Number((row as Record<string, unknown>).id_empresa);
    if (!Number.isFinite(idEmpresa) || idEmpresa <= 0) {
      res.status(403).json({ error: 'Usuário sem empresa vinculada — o agente precisa de uma empresa para isolar os dados.' });
      return;
    }

    const r = row as Record<string, unknown>;
    const user: DataCoreUser = {
      authUserId: authData.user.id,
      idEmpresa,
      nome: String(r.nome || r.name || authData.user.email || 'Usuário'),
      email: String(r.email || authData.user.email || ''),
      papel: String(r.papel || r.role || ''),
    };
    res.locals.dataCoreUser = user;
    next();
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao validar a sessão do usuário.' });
  }
}

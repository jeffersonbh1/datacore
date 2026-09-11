import { createClient, SupabaseClient, User as SupabaseUser } from '@supabase/supabase-js';
import {
  TeamUser, UserRole, NewUsuarioPayload, Empresa,
  SourceConnectorConfig, DestinationConnectorConfig, AutoIntegration, Pipeline,
  SourceType, DestinationType, CloudProvider, TableSyncConfig, SyncFrequencyOption
} from '../types';
import { PipelineRunSummary, TableBuildResult } from './pipelineBuilder';
import { AirbyteJob } from './airbyteGateway';

// Environment variables configured via .env / Vite
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Check if credentials are appropriately supplied
export const isSupabaseConfigured = (): boolean => {
  return (
    Boolean(supabaseUrl) &&
    Boolean(supabaseAnonKey) &&
    !supabaseUrl.includes('your-project') &&
    !supabaseAnonKey.includes('your-anon-public-key')
  );
};

// Singleton Supabase client instance (or null if unconfigured)
export const supabase: SupabaseClient | null = isSupabaseConfigured()
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

/**
 * Converts a Supabase Auth User object into the application's internal TeamUser model.
 */
export const mapSupabaseUserToTeamUser = (user: SupabaseUser): TeamUser => {
  const metadata = user.user_metadata || {};
  const email = user.email || 'usuario@empresa.com.br';
  const name =
    (metadata.full_name as string) ||
    (metadata.name as string) ||
    (email.includes('@') ? email.split('@')[0].replace('.', ' ') : 'Usuário DataCore');

  const role: UserRole = (metadata.role as UserRole) || 'admin';
  const department = (metadata.department as string) || 'Engenharia de Dados & Governança';
  const initials =
    name
      .split(' ')
      .slice(0, 2)
      .map((n: string) => n[0]?.toUpperCase() || '')
      .join('') || email.substring(0, 2).toUpperCase();

  return {
    id: user.id,
    name,
    email,
    role,
    department,
    avatar: initials,
    lastActive: 'Agora',
    mfaEnabled: Boolean(metadata.mfa_enabled),
    canViewUnmaskedPII: role === 'admin' || role === 'dpo_compliance',
  };
};

/**
 * Maps a row from the Supabase 'usuarios' (or 'usuario') table into the DataCore TeamUser model
 */
export function mapUsuarioRowToTeamUser(row: Record<string, unknown>): TeamUser {
  const id = String(row.id || row.id_usuario || row.codigo || `usr-${Date.now()}`);
  const email = String(row.email || 'usuario@empresa.com.br');
  const name =
    (row.nome as string) ||
    (row.name as string) ||
    (row.nome_completo as string) ||
    (email.includes('@') ? email.split('@')[0].replace('.', ' ') : 'Usuário DataCore');

  // Normalize role / papel / perfil
  const rawRole = String(
    row.papel || row.role || row.perfil || row.cargo || row.tipo || ''
  ).toLowerCase();
  let role: UserRole = 'viewer';

  if (rawRole.includes('engineer') || rawRole.includes('engenheir') || rawRole.includes('dev')) {
    role = 'data_engineer';
  } else if (rawRole.includes('dpo') || rawRole.includes('compliance') || rawRole.includes('privacid')) {
    role = 'dpo_compliance';
  } else if (rawRole.includes('analyst') || rawRole.includes('analist')) {
    role = 'data_analyst';
  } else if (rawRole.includes('admin') || rawRole.includes('gestor') || rawRole.includes('coord')) {
    role = 'admin';
  } else if (rawRole.includes('viewer') || rawRole.includes('leitor') || rawRole.includes('consult')) {
    role = 'viewer';
  } else {
    role = 'viewer';
  }

  const department =
    (row.departamento as string) ||
    (row.setor as string) ||
    (row.area as string) ||
    'Engenharia de Dados & Governança';

  const avatar =
    (row.avatar_iniciais as string) ||
    name
      .split(' ')
      .slice(0, 2)
      .map((n: string) => n[0]?.toUpperCase() || '')
      .join('') || email.substring(0, 2).toUpperCase();

  const mfaEnabled = Boolean(
    row.mfa_habilitado !== undefined ? row.mfa_habilitado : (row.mfa_enabled || row.mfa)
  );

  const canViewUnmaskedPII = Boolean(
    row.pode_visualizar_pii_bruto !== undefined
      ? row.pode_visualizar_pii_bruto
      : (role === 'admin' || role === 'dpo_compliance')
  );

  const idEmpresa = row.id_empresa !== undefined && row.id_empresa !== null
    ? Number(row.id_empresa)
    : null;

  return {
    id,
    name,
    email,
    role,
    department,
    avatar,
    lastActive: row.ultimo_acesso_em ? new Date(String(row.ultimo_acesso_em)).toLocaleDateString('pt-BR') : 'Agora',
    mfaEnabled,
    canViewUnmaskedPII,
    idEmpresa,
  };
}

/**
 * Fetches the "usuarios" profile row linked to a real Supabase Auth identity.
 */
export async function fetchUsuarioPorAuthId(authUserId: string): Promise<Record<string, unknown> | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('usuarios')
    .select('*')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (error) throw new Error(`Erro ao buscar perfil do usuário: ${error.message}`);
  return data;
}

/**
 * Fase 4: logs in via a real Supabase Auth session (supabase.auth.signInWithPassword)
 * instead of the old client-side query + bcrypt compare against "usuarios" — the
 * password never touches our own tables, and every subsequent Supabase call from
 * this tab is authenticated as this user (auth.uid() works, RLS can rely on it).
 */
export async function loginWithSupabaseAuth(
  emailInput: string,
  passwordInput: string
): Promise<{ user: TeamUser; role: UserRole }> {
  if (!supabase) {
    throw new Error(
      'O cliente Supabase não está configurado. Configure as variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env.'
    );
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: emailInput.trim().toLowerCase(),
    password: passwordInput,
  });

  if (error || !data.user) {
    throw new Error(
      error?.message === 'Invalid login credentials'
        ? 'E-mail ou senha incorretos.'
        : (error?.message || 'Falha na autenticação.')
    );
  }

  const usuarioRow = await fetchUsuarioPorAuthId(data.user.id);
  if (!usuarioRow) {
    await supabase.auth.signOut();
    throw new Error('Login válido, mas nenhum perfil foi encontrado em "usuarios" para esta conta. Contate um administrador.');
  }

  if (usuarioRow.ind_cadastro_ativo === false) {
    await supabase.auth.signOut();
    throw new Error('Este usuário está inativo ou suspenso no sistema.');
  }

  // Fire & forget — never blocks login on this succeeding
  supabase.from('usuarios').update({ ultimo_acesso_em: new Date().toISOString() }).eq('id', usuarioRow.id as string).then();

  const teamUser = mapUsuarioRowToTeamUser(usuarioRow);
  return { user: teamUser, role: teamUser.role };
}

/**
 * Fase 4: registers a new user through the gateway's Admin API route instead of
 * inserting into "usuarios" directly from the browser — creating a login-capable
 * account requires the Supabase service role key, which only the gateway holds.
 */
export async function registerUsuario(payload: NewUsuarioPayload): Promise<TeamUser> {
  if (!isSupabaseConfigured()) {
    // Local demo simulation — unchanged from before, only used when Supabase isn't configured at all.
    const cleanEmail = payload.email.trim().toLowerCase();
    const cleanNome = payload.nome.trim();
    const avatarIniciais =
      cleanNome.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() || '').join('')
      || cleanEmail.substring(0, 2).toUpperCase();
    return {
      id: `usr-${Date.now()}`,
      name: cleanNome,
      email: cleanEmail,
      role: payload.papel,
      department: payload.departamento || 'Engenharia de Dados & Governança',
      avatar: avatarIniciais,
      lastActive: 'Agora',
      mfaEnabled: Boolean(payload.mfa_habilitado),
      canViewUnmaskedPII: Boolean(payload.pode_visualizar_pii_bruto),
    };
  }

  const gatewayUrl = import.meta.env.VITE_AIRBYTE_GATEWAY_URL || '';
  const gatewayApiKey = import.meta.env.VITE_AIRBYTE_GATEWAY_API_KEY || '';
  if (!gatewayUrl) {
    throw new Error('VITE_AIRBYTE_GATEWAY_URL não configurada — necessária para cadastrar usuários com login real.');
  }

  const res = await fetch(`${gatewayUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gatewayApiKey}` },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new Error((json && json.error) || 'Erro ao cadastrar usuário.');
  }

  return mapUsuarioRowToTeamUser(json as Record<string, unknown>);
}

/**
 * Log out from Supabase and clear session
 */
export async function logoutFromSupabase(): Promise<void> {
  if (supabase) {
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
  }
}

// =============================================================================
// Empresas (tenants) — ver sql/001_multi_tenant_empresas.sql
// =============================================================================

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || `empresa-${Date.now()}`;
}

function mapEmpresaRow(row: Record<string, unknown>): Empresa {
  return {
    id: Number(row.id),
    nome: String(row.nome || ''),
    slug: String(row.slug || ''),
    airbyteWorkspaceId: (row.airbyte_workspace_id as string) || null,
    status: (row.status as Empresa['status']) || 'ativo',
    plano: (row.plano as string) || null,
    criadoEm: row.criado_em ? String(row.criado_em) : '',
  };
}

export async function fetchEmpresas(): Promise<Empresa[]> {
  if (!supabase) throw new Error('Supabase não configurado.');
  const { data, error } = await supabase.from('empresas').select('*').order('nome', { ascending: true });
  if (error) throw new Error(`Erro ao buscar empresas: ${error.message}`);
  return (data || []).map(mapEmpresaRow);
}

/** Used on app load to resolve the logged-in user's own Airbyte workspace (Fase 3). */
export async function fetchEmpresaPorId(id: number): Promise<Empresa | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('empresas').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Erro ao buscar empresa: ${error.message}`);
  return data ? mapEmpresaRow(data) : null;
}

export async function updateEmpresaWorkspace(id: number, airbyteWorkspaceId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase não configurado.');
  const { error } = await supabase
    .from('empresas')
    .update({ airbyte_workspace_id: airbyteWorkspaceId, atualizado_em: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`Erro ao vincular workspace do Airbyte à empresa: ${error.message}`);
}

export async function createEmpresa(payload: {
  nome: string;
  plano?: string | null;
  airbyteWorkspaceId?: string | null;
}): Promise<Empresa> {
  if (!supabase) throw new Error('Supabase não configurado.');
  const nome = payload.nome.trim();
  const slug = slugify(nome);

  const { data, error } = await supabase
    .from('empresas')
    .insert([{
      nome,
      slug,
      plano: payload.plano?.trim() || null,
      airbyte_workspace_id: payload.airbyteWorkspaceId?.trim() || null,
    }])
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error(`Já existe uma empresa com identificador (slug) "${slug}". Escolha um nome diferente.`);
    }
    throw new Error(`Erro ao criar empresa: ${error.message}`);
  }

  return mapEmpresaRow(data);
}

export async function updateEmpresaStatus(id: number, status: Empresa['status']): Promise<void> {
  if (!supabase) throw new Error('Supabase não configurado.');
  const { error } = await supabase
    .from('empresas')
    .update({ status, atualizado_em: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`Erro ao atualizar status da empresa: ${error.message}`);
}

export async function vincularUsuarioAEmpresa(usuarioId: string, idEmpresa: number | null): Promise<void> {
  if (!supabase) throw new Error('Supabase não configurado.');
  const { error } = await supabase.from('usuarios').update({ id_empresa: idEmpresa }).eq('id', usuarioId);
  if (error) throw new Error(`Erro ao vincular usuário à empresa: ${error.message}`);
}

// =============================================================================
// Origens / Destinos / Integrações — persistência por empresa do que hoje só
// existe como estado React no wizard de Pipeline Automático.
// =============================================================================

function mapOrigemRowToSourceConfig(row: Record<string, unknown>): SourceConnectorConfig {
  const cfg = (row.configuracao as Record<string, unknown>) || {};
  return {
    id: String(row.airbyte_source_id),
    name: String(row.nome || ''),
    type: (row.tipo as SourceType) || 'postgres',
    provider: (cfg.provider as CloudProvider) || 'generic',
    host: (cfg.host as string) || '-',
    port: (cfg.port as number) ?? 0,
    database: (cfg.database as string) || '-',
    username: (cfg.username as string) || '',
    schema: cfg.schema as string | undefined,
    ssl: Boolean(cfg.ssl),
    discoveredTables: [],
    status: (row.status as SourceConnectorConfig['status']) || 'connected',
    lastTestedAt: 'Sincronizado do banco',
    createdAt: row.criado_em ? String(row.criado_em).split('T')[0] : '',
  };
}

export async function fetchOrigensPorEmpresa(idEmpresa: number): Promise<SourceConnectorConfig[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('origens')
    .select('*')
    .eq('id_empresa', idEmpresa)
    .order('criado_em', { ascending: false });
  if (error) throw new Error(`Erro ao buscar origens da empresa: ${error.message}`);
  return (data || []).map(mapOrigemRowToSourceConfig);
}

/** Upserts a real Airbyte source into the tenant-scoped registry. Returns the row's own bigint id. */
export async function registrarOrigem(idEmpresa: number, source: SourceConnectorConfig): Promise<number> {
  if (!supabase) throw new Error('Supabase não configurado.');
  const { data, error } = await supabase
    .from('origens')
    .upsert(
      {
        id_empresa: idEmpresa,
        airbyte_source_id: source.id,
        nome: source.name,
        tipo: source.type,
        configuracao: {
          provider: source.provider,
          host: source.host,
          port: source.port,
          database: source.database,
          username: source.username,
          schema: source.schema,
          ssl: source.ssl,
        },
        status: source.status,
      },
      { onConflict: 'id_empresa,airbyte_source_id' }
    )
    .select('id')
    .single();

  if (error) throw new Error(`Erro ao registrar origem no banco: ${error.message}`);
  return Number(data.id);
}

function mapDestinoRowToDestConfig(row: Record<string, unknown>): DestinationConnectorConfig {
  const cfg = (row.configuracao as Record<string, unknown>) || {};
  return {
    id: String(row.airbyte_destination_id),
    name: String(row.nome || ''),
    type: (row.tipo as DestinationType) || 'bigquery',
    provider: (cfg.provider as CloudProvider) || 'generic',
    accountOrProject: (cfg.accountOrProject as string) || '-',
    warehouseOrCluster: cfg.warehouseOrCluster as string | undefined,
    databaseOrDataset: (cfg.databaseOrDataset as string) || '-',
    schema: cfg.schema as string | undefined,
    authMethod: (cfg.authMethod as DestinationConnectorConfig['authMethod']) || 'service_account',
    writeMode: (row.modo_escrita as DestinationConnectorConfig['writeMode']) || 'merge_upsert',
    status: (row.status as DestinationConnectorConfig['status']) || 'connected',
    lastTestedAt: 'Sincronizado do banco',
    createdAt: row.criado_em ? String(row.criado_em).split('T')[0] : '',
  };
}

export async function fetchDestinosPorEmpresa(idEmpresa: number): Promise<DestinationConnectorConfig[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('destinos')
    .select('*')
    .eq('id_empresa', idEmpresa)
    .order('criado_em', { ascending: false });
  if (error) throw new Error(`Erro ao buscar destinos da empresa: ${error.message}`);
  return (data || []).map(mapDestinoRowToDestConfig);
}

/** Upserts a real Airbyte destination into the tenant-scoped registry. Returns the row's own bigint id. */
export async function registrarDestino(idEmpresa: number, dest: DestinationConnectorConfig): Promise<number> {
  if (!supabase) throw new Error('Supabase não configurado.');
  const { data, error } = await supabase
    .from('destinos')
    .upsert(
      {
        id_empresa: idEmpresa,
        airbyte_destination_id: dest.id,
        nome: dest.name,
        tipo: dest.type,
        configuracao: {
          provider: dest.provider,
          accountOrProject: dest.accountOrProject,
          warehouseOrCluster: dest.warehouseOrCluster,
          databaseOrDataset: dest.databaseOrDataset,
          schema: dest.schema,
          authMethod: dest.authMethod,
        },
        modo_escrita: dest.writeMode,
        status: dest.status,
      },
      { onConflict: 'id_empresa,airbyte_destination_id' }
    )
    .select('id')
    .single();

  if (error) throw new Error(`Erro ao registrar destino no banco: ${error.message}`);
  return Number(data.id);
}

function mapIntegracaoRow(row: Record<string, unknown>): AutoIntegration {
  const origem = (row.origens as Record<string, unknown>) || {};
  const destino = (row.destinos as Record<string, unknown>) || {};
  const selectedTables = (row.tabelas_selecionadas as string[]) || [];

  return {
    id: String(row.id),
    name: String(row.nome || ''),
    sourceConnectorId: String(origem.airbyte_source_id || ''),
    sourceConnectorName: String(origem.nome || ''),
    sourceType: (origem.tipo as SourceType) || 'postgres',
    destinationConnectorId: String(destino.airbyte_destination_id || ''),
    destinationConnectorName: String(destino.nome || ''),
    destinationType: (destino.tipo as DestinationType) || 'bigquery',
    selectedTables,
    tableSyncConfigs: (row.table_sync_configs as Record<string, TableSyncConfig>) || {},
    syncFrequency: (row.frequencia_sync as SyncFrequencyOption) || 'daily',
    executionTimes: (row.horarios_execucao as string[]) || [],
    weeklyDays: (row.dias_semana as string[] | null) || undefined,
    monthlyDay: row.dia_mensal !== null && row.dia_mensal !== undefined ? Number(row.dia_mensal) : undefined,
    onceDate: (row.data_execucao_unica as string) || undefined,
    scheduleSummary: (row.resumo_agendamento as string) || undefined,
    applyLgpdSanitization: Boolean(row.aplicar_sanitizacao_lgpd),
    airbyteConnectionId: (row.airbyte_connection_id as string) || undefined,
    status: (row.status as AutoIntegration['status']) || 'active',
    pipelineId: String(row.pipeline_id || ''),
    createdAt: row.criado_em ? String(row.criado_em).split('T')[0] : '',
    tablesCount: selectedTables.length,
  };
}

export async function fetchIntegracoesPorEmpresa(idEmpresa: number): Promise<AutoIntegration[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('integracoes')
    .select('*, origens(nome, tipo, airbyte_source_id), destinos(nome, tipo, airbyte_destination_id)')
    .eq('id_empresa', idEmpresa)
    .order('criado_em', { ascending: false });
  if (error) throw new Error(`Erro ao buscar integrações da empresa: ${error.message}`);
  return (data || []).map(mapIntegracaoRow);
}

/**
 * Persists an AutoIntegration record. origemDbId/destinoDbId are the bigint ids
 * from registrarOrigem/registrarDestino (not the Airbyte UUIDs). Returns the new
 * row's own bigint id, needed as the FK when persisting its matching pipeline
 * (see persistPipeline).
 */
export async function registrarIntegracao(
  idEmpresa: number,
  integration: AutoIntegration,
  origemDbId: number,
  destinoDbId: number
): Promise<number> {
  if (!supabase) throw new Error('Supabase não configurado.');
  const { data, error } = await supabase
    .from('integracoes')
    .insert([{
      id_empresa: idEmpresa,
      origem_id: origemDbId,
      destino_id: destinoDbId,
      airbyte_connection_id: integration.airbyteConnectionId || null,
      nome: integration.name,
      tabelas_selecionadas: integration.selectedTables,
      table_sync_configs: integration.tableSyncConfigs || {},
      frequencia_sync: integration.syncFrequency,
      horarios_execucao: integration.executionTimes || [],
      dias_semana: integration.weeklyDays || null,
      dia_mensal: integration.monthlyDay ?? null,
      data_execucao_unica: integration.onceDate || null,
      resumo_agendamento: integration.scheduleSummary || null,
      aplicar_sanitizacao_lgpd: integration.applyLgpdSanitization,
      status: integration.status,
      pipeline_id: integration.pipelineId,
    }])
    .select('id')
    .single();
  if (error) throw new Error(`Erro ao registrar integração no banco: ${error.message}`);
  return Number(data.id);
}

export async function updateIntegracaoStatus(id: number, status: AutoIntegration['status']): Promise<void> {
  if (!supabase) throw new Error('Supabase não configurado.');
  const { error } = await supabase.from('integracoes').update({ status }).eq('id', id);
  if (error) throw new Error(`Erro ao atualizar status da integração: ${error.message}`);
}

/**
 * Exclui uma integração do banco. As linhas de "pipelines" e "pipeline_runs"
 * ligadas a ela caem por ON DELETE CASCADE (ver sql/002 e sql/003). Não mexe no
 * Airbyte (a conexão continua lá) nem nos modelos dbt gerados.
 */
export async function deletarIntegracao(id: number): Promise<void> {
  if (!supabase) throw new Error('Supabase não configurado.');
  const { error } = await supabase.from('integracoes').delete().eq('id', id);
  if (error) throw new Error(`Erro ao excluir a integração: ${error.message}`);
}

// =============================================================================
// Pipelines — Fase 1 da persistência do Studio Visual ETL (ver sql/002_pipelines.sql).
// A tabela guarda só o vínculo estável com a integração e metadados de exibição;
// a topologia (nodes/edges) é sempre derivada via buildPipelineFromIntegration
// em src/lib/pipelineBuilder.ts, nunca lida/gravada como blob aqui.
// =============================================================================

export interface PipelineDbRecord {
  id: number;
  integracaoId: number;
  layoutOverrides: Record<string, { x: number; y: number }>;
}

function mapPipelineRow(row: Record<string, unknown>): PipelineDbRecord {
  return {
    id: Number(row.id),
    integracaoId: Number(row.integracao_id),
    layoutOverrides: (row.layout_overrides as Record<string, { x: number; y: number }>) || {},
  };
}

export async function fetchPipelinesPorEmpresa(idEmpresa: number): Promise<PipelineDbRecord[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('pipelines')
    .select('id, integracao_id, layout_overrides')
    .eq('id_empresa', idEmpresa);
  if (error) throw new Error(`Erro ao buscar pipelines da empresa: ${error.message}`);
  return (data || []).map(mapPipelineRow);
}

/** Creates the pipelines row that anchors a just-persisted integração. Returns the row's own bigint id. */
export async function persistPipeline(
  idEmpresa: number,
  integracaoDbId: number,
  pipeline: Pick<Pipeline, 'name' | 'category'>
): Promise<number> {
  if (!supabase) throw new Error('Supabase não configurado.');
  const { data, error } = await supabase
    .from('pipelines')
    .insert([{
      id_empresa: idEmpresa,
      integracao_id: integracaoDbId,
      nome: pipeline.name,
      categoria: pipeline.category,
    }])
    .select('id')
    .single();
  if (error) throw new Error(`Erro ao registrar pipeline no banco: ${error.message}`);
  return Number(data.id);
}

// =============================================================================
// Pipeline runs — Fase 2 (ver sql/003_pipeline_runs.sql). Histórico real de
// execuções, uma linha por job do Airbyte. É o único lugar que grava nessa
// tabela; applyRealMetrics() em pipelineBuilder.ts só lê o que está aqui.
// =============================================================================

/** Airbyte's job "duration" is an ISO-8601 duration string (e.g. "PT1M16.8S"); this converts it to ms. */
function parseIsoDurationMs(duration?: string): number | null {
  if (!duration) return null;
  const match = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(duration);
  if (!match) return null;
  const hours = parseFloat(match[1] || '0');
  const minutes = parseFloat(match[2] || '0');
  const seconds = parseFloat(match[3] || '0');
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

const OPEN_JOB_STATUSES = new Set(['pending', 'running']);

/** Upserts one row per Airbyte job — safe to call repeatedly as a job's status changes over time. */
export async function upsertPipelineRuns(idEmpresa: number, pipelineDbId: number, jobs: AirbyteJob[]): Promise<void> {
  if (!supabase || jobs.length === 0) return;
  const rows = jobs.map(job => ({
    pipeline_id: pipelineDbId,
    id_empresa: idEmpresa,
    airbyte_job_id: job.jobId,
    status: job.status,
    records_synced: job.rowsSynced ?? null,
    bytes_synced: job.bytesSynced ?? null,
    duration_ms: parseIsoDurationMs(job.duration),
    iniciado_em: job.startTime,
    finalizado_em: OPEN_JOB_STATUSES.has(job.status) ? null : (job.lastUpdatedTime || null),
  }));

  const { error } = await supabase
    .from('pipeline_runs')
    .upsert(rows, { onConflict: 'pipeline_id,airbyte_job_id' });
  if (error) throw new Error(`Erro ao gravar histórico de execuções: ${error.message}`);
}

function mapPipelineRunRow(row: Record<string, unknown>): PipelineRunSummary {
  return {
    airbyteJobId: Number(row.airbyte_job_id),
    status: row.status as PipelineRunSummary['status'],
    recordsSynced: row.records_synced != null ? Number(row.records_synced) : null,
    durationMs: row.duration_ms != null ? Number(row.duration_ms) : null,
    iniciadoEm: String(row.iniciado_em),
    finalizadoEm: row.finalizado_em ? String(row.finalizado_em) : null,
    bronzeStatus: (row.bronze_status as PipelineRunSummary['bronzeStatus']) || 'not_applicable',
    bronzeError: (row.bronze_error as string) || null,
    bronzeBuiltEm: (row.bronze_built_em as string) || null,
    bronzeTables: (row.bronze_tables as PipelineRunSummary['bronzeTables']) || null,
    silverStatus: (row.silver_status as PipelineRunSummary['silverStatus']) || 'not_applicable',
    silverError: (row.silver_error as string) || null,
    silverTables: (row.silver_tables as PipelineRunSummary['silverTables']) || null,
    silverBuiltEm: (row.silver_built_em as string) || null,
  };
}

/** Most-recent-first, capped at `limit` — matches what applyRealMetrics() expects. */
export async function fetchPipelineRunsForPipeline(pipelineDbId: number, limit = 30): Promise<PipelineRunSummary[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('pipeline_runs')
    .select('airbyte_job_id, status, records_synced, duration_ms, iniciado_em, finalizado_em, bronze_status, bronze_error, bronze_built_em, bronze_tables, silver_status, silver_error, silver_built_em, silver_tables')
    .eq('pipeline_id', pipelineDbId)
    .order('iniciado_em', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Erro ao buscar histórico de execuções: ${error.message}`);
  return (data || []).map(mapPipelineRunRow);
}

/**
 * Grava o progresso de uma construção manual de Bronze/Silver (ver
 * VisualCanvas.handleExecutePipeline) na linha de pipeline_runs do job do
 * Airbyte que a originou — mesmas colunas que o auto-sync do gateway
 * (server/routes/bronzeAutoSync.ts) usa para a Bronze, agora também para a
 * Silver (sql/008) e com o estado intermediário 'running' (sql/009), para a
 * tela "Execuções" mostrar "Construindo..." em vez de só "Pendente"/"Falhou"/
 * "Construída". A linha precisa já existir (ver upsertPipelineRuns) — chamar
 * depois que o job da Raw foi registrado. `bronze_built_em`/`silver_built_em`
 * só é gravado nos estados terminais (built/failed) — 'running' não é "quando
 * terminou de construir".
 */
export async function updatePipelineRunLayerStatus(
  pipelineDbId: number,
  airbyteJobId: number,
  layer: 'bronze' | 'silver',
  status: 'running' | 'built' | 'failed',
  errorMessage?: string,
  /** Detalhe por tabela (status + rowsAffected) — omitido na gravação inicial
   *  ('running', antes do dbt build terminar), presente no fechamento. */
  tables?: TableBuildResult[]
): Promise<void> {
  if (!supabase) return;
  const isTerminal = status !== 'running';
  const patch = layer === 'bronze'
    ? {
        bronze_status: status, bronze_error: errorMessage || null,
        ...(isTerminal ? { bronze_built_em: new Date().toISOString() } : {}),
        ...(tables ? { bronze_tables: tables } : {}),
      }
    : {
        silver_status: status, silver_error: errorMessage || null,
        ...(isTerminal ? { silver_built_em: new Date().toISOString() } : {}),
        ...(tables ? { silver_tables: tables } : {}),
      };

  const { error } = await supabase
    .from('pipeline_runs')
    .update(patch)
    .eq('pipeline_id', pipelineDbId)
    .eq('airbyte_job_id', airbyteJobId);
  if (error) throw new Error(`Erro ao atualizar status da camada ${layer}: ${error.message}`);
}

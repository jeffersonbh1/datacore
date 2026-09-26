// Tela "Qualidade de Dados" (fase 1): regras de linha da Silver e resultados por
// execução. Regras e resultados são LIDOS direto do Supabase (RLS por empresa —
// abre rápido, sem passar pelo gateway). Só o que precisa do servidor vai ao
// gateway: colunas com o tipo real (BigQuery), salvar regras (valida e regera a
// Silver), valores de uma coluna e a amostra da quarentena — todos sob demanda.
import { supabase } from './supabase';
import { gatewayUserRequest } from './dataChat';

export type QualityRuleType = 'not_null' | 'accepted_values' | 'range';
export type ColumnKind = 'string' | 'number' | 'date' | 'timestamp' | 'boolean' | 'other';

export interface QualityRuleParams {
  valores?: Array<string | number>;
  min?: number | string | null;
  max?: number | string | null;
}

export interface QualityRule {
  id?: number;
  integracaoId: number;
  tabela: string;
  coluna: string;
  tipo: QualityRuleType;
  parametros: QualityRuleParams;
  status: 'ativa' | 'inativa';
  criadoPor?: string | null;
  atualizadoEm?: string;
}

export interface QualityTestResult {
  nome: string;
  status: string;
  mensagem: string | null;
}

export interface QualityExecution {
  id: number;
  integracaoId: number;
  tabela: string;
  modelo: string;
  executadoEm: string;
  linhasBronze: number | null;
  linhasSilver: number | null;
  linhasProcessadas: number | null;
  linhasRejeitadas: number;
  /** id da regra -> linhas rejeitadas por ela nesta execução. */
  motivos: Record<string, number>;
  testes: QualityTestResult[];
  testesAprovados: number;
  testesTotal: number;
  regrasAtivas: number;
  status: 'ok' | 'rejeicoes' | 'teste_falhou' | 'erro';
  erro: string | null;
}

export interface QualityColumn {
  nome: string;
  tipoBigQuery: string;
  tipo: ColumnKind;
  regrasPermitidas: QualityRuleType[];
  pk: boolean;
}

export const RULE_TYPE_LABEL: Record<QualityRuleType, string> = {
  not_null: 'Obrigatório (não nulo)',
  accepted_values: 'Valores permitidos',
  range: 'Faixa (mínimo / máximo)',
};

/** Mesma descrição do servidor (server/qualityRules.ts::describeQualityRule). */
export function describeRule(r: Pick<QualityRule, 'coluna' | 'tipo' | 'parametros'>): string {
  const p = r.parametros || {};
  const empty = (v: unknown) => v === undefined || v === null || v === '';
  if (r.tipo === 'not_null') return `${r.coluna} obrigatório`;
  if (r.tipo === 'accepted_values') return `${r.coluna} deve estar em: ${(p.valores || []).join(', ')}`;
  if (!empty(p.min) && !empty(p.max)) return `${r.coluna} entre ${p.min} e ${p.max}`;
  if (!empty(p.min)) return `${r.coluna} ≥ ${p.min}`;
  return `${r.coluna} ≤ ${p.max}`;
}

/** % de linhas aceitas na execução (processadas / processadas + rejeitadas). */
export function acceptedPct(e: QualityExecution): number | null {
  const lidas = (e.linhasProcessadas ?? 0) + e.linhasRejeitadas;
  if (e.linhasProcessadas === null && e.linhasRejeitadas === 0) return null;
  return lidas === 0 ? 100 : ((e.linhasProcessadas ?? 0) / lidas) * 100;
}

function mapRule(r: Record<string, unknown>): QualityRule {
  return {
    id: Number(r.id),
    integracaoId: Number(r.integracao_id),
    tabela: String(r.tabela),
    coluna: String(r.coluna),
    tipo: r.tipo as QualityRuleType,
    parametros: (r.parametros ?? {}) as QualityRuleParams,
    status: r.status === 'inativa' ? 'inativa' : 'ativa',
    criadoPor: (r.criado_por as string) ?? null,
    atualizadoEm: r.atualizado_em as string,
  };
}

function mapExecution(r: Record<string, unknown>): QualityExecution {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: Number(r.id),
    integracaoId: Number(r.integracao_id),
    tabela: String(r.tabela),
    modelo: String(r.modelo),
    executadoEm: String(r.executado_em),
    linhasBronze: n(r.linhas_bronze),
    linhasSilver: n(r.linhas_silver),
    linhasProcessadas: n(r.linhas_processadas),
    linhasRejeitadas: Number(r.linhas_rejeitadas ?? 0),
    motivos: (r.motivos ?? {}) as Record<string, number>,
    testes: (r.testes ?? []) as QualityTestResult[],
    testesAprovados: Number(r.testes_aprovados ?? 0),
    testesTotal: Number(r.testes_total ?? 0),
    regrasAtivas: Number(r.regras_ativas ?? 0),
    status: r.status as QualityExecution['status'],
    erro: (r.erro as string) ?? null,
  };
}

/** Todas as regras da empresa (RLS). */
export async function fetchQualityRules(): Promise<QualityRule[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('qualidade_regras').select('*').order('id');
  if (error) throw new Error(`Erro ao buscar as regras de qualidade: ${error.message}`);
  return (data || []).map(mapRule);
}

/** Execuções recentes da empresa (RLS), mais recentes primeiro. */
export async function fetchQualityExecutions(limit = 500): Promise<QualityExecution[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('qualidade_execucoes')
    .select('*')
    .order('executado_em', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Erro ao buscar os resultados de qualidade: ${error.message}`);
  return (data || []).map(mapExecution);
}

export const fetchQualityColumns = (integracaoId: number, tabela: string) =>
  gatewayUserRequest<{ modelo: string; incremental: boolean; pk: string[]; colunas: QualityColumn[] }>(
    `/api/quality/${integracaoId}/colunas?tabela=${encodeURIComponent(tabela)}`,
  );

export const fetchColumnValues = (integracaoId: number, tabela: string, coluna: string) =>
  gatewayUserRequest<{ valores: Array<{ valor: string; qtd: number }> }>(
    `/api/quality/${integracaoId}/valores?tabela=${encodeURIComponent(tabela)}&coluna=${encodeURIComponent(coluna)}`,
  );

export const fetchQuarantineSample = (integracaoId: number, tabela: string) =>
  gatewayUserRequest<{ linhas: Array<Record<string, unknown>>; executadoEm: string | null }>(
    `/api/quality/${integracaoId}/amostra?tabela=${encodeURIComponent(tabela)}`,
  );

export async function saveQualityRules(integracaoId: number, tabela: string, regras: QualityRule[]): Promise<{
  regras: QualityRule[];
  git: string;
  gitDetail?: string;
}> {
  const res = await gatewayUserRequest<{ regras: Array<Record<string, unknown>>; git: string; gitDetail?: string }>(
    `/api/quality/${integracaoId}/regras`,
    {
      method: 'PUT',
      body: JSON.stringify({
        tabela,
        regras: regras.map((r) => ({ id: r.id, coluna: r.coluna, tipo: r.tipo, parametros: r.parametros, status: r.status })),
      }),
    },
  );
  return { regras: res.regras.map(mapRule), git: res.git, gitDetail: res.gitDetail };
}

import { Router } from 'express';
import { loadTenantContext, type TenantIntegration } from '../agent/catalog';
import { getBigQueryClient } from '../bigqueryClient';
import { readSilverManifestModel, REJEITADOS_SUFFIX, silverModelName, writeSilverQualityModels } from '../dbtCodegen';
import {
  columnKindFromBigQueryType, normalizeRuleParams, ruleTypesFor, validateQualityRule,
  type ColumnKind, type QualityRuleParams, type QualityRuleSpec, type QualityRuleType,
} from '../qualityRules';
import { getSupabaseAdmin } from '../supabaseAdmin';
import { canSaveGoldModels, getDataCoreUser } from '../userSession';

// -----------------------------------------------------------------------------
// Tela "Qualidade de Dados" (fase 1). A tela LÊ regras e resultados direto do
// Supabase (RLS por empresa); aqui ficam só as ações que precisam do servidor:
//   GET  /:integracaoId/colunas?tabela=   colunas da Silver com o tipo real (BigQuery)
//   PUT  /:integracaoId/regras            grava as regras da tabela e regera a Silver
//   GET  /:integracaoId/amostra?tabela=   linhas da quarentena da última execução
//   GET  /:integracaoId/valores?tabela=&coluna=   valores mais frequentes (para "valores permitidos")
// A empresa sempre vem da sessão do usuário (requireUserSession), nunca do corpo.
// -----------------------------------------------------------------------------

export const qualityRouter = Router();

const SAMPLE_LIMIT = 100;
const MAX_RULES_PER_TABLE = 100;

interface ColumnInfo {
  nome: string;
  tipoBigQuery: string;
  tipo: ColumnKind;
  regrasPermitidas: QualityRuleType[];
  pk: boolean;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function sendError(res: import('express').Response, err: unknown, fallback: string) {
  const status = err instanceof HttpError ? err.status : 500;
  res.status(status).json({ error: err instanceof Error ? err.message : fallback });
}

/** Integração + tabela da empresa do usuário (404 se não for dela). */
async function resolveTable(idEmpresa: number, integracaoIdRaw: string, tabelaRaw: unknown) {
  const integracaoId = Number(integracaoIdRaw);
  const tabela = String(tabelaRaw || '');
  const tenant = await loadTenantContext(idEmpresa);
  const integration = tenant.integrations.find((i) => i.id === integracaoId);
  if (!integration) throw new HttpError(404, 'Integração não encontrada na sua empresa.');
  if (!integration.tables.includes(tabela)) throw new HttpError(404, `A tabela "${tabela}" não faz parte desta integração.`);
  return { integration, tabela, model: silverModelName(integration.sistemaNome, tabela) };
}

/** Colunas com o tipo real: da Silver no BigQuery; se ela ainda não foi construída, da Bronze
 *  (a Silver é passthrough da Bronze — mesmas colunas e tipos). */
async function loadColumns(integration: TenantIntegration, tabela: string): Promise<ColumnInfo[]> {
  const model = silverModelName(integration.sistemaNome, tabela);
  const entry = readSilverManifestModel(integration.sistemaNome, tabela);
  const pk = new Set(entry?.pk ?? []);
  const bq = getBigQueryClient();
  for (const [dataset, table] of [[integration.silverDataset, model], [integration.bronzeDataset, model.replace(/^silver_/, 'bronze_')]]) {
    const [rows] = await bq.query({
      query: `SELECT column_name, data_type
              FROM \`${integration.projectId}.${dataset}\`.INFORMATION_SCHEMA.COLUMNS
              WHERE table_name = @table
              ORDER BY ordinal_position`,
      params: { table },
      location: integration.location || undefined,
    });
    if (rows.length === 0) continue;
    return (rows as Array<{ column_name: string; data_type: string }>)
      // Colunas técnicas do pipeline não recebem regra.
      .filter((r) => !r.column_name.startsWith('_'))
      .map((r) => {
        const tipo = columnKindFromBigQueryType(r.data_type);
        return { nome: r.column_name, tipoBigQuery: r.data_type, tipo, regrasPermitidas: ruleTypesFor(tipo), pk: pk.has(r.column_name) };
      });
  }
  throw new HttpError(404, 'A tabela ainda não existe no BigQuery — execute a Bronze/Silver desta integração antes de criar regras.');
}

qualityRouter.get('/:integracaoId/colunas', async (req, res) => {
  try {
    const { integration, tabela, model } = await resolveTable(getDataCoreUser(res).idEmpresa, req.params.integracaoId, req.query.tabela);
    const entry = readSilverManifestModel(integration.sistemaNome, tabela);
    res.json({
      modelo: model,
      incremental: entry?.incremental ?? false,
      pk: entry?.pk ?? [],
      colunas: await loadColumns(integration, tabela),
    });
  } catch (err) {
    sendError(res, err, 'Falha ao ler as colunas da tabela.');
  }
});

interface RuleInput {
  id?: number;
  coluna: string;
  tipo: QualityRuleType;
  parametros?: QualityRuleParams;
  status?: 'ativa' | 'inativa';
}

/** Substitui o conjunto de regras da tabela (a tela salva a lista inteira) e regera a Silver. */
qualityRouter.put('/:integracaoId/regras', async (req, res) => {
  try {
    const user = getDataCoreUser(res);
    if (!canSaveGoldModels(user.papel)) {
      throw new HttpError(403, 'Seu perfil não pode alterar regras de qualidade (apenas administrador ou engenheiro de dados).');
    }
    const body = req.body as { tabela?: string; regras?: RuleInput[] };
    if (!Array.isArray(body.regras)) throw new HttpError(400, 'Campo "regras" (lista) é obrigatório.');
    if (body.regras.length > MAX_RULES_PER_TABLE) throw new HttpError(400, `No máximo ${MAX_RULES_PER_TABLE} regras por tabela.`);

    const { integration, tabela, model } = await resolveTable(user.idEmpresa, req.params.integracaoId, body.tabela);
    const columns = await loadColumns(integration, tabela);
    const kinds = new Map(columns.map((c) => [c.nome, c.tipo]));

    const errors = body.regras
      .map((r, i) => {
        const err = validateQualityRule(r, kinds);
        return err ? `Regra ${i + 1}: ${err}` : null;
      })
      .filter((e): e is string => e !== null);
    if (errors.length) {
      res.status(400).json({ error: errors[0], details: errors });
      return;
    }

    const supabase = getSupabaseAdmin();
    const scope = { id_empresa: user.idEmpresa, integracao_id: integration.id, tabela };
    const { data: existing, error: existingError } = await supabase
      .from('qualidade_regras').select('id').match(scope);
    if (existingError) throw new Error(existingError.message);
    const existingIds = new Set((existing ?? []).map((r) => Number(r.id)));

    const now = new Date().toISOString();
    const keepIds = new Set<number>();
    for (const r of body.regras) {
      const row = {
        ...scope,
        modelo: model,
        coluna: r.coluna,
        tipo: r.tipo,
        parametros: normalizeRuleParams(r.tipo, kinds.get(r.coluna)!, r.parametros),
        status: r.status === 'inativa' ? 'inativa' : 'ativa',
        atualizado_em: now,
      };
      if (r.id && existingIds.has(Number(r.id))) {
        const { error } = await supabase.from('qualidade_regras').update(row).match({ ...scope, id: Number(r.id) });
        if (error) throw new Error(error.message);
        keepIds.add(Number(r.id));
      } else {
        const { data, error } = await supabase
          .from('qualidade_regras').insert({ ...row, criado_por: user.nome }).select('id').single();
        if (error) throw new Error(error.message);
        keepIds.add(Number(data.id));
      }
    }
    const toDelete = [...existingIds].filter((id) => !keepIds.has(id));
    if (toDelete.length) {
      const { error } = await supabase.from('qualidade_regras').delete().match(scope).in('id', toDelete);
      if (error) throw new Error(error.message);
    }

    const { data: saved, error: savedError } = await supabase
      .from('qualidade_regras').select('*').match(scope).order('id');
    if (savedError) throw new Error(savedError.message);

    const specs: QualityRuleSpec[] = (saved ?? [])
      .filter((r) => r.status === 'ativa')
      .map((r) => ({
        id: Number(r.id),
        coluna: String(r.coluna),
        tipo: r.tipo as QualityRuleType,
        parametros: (r.parametros ?? {}) as QualityRuleParams,
        tipoColuna: kinds.get(String(r.coluna)) ?? 'other',
      }));
    const written = await writeSilverQualityModels(integration.sistemaNome, tabela, specs);
    res.json({ regras: saved, modelo: written.model, arquivos: written.files, git: written.git, gitDetail: written.gitDetail });
  } catch (err) {
    sendError(res, err, 'Falha ao salvar as regras de qualidade.');
  }
});

/** Valores distintos mais frequentes de uma coluna (Bronze), para montar a lista de
 *  "valores permitidos" com o que existe de fato — maiúsculas/minúsculas contam. */
qualityRouter.get('/:integracaoId/valores', async (req, res) => {
  try {
    const { integration, tabela, model } = await resolveTable(getDataCoreUser(res).idEmpresa, req.params.integracaoId, req.query.tabela);
    const coluna = String(req.query.coluna || '');
    const columns = await loadColumns(integration, tabela);
    if (!columns.some((c) => c.nome === coluna)) throw new HttpError(404, `A coluna "${coluna}" não existe na tabela.`);
    const [rows] = await getBigQueryClient().query({
      query: `SELECT CAST(\`${coluna}\` AS STRING) AS valor, COUNT(*) AS qtd
              FROM \`${integration.projectId}.${integration.bronzeDataset}.${model.replace(/^silver_/, 'bronze_')}\`
              WHERE \`${coluna}\` IS NOT NULL
              GROUP BY 1
              ORDER BY qtd DESC
              LIMIT 50`,
      location: integration.location || undefined,
    });
    res.json({ valores: (rows as Array<{ valor: string; qtd: unknown }>).map((r) => ({ valor: r.valor, qtd: Number(plain(r.qtd)) })) });
  } catch (err) {
    sendError(res, err, 'Falha ao ler os valores da coluna.');
  }
});

/** Valores do BigQuery (datas, numéricos grandes) em JSON simples. */
function plain(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map(plain);
  if (Buffer.isBuffer(v)) return v.toString('base64');
  if (typeof v === 'object') {
    if ('value' in (v as Record<string, unknown>)) return (v as { value: unknown }).value;
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, plain(x)]));
  }
  return v;
}

/** Até 100 linhas da quarentena da ÚLTIMA execução registrada da tabela (sob demanda). */
qualityRouter.get('/:integracaoId/amostra', async (req, res) => {
  try {
    const user = getDataCoreUser(res);
    const { integration, tabela, model } = await resolveTable(user.idEmpresa, req.params.integracaoId, req.query.tabela);
    const { data: last, error } = await getSupabaseAdmin()
      .from('qualidade_execucoes')
      .select('dbt_invocation_id, executado_em')
      .match({ id_empresa: user.idEmpresa, integracao_id: integration.id, tabela })
      .gt('linhas_rejeitadas', 0)
      .order('executado_em', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!last?.dbt_invocation_id) {
      res.json({ linhas: [], executadoEm: null });
      return;
    }
    const [rows] = await getBigQueryClient().query({
      query: `SELECT * EXCEPT (_id_execucao)
              FROM \`${integration.projectId}.${integration.silverDataset}.${model}${REJEITADOS_SUFFIX}\`
              WHERE _id_execucao = @inv
                AND _dat_rejeicao >= TIMESTAMP_SUB(TIMESTAMP(@executadoEm), INTERVAL 1 DAY)
              LIMIT ${SAMPLE_LIMIT}`,
      params: { inv: last.dbt_invocation_id, executadoEm: last.executado_em },
      location: integration.location || undefined,
    });
    res.json({ linhas: (rows as unknown[]).map(plain), executadoEm: last.executado_em });
  } catch (err) {
    sendError(res, err, 'Falha ao ler a quarentena.');
  }
});

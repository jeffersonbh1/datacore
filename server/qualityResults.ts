import { getBigQueryClient } from './bigqueryClient';
import { readSilverManifestModel, REJEITADOS_SUFFIX, silverModelName } from './dbtCodegen';
import type { DbtModelResult, RunDbtResult } from './dbtRunner';
import { parseRuleIdFromMotivo } from './qualityRules';
import { testNameFromUniqueId } from './routes/lineage';
import { getSupabaseAdmin } from './supabaseAdmin';

// -----------------------------------------------------------------------------
// Resultado de qualidade de cada tabela Silver por execução -> Supabase
// (qualidade_execucoes, sql/018). Chamado ao fim do dbt build da Silver
// (server/routes/silver.ts). Contagens vêm do BigQuery (uma consulta para todas
// as tabelas do build); testes vêm do run_results.json do próprio build.
//
// Best-effort: qualquer falha aqui só é logada — nunca derruba a execução.
// -----------------------------------------------------------------------------

export interface RecordSilverQualityInput {
  integracaoId: number;
  sistema: string;
  tables: string[];
  projectId: string;
  bronzeDataset: string;
  silverDataset: string;
  location?: string;
  dbtRun: RunDbtResult;
}

interface Counts {
  tabela: string;
  linhas_bronze: number | null;
  linhas_silver: number | null;
  linhas_rejeitadas: number | null;
  motivos: Array<{ motivo: string; n: number }> | null;
}

// Projeto/dataset vão num SQL: só o charset de identificadores do BigQuery.
const BQ_PATH_RE = /^[A-Za-z0-9_\-.:]+$/;

const TEST_FAILED = new Set(['fail', 'error', 'runtime error']);
const MODEL_OK = new Set(['success', 'pass', 'warn']);

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(typeof v === 'object' && v !== null && 'value' in v ? (v as { value: unknown }).value : v);
  return Number.isFinite(n) ? n : null;
}

async function countAll(
  input: RecordSilverQualityInput,
  targets: Array<{ table: string; model: string; withQuarantine: boolean }>,
): Promise<Map<string, Counts>> {
  const out = new Map<string, Counts>();
  if (targets.length === 0 || !input.dbtRun.invocationId) return out;
  const { projectId, bronzeDataset, silverDataset } = input;
  if (![projectId, bronzeDataset, silverDataset].every((p) => BQ_PATH_RE.test(p))) return out;

  const parts = targets.map((t, i) => {
    const bronze = `\`${projectId}.${bronzeDataset}.${t.model.replace(/^silver_/, 'bronze_')}\``;
    const silver = `\`${projectId}.${silverDataset}.${t.model}\``;
    const rej = `\`${projectId}.${silverDataset}.${t.model}${REJEITADOS_SUFFIX}\``;
    // _dat_rejeicao >= ontem: poda as partições (a quarentena guarda 90 dias).
    const rejWhere = `_id_execucao = @inv AND _dat_rejeicao >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 DAY)`;
    return `SELECT
      @t${i} AS tabela,
      (SELECT COUNT(*) FROM ${bronze}) AS linhas_bronze,
      (SELECT COUNT(*) FROM ${silver}) AS linhas_silver,
      ${t.withQuarantine ? `(SELECT COUNT(*) FROM ${rej} WHERE ${rejWhere})` : 'CAST(0 AS INT64)'} AS linhas_rejeitadas,
      ${t.withQuarantine
        ? `ARRAY(SELECT AS STRUCT motivo, COUNT(*) AS n FROM ${rej}, UNNEST(_motivos_rejeicao) AS motivo WHERE ${rejWhere} GROUP BY motivo)`
        : 'CAST([] AS ARRAY<STRUCT<motivo STRING, n INT64>>)'} AS motivos`;
  });
  const params: Record<string, string> = { inv: input.dbtRun.invocationId };
  targets.forEach((t, i) => { params[`t${i}`] = t.table; });

  const [rows] = await getBigQueryClient().query({
    query: parts.join('\nUNION ALL\n'),
    params,
    location: input.location,
  });
  for (const r of rows as Array<Record<string, unknown>>) {
    const motivos = Array.isArray(r.motivos)
      ? (r.motivos as Array<{ motivo: string; n: unknown }>).map((m) => ({ motivo: m.motivo, n: num(m.n) ?? 0 }))
      : null;
    out.set(String(r.tabela), {
      tabela: String(r.tabela),
      linhas_bronze: num(r.linhas_bronze),
      linhas_silver: num(r.linhas_silver),
      linhas_rejeitadas: num(r.linhas_rejeitadas),
      motivos,
    });
  }
  return out;
}

/** Nome legível do teste para a tela (o nome gerado pelo dbt repete modelo e argumentos). */
function friendlyTestName(raw: string, model: string): string {
  if (raw.startsWith('reconciliacao_qualidade')) return 'Reconciliação (Bronze = Silver + quarentena)';
  const col = (prefix: string) => raw.slice(prefix.length + model.length + 1);
  if (raw.startsWith(`unique_${model}_`)) return `Chave única (${col('unique_')})`;
  if (raw.startsWith(`not_null_${model}_`)) return `Chave não nula (${col('not_null_')})`;
  if (raw.startsWith('dbt_utils_unique_combination_of_columns')) return 'Chave composta única';
  return raw;
}

function testsFor(models: DbtModelResult[], model: string) {
  return models
    .filter((m) => m.uniqueId.startsWith('test.') && (m.attachedModel === model || m.attachedModel === `${model}${REJEITADOS_SUFFIX}`))
    .map((m) => ({ nome: friendlyTestName(testNameFromUniqueId(m.uniqueId), model), status: m.status, mensagem: m.message ?? null }));
}

export async function recordSilverQuality(input: RecordSilverQualityInput): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const { data: integ, error: integError } = await supabase
      .from('integracoes')
      .select('id, id_empresa')
      .eq('id', input.integracaoId)
      .maybeSingle();
    if (integError) throw new Error(integError.message);
    if (!integ) return;

    const byName = new Map(input.dbtRun.models.map((m) => [m.name, m]));
    const plan = input.tables.map((table) => {
      const model = silverModelName(input.sistema, table);
      const entry = readSilverManifestModel(input.sistema, table);
      const columns = new Set((entry?.columns ?? []).map((c) => c.name));
      const regras = (entry?.regras ?? []).filter((r) => columns.size === 0 || columns.has(r.coluna));
      const node = byName.get(model);
      const rejNode = byName.get(`${model}${REJEITADOS_SUFFIX}`);
      const built = !!node && MODEL_OK.has(node.status);
      const quarantineOk = regras.length === 0 || (!!rejNode && MODEL_OK.has(rejNode.status));
      return { table, model, regras, node, rejNode, built, quarantineOk };
    });

    let counts = new Map<string, Counts>();
    try {
      counts = await countAll(input, plan
        .filter((p) => p.built && p.quarantineOk)
        .map((p) => ({ table: p.table, model: p.model, withQuarantine: p.regras.length > 0 })));
    } catch (err) {
      console.warn('[qualidade] contagens no BigQuery falharam:', err instanceof Error ? err.message : err);
    }

    const rows = plan.map((p) => {
      const c = counts.get(p.table);
      const testes = testsFor(input.dbtRun.models, p.model);
      const aprovados = testes.filter((t) => t.status === 'pass').length;
      const motivos: Record<string, number> = {};
      for (const m of c?.motivos ?? []) {
        const id = parseRuleIdFromMotivo(m.motivo);
        if (id !== null) motivos[String(id)] = (motivos[String(id)] ?? 0) + m.n;
      }
      const rejeitadas = c?.linhas_rejeitadas ?? 0;
      const erro = !p.built
        ? (p.node?.message || (p.node ? `dbt status "${p.node.status}"` : 'O dbt não retornou resultado para esta tabela.'))
        : !p.quarantineOk
          ? `A quarentena não foi gravada: ${p.rejNode?.message || p.rejNode?.status || 'modelo não executado'}.`
          : null;
      const status = erro ? 'erro' : testes.some((t) => TEST_FAILED.has(t.status)) ? 'teste_falhou' : rejeitadas > 0 ? 'rejeicoes' : 'ok';
      return {
        id_empresa: integ.id_empresa,
        integracao_id: input.integracaoId,
        tabela: p.table,
        modelo: p.model,
        dbt_invocation_id: input.dbtRun.invocationId ?? null,
        linhas_bronze: c?.linhas_bronze ?? null,
        linhas_silver: c?.linhas_silver ?? null,
        linhas_processadas: p.built ? (p.node?.rowsAffected ?? null) : null,
        linhas_rejeitadas: rejeitadas,
        motivos,
        testes,
        testes_aprovados: aprovados,
        testes_total: testes.length,
        regras_ativas: p.regras.length,
        status,
        erro,
      };
    });

    const { error } = await supabase.from('qualidade_execucoes').insert(rows);
    if (error) throw new Error(error.message);
  } catch (err) {
    console.warn('[qualidade] não foi possível gravar o resultado da Silver:', err instanceof Error ? err.message : err);
  }
}

import { Router } from 'express';
import { getBigQueryClient } from '../bigqueryClient';
import { DbtUnavailableError, isDbtDisabled, runDbt, type RunDbtResult } from '../dbtRunner';

export const bronzeRouter = Router();

export interface BuildBronzeInput {
  projectId: string;
  rawDataset: string;
  bronzeDataset: string;
  tables: string[];
  /** BigQuery dataset location (e.g. "southamerica-east1"), matching the raw dataset's own. */
  location?: string;
}

export interface TableResult {
  table: string;
  status: 'ok' | 'error';
  error?: string;
  /** Como a tabela foi construída: 'dbt' (modelo do projeto dbt) ou 'ctas' (fallback 1:1). */
  via?: 'dbt' | 'ctas';
}

export interface BuildBronzeOutput {
  results: TableResult[];
  /** Presente quando a construção passou pelo dbt (resumo de todos os nós, incl. testes/staging). */
  dbt?: Pick<RunDbtResult, 'ok' | 'select' | 'target' | 'models' | 'error'> & { stderrTail?: string };
}

// ---------------------------------------------------------------------------
// Fallback 1:1 (comportamento legado). Mantido para tabelas que ainda não têm
// um modelo dbt correspondente e para o caso de a infra dbt não estar
// disponível (DBT_DISABLED=true ou "dbt" ausente no PATH). Controlável por
// DBT_BRONZE_FALLBACK_CTAS ("false" desliga e força erro nesses casos).
// ---------------------------------------------------------------------------
function ctasFallbackEnabled(): boolean {
  return String(process.env.DBT_BRONZE_FALLBACK_CTAS || 'true').toLowerCase() !== 'false';
}

async function mirrorTablesWithCtas(
  { projectId, rawDataset, bronzeDataset, tables, location }: BuildBronzeInput,
): Promise<TableResult[]> {
  const bigquery = getBigQueryClient();
  const datasetLocation = location || 'southamerica-east1';

  const dataset = bigquery.dataset(bronzeDataset, { projectId });
  const [datasetExists] = await dataset.exists();
  if (!datasetExists) {
    await bigquery.createDataset(bronzeDataset, { projectId, location: datasetLocation });
  }

  const results: TableResult[] = [];
  for (const table of tables) {
    try {
      const query = `CREATE OR REPLACE TABLE \`${projectId}.${bronzeDataset}.bronze_${table}\` AS SELECT * FROM \`${projectId}.${rawDataset}.raw_${table}\``;
      await bigquery.query({ query, location: datasetLocation });
      results.push({ table, status: 'ok', via: 'ctas' });
    } catch (err) {
      results.push({ table, status: 'error', error: err instanceof Error ? err.message : 'Erro desconhecido.', via: 'ctas' });
    }
  }
  return results;
}

function statusFromDbt(status: string): 'ok' | 'error' {
  return status === 'success' || status === 'pass' || status === 'warn' ? 'ok' : 'error';
}

// Camada Bronze (Fase 5 -> Fase 7): antes um CREATE OR REPLACE TABLE ... AS
// SELECT * por tabela; agora uma execução real de `dbt build` sobre <repo>/dbt
// (server/dbtRunner.ts), que aplica tipagem, deduplicação CDC, anonimização
// LGPD e testes. Cada tabela pedida é casada com o modelo `bronze_<tabela>`;
// tabelas sem modelo caem no fallback 1:1 (ver acima). Assinatura preservada
// para os dois chamadores: a rota "/build" e bronzeAutoSync.ts.
export async function buildBronzeViaDbt(input: BuildBronzeInput): Promise<BuildBronzeOutput> {
  const { tables } = input;

  if (isDbtDisabled()) {
    return { results: await mirrorTablesWithCtas(input) };
  }

  let dbtRun: RunDbtResult;
  try {
    dbtRun = await runDbt({
      projectId: input.projectId,
      rawDataset: input.rawDataset,
      bronzeDataset: input.bronzeDataset,
      location: input.location,
    });
  } catch (err) {
    if (err instanceof DbtUnavailableError && ctasFallbackEnabled()) {
      console.warn(`[bronze] dbt indisponível (${err.message}) — usando fallback CTAS 1:1.`);
      return { results: await mirrorTablesWithCtas(input) };
    }
    throw err;
  }

  // dbt rodou mas não produziu nenhum resultado + saiu com erro => a execução
  // inteira falhou (erro de compilação/parse/conexão). Não mascara com o mirror
  // 1:1: reporta o erro do dbt em cada tabela.
  if (!dbtRun.ok && dbtRun.models.length === 0) {
    const detail = dbtRun.error || dbtRun.stderrTail || `dbt build saiu com código ${dbtRun.exitCode}`;
    return {
      results: tables.map((table) => ({ table, status: 'error' as const, error: detail, via: 'dbt' as const })),
      dbt: {
        ok: false, select: dbtRun.select, target: dbtRun.target,
        models: dbtRun.models, error: dbtRun.error, stderrTail: dbtRun.stderrTail,
      },
    };
  }

  const byModel = new Map(dbtRun.models.map((m) => [m.name, m]));
  const semModelo: string[] = [];
  const results: TableResult[] = [];

  for (const table of tables) {
    const node = byModel.get(`bronze_${table}`);
    if (node) {
      results.push({
        table,
        status: statusFromDbt(node.status),
        error: statusFromDbt(node.status) === 'ok' ? undefined : (node.message || `dbt status "${node.status}"`),
        via: 'dbt',
      });
    } else {
      semModelo.push(table);
    }
  }

  if (semModelo.length > 0) {
    if (ctasFallbackEnabled()) {
      const mirrored = await mirrorTablesWithCtas({ ...input, tables: semModelo });
      results.push(...mirrored);
    } else {
      for (const table of semModelo) {
        results.push({
          table,
          status: 'error',
          error: `sem modelo dbt — crie models/medallion/bronze/bronze_${table}.sql`,
          via: 'dbt',
        });
      }
    }
  }

  return {
    results,
    dbt: {
      ok: dbtRun.ok,
      select: dbtRun.select,
      target: dbtRun.target,
      models: dbtRun.models,
      error: dbtRun.error,
      stderrTail: dbtRun.ok ? undefined : dbtRun.stderrTail,
    },
  };
}

/** Compat: mesma assinatura de antes, retorna só os resultados por tabela. */
export async function buildBronzeForTables(input: BuildBronzeInput): Promise<TableResult[]> {
  const { results } = await buildBronzeViaDbt(input);
  return results;
}

bronzeRouter.post('/build', async (req, res) => {
  try {
    const { projectId, rawDataset, bronzeDataset, tables, location } = req.body as BuildBronzeInput;

    if (!projectId || !rawDataset || !bronzeDataset || !Array.isArray(tables) || tables.length === 0) {
      res.status(400).json({
        error: 'Campos "projectId", "rawDataset", "bronzeDataset" e "tables" (não vazio) são obrigatórios.',
      });
      return;
    }

    const { results, dbt } = await buildBronzeViaDbt({ projectId, rawDataset, bronzeDataset, tables, location });
    const hasFailure = results.some((r) => r.status === 'error') || (dbt !== undefined && !dbt.ok);
    res.status(hasFailure ? 207 : 200).json({ dataset: bronzeDataset, results, dbt });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Erro ao construir a camada Bronze.' });
  }
});

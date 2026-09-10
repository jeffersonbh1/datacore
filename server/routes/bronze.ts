import { Router } from 'express';
import { bronzeModelName, slugFromConnectionId } from '../dbtCodegen';
import { DbtUnavailableError, runDbt, type RunDbtResult } from '../dbtRunner';

// Re-export para bronzeAutoSync.ts (mantém o import existente).
export { slugFromConnectionId };

export const bronzeRouter = Router();

export interface BuildBronzeInput {
  projectId: string;
  rawDataset: string;
  bronzeDataset: string;
  tables: string[];
  /** BigQuery dataset location (e.g. "southamerica-east1"), matching the raw dataset's own. */
  location?: string;
  /** Identificador da integração ("conn_<airbyteConnectionId>") — seleciona os modelos dbt gerados. */
  slug?: string;
  /** Passa `--full-refresh` ao `dbt build`: reconstrói modelos incrementais do zero.
   *  Necessário na 1ª construção quando a tabela bronze_<t> já existe com schema
   *  incompatível (ex.: criada pelo antigo CTAS 1:1). */
  fullRefresh?: boolean;
}

export interface TableResult {
  table: string;
  status: 'ok' | 'error';
  error?: string;
  /** Modelo dbt que produziu a tabela (sempre presente — não há mais caminho fora do dbt). */
  model?: string;
}

export interface BuildBronzeOutput {
  results: TableResult[];
  dbt: Pick<RunDbtResult, 'ok' | 'select' | 'target' | 'models' | 'error'> & { stderrTail?: string };
}

function statusFromDbt(status: string): 'ok' | 'error' {
  return status === 'success' || status === 'pass' || status === 'warn' ? 'ok' : 'error';
}

// Camada Bronze (Fase 8): 100% dbt. Cada tabela da integração tem um modelo
// gerado (server/dbtCodegen.ts) em dbt/models/generated/<slug>/bronze_<slug>__<t>.sql,
// materializado como <bronzeDataset>.bronze_<t>. Aqui roda-se `dbt build
// --select tag:<slug>` e mapeia-se o resultado por tabela. Sem fallback:
// tabela sem modelo => erro (rode a geração de modelos da integração).
// Assinatura preservada para os dois chamadores: rota "/build" e bronzeAutoSync.ts.
export async function buildBronzeViaDbt(input: BuildBronzeInput): Promise<BuildBronzeOutput> {
  const { tables, slug } = input;

  if (!slug) {
    return {
      results: tables.map((table) => ({
        table,
        status: 'error' as const,
        error: 'Integração sem slug de modelos dbt — gere os modelos da integração (POST /api/dbt/models).',
      })),
      dbt: { ok: false, select: '', target: '', models: [], error: 'slug ausente' },
    };
  }

  const dbtRun = await runDbt({
    projectId: input.projectId,
    rawDataset: input.rawDataset,
    bronzeDataset: input.bronzeDataset,
    location: input.location,
    select: `tag:${slug}`,
    fullRefresh: input.fullRefresh,
  });

  // Falha total (compilação/parse/conexão): não mascara, reporta o erro por tabela.
  if (!dbtRun.ok && dbtRun.models.length === 0) {
    const detail = dbtRun.error || dbtRun.stderrTail || `dbt build saiu com código ${dbtRun.exitCode}`;
    return {
      results: tables.map((table) => ({ table, status: 'error' as const, error: detail })),
      dbt: {
        ok: false, select: dbtRun.select, target: dbtRun.target,
        models: dbtRun.models, error: dbtRun.error, stderrTail: dbtRun.stderrTail,
      },
    };
  }

  // run_results traz unique_id "model.datacore_dbt.bronze_<slug>__<tabela>".
  const byModel = new Map(dbtRun.models.map((m) => [m.name, m]));
  const results: TableResult[] = tables.map((table) => {
    const modelName = bronzeModelName(slug, table);
    const node = byModel.get(modelName);
    if (!node) {
      return {
        table,
        status: 'error' as const,
        error: `Modelo dbt "${modelName}" não encontrado — regere os modelos da integração (POST /api/dbt/models).`,
        model: modelName,
      };
    }
    return {
      table,
      status: statusFromDbt(node.status),
      error: statusFromDbt(node.status) === 'ok' ? undefined : (node.message || `dbt status "${node.status}"`),
      model: modelName,
    };
  });

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
    const { projectId, rawDataset, bronzeDataset, tables, location, slug, fullRefresh } = req.body as BuildBronzeInput;

    if (!projectId || !rawDataset || !bronzeDataset || !Array.isArray(tables) || tables.length === 0) {
      res.status(400).json({
        error: 'Campos "projectId", "rawDataset", "bronzeDataset" e "tables" (não vazio) são obrigatórios.',
      });
      return;
    }

    const { results, dbt } = await buildBronzeViaDbt({ projectId, rawDataset, bronzeDataset, tables, location, slug, fullRefresh });
    const hasFailure = results.some((r) => r.status === 'error') || !dbt.ok;
    res.status(hasFailure ? 207 : 200).json({ dataset: bronzeDataset, results, dbt });
  } catch (err) {
    const status = err instanceof DbtUnavailableError ? 503 : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erro ao construir a camada Bronze.' });
  }
});

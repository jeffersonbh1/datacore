import { Router } from 'express';
import { bronzeModelName } from '../dbtCodegen';
import { DbtUnavailableError, runDbt, type RunDbtResult } from '../dbtRunner';

export const bronzeRouter = Router();

export interface BuildBronzeInput {
  projectId: string;
  rawDataset: string;
  bronzeDataset: string;
  tables: string[];
  /** Nome do sistema de origem — casa com os modelos em models/medallion/bronze/<sistema>/. */
  sistema: string;
  /** BigQuery dataset location (e.g. "southamerica-east1"), matching the raw dataset's own. */
  location?: string;
  /** `--full-refresh` no `dbt build`: reconstrói modelos incrementais do zero.
   *  Necessário na 1ª construção quando `bronze_<sistema>_<t>` já existe com
   *  schema incompatível (ex.: criada pelo antigo CTAS 1:1). */
  fullRefresh?: boolean;
}

export interface TableResult {
  table: string;
  status: 'ok' | 'error';
  error?: string;
  /** Modelo dbt que produziu a tabela (models/medallion/bronze/<sistema>/bronze_<sistema>_<t>.sql). */
  model?: string;
  /** Linhas gravadas nesta tabela (adapter_response.rows_affected do dbt-bigquery). */
  rowsAffected?: number;
}

export interface BuildBronzeOutput {
  results: TableResult[];
  dbt: Pick<RunDbtResult, 'ok' | 'select' | 'target' | 'models' | 'error'> & { stderrTail?: string };
}

function statusFromDbt(status: string): 'ok' | 'error' {
  return status === 'success' || status === 'pass' || status === 'warn' ? 'ok' : 'error';
}

// Camada Bronze: 100% dbt. Cada tabela tem um modelo em
// dbt/models/medallion/bronze/<sistema>/bronze_<sistema>_<tabela>.sql. Roda-se
// `dbt build --select bronze_<sistema>_<t1> ...` (as tabelas da requisição) e
// mapeia-se o resultado por tabela. Sem fallback: modelo ausente => erro.
export async function buildBronzeViaDbt(input: BuildBronzeInput): Promise<BuildBronzeOutput> {
  const { tables, sistema } = input;

  if (!sistema) {
    return {
      results: tables.map((table) => ({
        table,
        status: 'error' as const,
        error: 'Integração sem "sistema" de origem — informe o nome do sistema (gere os modelos da integração).',
      })),
      dbt: { ok: false, select: '', target: '', models: [], error: 'sistema ausente' },
    };
  }

  const select = tables.map((t) => bronzeModelName(sistema, t)).join(' ');

  const dbtRun = await runDbt({
    projectId: input.projectId,
    rawDataset: input.rawDataset,
    bronzeDataset: input.bronzeDataset,
    location: input.location,
    select,
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

  const byModel = new Map(dbtRun.models.map((m) => [m.name, m]));
  const results: TableResult[] = tables.map((table) => {
    const modelName = bronzeModelName(sistema, table);
    const node = byModel.get(modelName);
    if (!node) {
      return {
        table,
        status: 'error' as const,
        error: `Modelo dbt "${modelName}" não encontrado — gere os modelos da integração (POST /api/dbt/models).`,
        model: modelName,
      };
    }
    return {
      table,
      status: statusFromDbt(node.status),
      error: statusFromDbt(node.status) === 'ok' ? undefined : (node.message || `dbt status "${node.status}"`),
      model: modelName,
      rowsAffected: node.rowsAffected,
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
    const { projectId, rawDataset, bronzeDataset, tables, sistema, location, fullRefresh } = req.body as BuildBronzeInput;

    if (!projectId || !rawDataset || !bronzeDataset || !Array.isArray(tables) || tables.length === 0) {
      res.status(400).json({
        error: 'Campos "projectId", "rawDataset", "bronzeDataset" e "tables" (não vazio) são obrigatórios.',
      });
      return;
    }

    const { results, dbt } = await buildBronzeViaDbt({ projectId, rawDataset, bronzeDataset, tables, sistema, location, fullRefresh });
    const hasFailure = results.some((r) => r.status === 'error') || !dbt.ok;
    res.status(hasFailure ? 207 : 200).json({ dataset: bronzeDataset, results, dbt });
  } catch (err) {
    const status = err instanceof DbtUnavailableError ? 503 : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erro ao construir a camada Bronze.' });
  }
});

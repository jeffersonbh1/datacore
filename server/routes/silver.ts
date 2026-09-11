import { Router } from 'express';
import { silverModelName } from '../dbtCodegen';
import { DbtUnavailableError, runDbt, type RunDbtResult } from '../dbtRunner';

export const silverRouter = Router();

export interface BuildSilverInput {
  projectId: string;
  rawDataset: string;
  bronzeDataset: string;
  silverDataset?: string;
  tables: string[];
  /** Nome do sistema de origem — casa com os modelos em models/medallion/silver/<sistema>/. */
  sistema: string;
  location?: string;
  fullRefresh?: boolean;
}

export interface TableResult {
  table: string;
  status: 'ok' | 'error';
  error?: string;
  model?: string;
  /** Linhas gravadas nesta tabela (adapter_response.rows_affected do dbt-bigquery). */
  rowsAffected?: number;
}

export interface BuildSilverOutput {
  results: TableResult[];
  dbt: Pick<RunDbtResult, 'ok' | 'select' | 'target' | 'models' | 'error'> & { stderrTail?: string };
}

function statusFromDbt(status: string): 'ok' | 'error' {
  return status === 'success' || status === 'pass' || status === 'warn' ? 'ok' : 'error';
}

// Camada Silver: mesmo mecanismo real da Bronze (dbt build via server/dbtRunner.ts),
// só muda o --select (silver_<sistema>_<t> em vez de bronze_<sistema>_<t>). Os
// modelos Silver leem via ref() do Bronze correspondente (DBT_SCHEMA_BRONZE) e
// gravam em DBT_SCHEMA_SILVER — ambos setados por runDbt. Sem fallback: modelo
// ausente (integração sem Silver gerada ainda) => erro.
export async function buildSilverViaDbt(input: BuildSilverInput): Promise<BuildSilverOutput> {
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

  const select = tables.map((t) => silverModelName(sistema, t)).join(' ');

  const dbtRun = await runDbt({
    projectId: input.projectId,
    rawDataset: input.rawDataset,
    bronzeDataset: input.bronzeDataset,
    silverDataset: input.silverDataset,
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
    const modelName = silverModelName(sistema, table);
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

silverRouter.post('/build', async (req, res) => {
  try {
    const { projectId, rawDataset, bronzeDataset, silverDataset, tables, sistema, location, fullRefresh } = req.body as BuildSilverInput;

    if (!projectId || !rawDataset || !bronzeDataset || !Array.isArray(tables) || tables.length === 0) {
      res.status(400).json({
        error: 'Campos "projectId", "rawDataset", "bronzeDataset" e "tables" (não vazio) são obrigatórios.',
      });
      return;
    }

    const { results, dbt } = await buildSilverViaDbt({ projectId, rawDataset, bronzeDataset, silverDataset, tables, sistema, location, fullRefresh });
    const hasFailure = results.some((r) => r.status === 'error') || !dbt.ok;
    res.status(hasFailure ? 207 : 200).json({ dataset: silverDataset || bronzeDataset.replace(/^bronze_/, 'silver_'), results, dbt });
  } catch (err) {
    const status = err instanceof DbtUnavailableError ? 503 : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erro ao construir a camada Silver.' });
  }
});

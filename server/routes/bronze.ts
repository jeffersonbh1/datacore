import { Router } from 'express';
import { getBigQueryClient } from '../bigqueryClient';

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
}

// Camada Bronze (Fase 5): for every table Airbyte already replicated into the raw_
// dataset, mirror it 1:1 into a bronze_ dataset via CREATE OR REPLACE TABLE ... AS
// SELECT — no real dbt-core here, "dbt" stays the product name for this pipeline
// stage. Shared by the manual "/build" route (Studio canvas button) and the
// automatic "/auto-sync" route (bronzeAutoSync.ts, Fase 6 — triggered by Cloud
// Scheduler after each Airbyte sync).
export async function buildBronzeForTables({
  projectId,
  rawDataset,
  bronzeDataset,
  tables,
  location,
}: BuildBronzeInput): Promise<TableResult[]> {
  const bigquery = getBigQueryClient();
  const datasetLocation = location || 'southamerica-east1';

  const dataset = bigquery.dataset(bronzeDataset, { projectId });
  const [datasetExists] = await dataset.exists();
  if (!datasetExists) {
    await bigquery.createDataset(bronzeDataset, { projectId, location: datasetLocation });
  }

  // Every table carries its layer's prefix, not just the dataset (Airbyte writes
  // raw tables as raw_<table> — see the connection's "prefix" in connections.ts —
  // and the Bronze mirror follows the same convention as bronze_<table>).
  const results: TableResult[] = [];
  for (const table of tables) {
    try {
      const query = `CREATE OR REPLACE TABLE \`${projectId}.${bronzeDataset}.bronze_${table}\` AS SELECT * FROM \`${projectId}.${rawDataset}.raw_${table}\``;
      await bigquery.query({ query, location: datasetLocation });
      results.push({ table, status: 'ok' });
    } catch (err) {
      results.push({ table, status: 'error', error: err instanceof Error ? err.message : 'Erro desconhecido.' });
    }
  }
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

    const results = await buildBronzeForTables({ projectId, rawDataset, bronzeDataset, tables, location });
    const hasFailure = results.some(r => r.status === 'error');
    res.status(hasFailure ? 207 : 200).json({ dataset: bronzeDataset, results });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Erro ao construir a camada Bronze.' });
  }
});

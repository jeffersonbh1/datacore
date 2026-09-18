import { Router } from 'express';
import { readBronzeColumnDescriptions, standardizedColumnName, writeBronzeColumnDescription } from '../bronzeColumnDocs';
import { getBigQueryClient } from '../bigqueryClient';
import { piiMacroFor } from '../dbtCodegen';

export const rawCatalogRouter = Router();

// -----------------------------------------------------------------------------
// Dicionário de Dados da camada Raw (Hub de Governança & LGPD): lista as colunas
// reais de uma tabela raw (ao vivo, via BigQuery INFORMATION_SCHEMA — a Raw não
// tem um _properties.yml próprio, o schema de fato é o da tabela no BigQuery),
// com métricas simples de qualidade (nulos/preenchimento, distintos), a
// descrição documentada — lida/gravada no _properties.yml Bronze do sistema
// (ver server/bronzeColumnDocs.ts) — e se o campo é dado pessoal (mesma
// heurística de nome usada para mascarar a Bronze — LGPD Art. 46).
// -----------------------------------------------------------------------------

export interface RawColumnInfo {
  name: string;
  dataType: string;
  description: string | null;
  isPii: boolean;
  quality: {
    totalRows: number;
    nullCount: number;
    nullPct: number;
    distinctCount: number;
    status: 'sem_dados' | 'completo' | 'atencao' | 'critico';
  };
}

function qualityStatus(totalRows: number, nullPct: number): RawColumnInfo['quality']['status'] {
  if (totalRows === 0) return 'sem_dados';
  if (nullPct === 0) return 'completo';
  if (nullPct < 20) return 'atencao';
  return 'critico';
}

/** Identificador de coluna seguro para interpolar em SQL (sem backtick/quote). */
function isSafeIdent(s: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s);
}

rawCatalogRouter.get('/columns', async (req, res) => {
  try {
    const projectId = String(req.query.projectId || '');
    const rawDataset = String(req.query.rawDataset || '');
    const table = String(req.query.table || '');
    const sistema = String(req.query.sistema || '');
    const location = req.query.location ? String(req.query.location) : undefined;

    if (!projectId || !rawDataset || !table || !sistema) {
      res.status(400).json({ error: 'Parâmetros "projectId", "rawDataset", "table" e "sistema" são obrigatórios.' });
      return;
    }
    if (!/^[A-Za-z0-9_-]+$/.test(projectId) || !/^[A-Za-z0-9_-]+$/.test(rawDataset) || !/^[A-Za-z0-9_.\-]+$/.test(table)) {
      res.status(400).json({ error: 'projectId/rawDataset/table inválidos.' });
      return;
    }

    const physicalTable = `raw_${table}`;
    const bigquery = getBigQueryClient();
    const queryOpts = (sql: string, params?: Record<string, unknown>) => ({ query: sql, params, location });

    const [schemaRows] = await bigquery.query(
      queryOpts(
        `SELECT column_name, data_type
         FROM \`${projectId}.${rawDataset}\`.INFORMATION_SCHEMA.COLUMNS
         WHERE table_name = @tableName
         ORDER BY ordinal_position`,
        { tableName: physicalTable },
      ),
    );

    if (!schemaRows || schemaRows.length === 0) {
      res.status(404).json({
        error: `Tabela "${physicalTable}" não encontrada em ${projectId}.${rawDataset} — confira se a sincronização Raw já rodou.`,
      });
      return;
    }

    const columnNames: string[] = schemaRows.map((r: { column_name: string }) => r.column_name).filter(isSafeIdent);
    const dataTypeByName = new Map(schemaRows.map((r: { column_name: string; data_type: string }) => [r.column_name, r.data_type]));

    // APPROX_COUNT_DISTINCT não aceita tipos "não agrupáveis" (JSON, ARRAY,
    // STRUCT, GEOGRAPHY) — Airbyte Destination v2 grava colunas JSON para
    // campos aninhados/variantes, então isso aparece com frequência nas
    // tabelas raw reais. Contorna convertendo para STRING antes de contar.
    const distinctExpr = (col: string): string => {
      const type = (dataTypeByName.get(col) || '').toUpperCase();
      const needsCast = type === 'JSON' || type.startsWith('ARRAY') || type.startsWith('STRUCT') || type === 'GEOGRAPHY';
      return needsCast ? `TO_JSON_STRING(\`${col}\`)` : `\`${col}\``;
    };

    const qualitySelect = columnNames
      .map((c, i) => `COUNTIF(\`${c}\` IS NULL) AS null_${i}, APPROX_COUNT_DISTINCT(${distinctExpr(c)}) AS distinct_${i}`)
      .join(',\n        ');

    const [qualityRows] = await bigquery.query(
      queryOpts(
        `SELECT COUNT(*) AS total_rows${columnNames.length ? ',\n        ' + qualitySelect : ''}
         FROM \`${projectId}.${rawDataset}.${physicalTable}\``,
      ),
    );

    const q = (qualityRows?.[0] || {}) as Record<string, number>;
    const totalRows = Number(q.total_rows || 0);

    // Descrição vem do _properties.yml Bronze do sistema — indexado pelo nome
    // PADRONIZADO da coluna, então resolve o mapeamento origem->padronizado
    // por coluna raw antes de consultar.
    const descriptionsByStandardizedName = readBronzeColumnDescriptions(sistema, table);

    const columns: RawColumnInfo[] = columnNames.map((name, i) => {
      const nullCount = Number(q[`null_${i}`] || 0);
      const distinctCount = Number(q[`distinct_${i}`] || 0);
      const nullPct = totalRows > 0 ? Math.round((nullCount / totalRows) * 1000) / 10 : 0;
      const standardizedName = standardizedColumnName(sistema, table, name);
      const description = descriptionsByStandardizedName.get(standardizedName) ?? null;
      return {
        name,
        dataType: String(dataTypeByName.get(name) || ''),
        description,
        isPii: piiMacroFor(name) !== null,
        quality: { totalRows, nullCount, nullPct, distinctCount, status: qualityStatus(totalRows, nullPct) },
      };
    });

    res.json({ table, physicalTable, totalRows, columns });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao consultar as colunas da tabela raw.' });
  }
});

export interface RawTableCount {
  table: string;
  status: 'ok' | 'error';
  rowsAffected: number | null;
  error: string | null;
}

// -----------------------------------------------------------------------------
// Contagem de linhas por tabela da Raw, para a tela "Execuções" (mesma lista
// que Bronze/Silver já mostram, via TableBuildResult). Diferente de
// bronze_tables/silver_tables (sql/010), que gravam um retrato por RUN, esta
// contagem é sempre AO VIVO — a Raw é sincronizada pelo Airbyte, não pelo
// nosso servidor, então não temos um hook de gravação por execução; SELECT
// COUNT(*) reflete o estado atual da tabela no BigQuery, igual ao Dicionário
// de Dados acima.
// -----------------------------------------------------------------------------
rawCatalogRouter.get('/row-counts', async (req, res) => {
  try {
    const projectId = String(req.query.projectId || '');
    const rawDataset = String(req.query.rawDataset || '');
    const tablesParam = String(req.query.tables || '');
    const location = req.query.location ? String(req.query.location) : undefined;
    const tables = tablesParam.split(',').map((t) => t.trim()).filter(Boolean);

    if (!projectId || !rawDataset || tables.length === 0) {
      res.status(400).json({ error: 'Parâmetros "projectId", "rawDataset" e "tables" (lista separada por vírgula) são obrigatórios.' });
      return;
    }
    if (!/^[A-Za-z0-9_-]+$/.test(projectId) || !/^[A-Za-z0-9_-]+$/.test(rawDataset) || tables.some((t) => !/^[A-Za-z0-9_.-]+$/.test(t))) {
      res.status(400).json({ error: 'projectId/rawDataset/tables inválidos.' });
      return;
    }

    const bigquery = getBigQueryClient();
    const counts: RawTableCount[] = await Promise.all(
      tables.map(async (table): Promise<RawTableCount> => {
        const physicalTable = `raw_${table}`;
        try {
          const [rows] = await bigquery.query({
            query: `SELECT COUNT(*) AS total_rows FROM \`${projectId}.${rawDataset}.${physicalTable}\``,
            location,
          });
          const totalRows = Number((rows?.[0] as { total_rows?: number })?.total_rows ?? 0);
          return { table, status: 'ok', rowsAffected: totalRows, error: null };
        } catch (err) {
          return {
            table,
            status: 'error',
            rowsAffected: null,
            error: err instanceof Error ? err.message : `Falha ao consultar "${physicalTable}".`,
          };
        }
      }),
    );

    res.json({ counts });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao consultar contagens da Raw.' });
  }
});

rawCatalogRouter.put('/columns', (req, res) => {
  try {
    const { sistema, table, column, description } = req.body as {
      sistema?: string;
      table?: string;
      column?: string;
      description?: string;
    };
    if (!sistema || !table || !column || typeof description !== 'string') {
      res.status(400).json({ error: 'Campos "sistema", "table", "column" e "description" (string) são obrigatórios.' });
      return;
    }
    const { standardizedName } = writeBronzeColumnDescription(sistema, table, column, description);
    res.json({ ok: true, table, column, standardizedName, description, isPii: piiMacroFor(column) !== null });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Falha ao salvar a descrição da coluna.' });
  }
});

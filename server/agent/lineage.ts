import { getBigQueryClient } from '../bigqueryClient';
import { sanitizeIdent } from '../dbtCodegen';
import { parseRefs, parseSources, readModelSql, type CatalogModel, type TenantContext, type TenantIntegration } from './catalog';

// -----------------------------------------------------------------------------
// Linhagem de dados da empresa: Origem -> Raw -> Bronze -> Silver -> Gold, com as
// setas lidas dos SQLs REAIS do dbt ({{ source() }} / {{ ref() }}), não supostas
// pela convenção de nomes. É isso que faz um Gold que junta Silvers de integrações
// diferentes aparecer ligado às duas. Só metadados do BigQuery (__TABLES__: linhas
// e última atualização) — nenhuma leitura de dados, custo zero.
// -----------------------------------------------------------------------------

export type LineageLayer = 'source' | 'raw' | 'bronze' | 'silver' | 'gold';

export interface LineageNode {
  id: string;
  layer: LineageLayer;
  /** Nome da tabela/modelo (ex.: silver_arena_fahel_beach_alunos; raw_alunos; nome da origem). */
  name: string;
  /** Nome original da tabela na origem (ex.: "alunos") — igual nas três camadas de uma mesma tabela; null na origem e no Gold. */
  table: string | null;
  dataset: string | null;
  integrationId: number | null;
  integrationName: string | null;
  sistema: string | null;
  columns: number | null;
  description: string | null;
  /** A tabela existe no BigQuery? null = não foi possível saber (dataset sem permissão/inexistente). */
  built: boolean | null;
  rows: number | null;
  lastModified: string | null;
}

export interface LineageEdge {
  id: string;
  source: string;
  target: string;
}

export interface Lineage {
  nodes: LineageNode[];
  edges: LineageEdge[];
  integrations: TenantIntegration[];
  generatedAt: string;
}

const SAFE_IDENT = /^[A-Za-z0-9_-]+$/;

interface TableStat { rows: number | null; lastModified: string | null }

/** Linhas e última modificação de todas as tabelas de cada dataset (metadado, sem custo). */
async function loadTableStats(projectId: string, datasets: string[]): Promise<Map<string, TableStat | 'unknown'>> {
  const out = new Map<string, TableStat | 'unknown'>();
  const bq = getBigQueryClient();
  await Promise.all(
    [...new Set(datasets)].filter((d) => SAFE_IDENT.test(d) && SAFE_IDENT.test(projectId)).map(async (dataset) => {
      try {
        const [rows] = await bq.query({
          query: `SELECT table_id, row_count, last_modified_time FROM \`${projectId}.${dataset}.__TABLES__\``,
          location: process.env.DBT_GCP_LOCATION || 'southamerica-east1',
        });
        for (const r of rows as Array<{ table_id: string; row_count: number | string | null; last_modified_time: number | string | null }>) {
          out.set(`${dataset}.${r.table_id}`, {
            rows: r.row_count === null || r.row_count === undefined ? null : Number(r.row_count),
            lastModified: r.last_modified_time ? new Date(Number(r.last_modified_time)).toISOString() : null,
          });
        }
        out.set(`${dataset}.*`, { rows: null, lastModified: null }); // marca: dataset consultado com sucesso
      } catch {
        out.set(`${dataset}.*`, 'unknown');
      }
    }),
  );
  return out;
}

export async function buildLineage(t: TenantContext): Promise<Lineage> {
  const nodes = new Map<string, LineageNode>();
  const edges: LineageEdge[] = [];
  const addEdge = (source: string, target: string) => {
    const id = `${source}->${target}`;
    if (source !== target && nodes.has(source) && nodes.has(target) && !edges.some((e) => e.id === id)) edges.push({ id, source, target });
  };
  const integrationById = new Map(t.integrations.map((i) => [i.id, i]));

  // Origem -> Raw (uma tabela Raw por tabela replicada, por integração)
  for (const integ of t.integrations) {
    const srcId = `src:${integ.id}`;
    nodes.set(srcId, {
      id: srcId, layer: 'source', name: integ.sistemaNome, table: null, dataset: null, integrationId: integ.id, integrationName: integ.nome,
      sistema: integ.sistema, columns: null, description: `Origem de dados "${integ.sistemaNome}" (integração ${integ.nome}).`,
      built: null, rows: null, lastModified: null,
    });
    for (const table of integ.tables) {
      const rawId = `raw:${integ.id}:${table}`;
      nodes.set(rawId, {
        id: rawId, layer: 'raw', name: `raw_${table}`, table, dataset: integ.rawDataset, integrationId: integ.id, integrationName: integ.nome,
        sistema: integ.sistema, columns: null, description: null, built: null, rows: null, lastModified: null,
      });
      addEdge(srcId, rawId);
    }
  }

  // Modelos dbt (Bronze/Silver/Gold)
  const models = [...t.models.values()];
  for (const m of models) {
    const integ = m.integrationId ? integrationById.get(m.integrationId) : undefined;
    nodes.set(m.name, {
      id: m.name, layer: m.layer, name: m.name, table: m.sourceTable ?? null, dataset: m.dataset, integrationId: integ?.id ?? null, integrationName: integ?.nome ?? null,
      sistema: m.sistema, columns: m.columns.length || null, description: m.description ?? null, built: null, rows: null, lastModified: null,
    });
  }

  // Setas lidas dos SQLs
  for (const m of models) {
    const sql = readModelSql(t, m);
    if (m.layer === 'bronze') {
      const integ = m.integrationId ? integrationById.get(m.integrationId) : undefined;
      if (integ) {
        // {{ source('datacore_raw', '<tabela sanitizada>') }} -> tabela Raw da MESMA integração
        const bySanitized = new Map(integ.tables.map((tb) => [sanitizeIdent(tb), tb]));
        const fromSql = sql ? parseSources(sql).map((s) => bySanitized.get(s.table)).filter((x): x is string => Boolean(x)) : [];
        const raws = fromSql.length ? fromSql : m.sourceTable ? [m.sourceTable] : [];
        for (const tb of raws) addEdge(`raw:${integ.id}:${tb}`, m.name);
      }
    }
    if (m.layer === 'silver' || m.layer === 'gold') {
      const refs = sql ? parseRefs(sql) : [];
      if (refs.length) for (const r of refs) addEdge(r, m.name);
      else if (m.layer === 'silver' && m.integrationId && m.sourceTable) {
        // SQL indisponível: cai na convenção 1:1 (silver_<sistema>_<t> <- bronze_<sistema>_<t>)
        const bronze = models.find((b) => b.layer === 'bronze' && b.integrationId === m.integrationId && b.sourceTable === m.sourceTable);
        if (bronze) addEdge(bronze.name, m.name);
      }
    }
  }

  // Existência/linhas/última atualização no BigQuery
  const stats = await loadTableStats(t.projectId, [...nodes.values()].map((n) => n.dataset).filter((d): d is string => Boolean(d)));
  for (const n of nodes.values()) {
    if (!n.dataset) continue;
    const table = stats.get(`${n.dataset}.${n.name}`);
    const datasetKnown = stats.get(`${n.dataset}.*`);
    if (datasetKnown === 'unknown' || datasetKnown === undefined) continue; // built: null
    if (table && table !== 'unknown') { n.built = true; n.rows = table.rows; n.lastModified = table.lastModified; }
    else n.built = false;
  }

  return { nodes: [...nodes.values()], edges, integrations: t.integrations, generatedAt: new Date().toISOString() };
}

// ---- Construção do Gold (dbt build) -------------------------------------------------

/** Datasets Silver de que um Gold depende, seguindo Gold -> Gold até chegar nas Silvers. */
export function silverDatasetsOf(t: TenantContext, model: CatalogModel, seen = new Set<string>()): Set<string> {
  const out = new Set<string>();
  if (seen.has(model.name)) return out;
  seen.add(model.name);
  const sql = readModelSql(t, model);
  for (const ref of sql ? parseRefs(sql) : []) {
    const dep = t.models.get(ref);
    if (!dep) continue;
    if (dep.layer === 'silver') out.add(dep.dataset);
    else if (dep.layer === 'gold') for (const d of silverDatasetsOf(t, dep, seen)) out.add(d);
  }
  return out;
}

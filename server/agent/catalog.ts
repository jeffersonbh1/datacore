import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  BRONZE_MANIFEST_FILE,
  SILVER_MANIFEST_FILE,
  bronzeModelName,
  readJsonManifest,
  silverModelName,
  sistemaSlug,
  syncDbtFromRemote,
  type BronzeManifest,
} from '../dbtCodegen';
import { resolveDbtProjectDir } from '../dbtRunner';
import { getSupabaseAdmin } from '../supabaseAdmin';

// -----------------------------------------------------------------------------
// Catálogo ESTRUTURADO do agente "Converse com os dados": quais modelos
// Bronze/Silver/Gold existem para a empresa do usuário, em que dataset do
// BigQuery cada um mora e quais colunas têm. É a fonte de verdade para nomes,
// tipos e datasets (o conhecimento semântico — regras, métricas — vem de
// `regras_negocio`, ver agent/knowledge.ts).
//
// Isolamento: tudo aqui parte das `integracoes` da empresa (id_empresa vem do
// JWT validado em userSession.ts). Só entram no catálogo os modelos dos
// sistemas/tabelas dessa empresa e os datasets derivados dos destinos dela.
// Ressalva conhecida (herdada do desenho do dbt, onde o nome do modelo é um
// namespace global): duas empresas com uma origem de mesmo nome compartilham
// a pasta/manifesto desse sistema — o que vaza no máximo é o METADADO de
// colunas, nunca dados, já que toda consulta usa os datasets da própria empresa.
// -----------------------------------------------------------------------------

export type Layer = 'bronze' | 'silver' | 'gold';

export interface CatalogColumn {
  name: string;
  /** Nome da coluna no sistema de origem (Bronze/Silver). */
  source?: string;
  description?: string;
}

export interface CatalogModel {
  name: string;
  layer: Layer;
  /** Slug do sistema de origem (null no Gold — é da empresa, não de um sistema). */
  sistema: string | null;
  dataset: string;
  /** Integração dona do modelo (Bronze/Silver) — o Gold é da empresa, não de uma integração. */
  integrationId?: number;
  /** Tabela raw de origem (Bronze/Silver). */
  sourceTable?: string;
  primaryKey: string[];
  columns: CatalogColumn[];
  description?: string;
}

/** Uma integração (origem -> destino BigQuery) da empresa, com os datasets de cada camada. */
export interface TenantIntegration {
  id: number;
  nome: string;
  /** Nome da origem (sistema) como cadastrado, e o slug usado nas pastas/modelos do dbt. */
  sistemaNome: string;
  sistema: string;
  airbyteConnectionId: string | null;
  projectId: string;
  rawDataset: string;
  bronzeDataset: string;
  silverDataset: string;
  goldDataset: string;
  location: string | null;
  tables: string[];
}

export interface TenantContext {
  idEmpresa: number;
  empresaNome: string;
  /** Slug em snake_case — prefixo dos modelos Gold (gold_<slug>_...) e nome da pasta. */
  empresaSlug: string;
  projectId: string;
  goldDataset: string | null;
  datasets: { bronze: string[]; silver: string[]; gold: string[] };
  integrations: TenantIntegration[];
  /** Datasets consultáveis pelo agente (Bronze/Silver/Gold — nunca a Raw). */
  allowedDatasets: Set<string>;
  models: Map<string, CatalogModel>;
}

interface IntegracaoRow {
  id: number;
  nome: string | null;
  airbyte_connection_id: string | null;
  tabelas_selecionadas: string[] | null;
  dataset_override: string | null;
  origens: { nome: string | null } | { nome: string | null }[] | null;
  destinos: { tipo: string; configuracao: Record<string, unknown> } | { tipo: string; configuracao: Record<string, unknown> }[] | null;
}

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/** Mesma derivação de dataset de server/dbtRunner.ts::deriveDataset e das rotas
 *  Bronze — raw_X -> bronze_X -> silver_X / gold_X. */
function deriveDatasets(rawDataset: string): { bronze: string; silver: string; gold: string } {
  const bronze = rawDataset.replace(/^raw_/, 'bronze_');
  const swap = (prefix: 'silver_' | 'gold_') => (/^bronze_/.test(bronze) ? bronze.replace(/^bronze_/, prefix) : `${prefix}${bronze}`);
  return { bronze, silver: swap('silver_'), gold: swap('gold_') };
}

export const goldNamePrefix = (t: TenantContext) => `gold_${t.empresaSlug}_`;

/** Modelos referenciados por {{ ref('x') }} num SQL dbt (sem repetição, na ordem em que aparecem). */
export function parseRefs(sql: string): string[] {
  return [...new Set([...sql.matchAll(/\{\{\s*ref\(\s*['"]([A-Za-z0-9_]+)['"]\s*\)\s*\}\}/g)].map((m) => m[1]))];
}

/** Tabelas de {{ source('origem', 'tabela') }} — as tabelas Raw lidas pela Bronze. */
export function parseSources(sql: string): Array<{ source: string; table: string }> {
  return [...sql.matchAll(/\{\{\s*source\(\s*['"]([A-Za-z0-9_]+)['"]\s*,\s*['"]([A-Za-z0-9_.\-]+)['"]\s*\)\s*\}\}/g)].map((m) => ({ source: m[1], table: m[2] }));
}

/** Caminho do .sql de um modelo no projeto dbt (ou null se não existir no disco). */
export function modelSqlPath(t: TenantContext, m: CatalogModel): string | null {
  const dir = m.layer === 'gold'
    ? goldDir(t)
    : join(resolveDbtProjectDir(), 'models', 'medallion', m.layer, m.sistema || '');
  const file = join(dir, `${m.name}.sql`);
  return existsSync(file) ? file : null;
}

export function readModelSql(t: TenantContext, m: CatalogModel): string | null {
  const file = modelSqlPath(t, m);
  return file ? readFileSync(file, 'utf8') : null;
}

/** silver_X -> gold_X (mesma convenção raw_X -> bronze_X -> silver_X -> gold_X do dbtRunner). */
function goldDatasetFromDataset(dataset: string): string {
  if (/^silver_/.test(dataset)) return dataset.replace(/^silver_/, 'gold_');
  if (/^gold_/.test(dataset)) return dataset;
  return `gold_${dataset}`;
}

/** Pasta dos modelos Gold desta empresa: models/medallion/gold/<empresa>/. */
export function goldDir(t: TenantContext): string {
  return join(resolveDbtProjectDir(), 'models', 'medallion', 'gold', t.empresaSlug);
}

/**
 * Dataset de um Gold = o Gold da(s) Silver(s) de que ele depende (silver_X -> gold_X),
 * não um dataset único da empresa: com várias integrações em datasets diferentes, um
 * dataset "da empresa" seria arbitrário. Dependendo só de outros Gold, herda o deles.
 */
function deriveGoldDataset(refs: string[], known: Map<string, CatalogModel>, fallback: string | null): string | null {
  for (const r of refs) {
    const dep = known.get(r);
    if (dep && (dep.layer === 'silver' || dep.layer === 'gold')) return goldDatasetFromDataset(dep.dataset);
  }
  return fallback;
}

function readGoldModels(t: TenantContext, fallbackDataset: string | null): CatalogModel[] {
  const dir = goldDir(t);
  if (!existsSync(dir)) return [];

  const docs = new Map<string, { description?: string; columns: CatalogColumn[] }>();
  const propsPath = join(dir, '_properties.yml');
  if (existsSync(propsPath)) {
    try {
      const parsed = parseYaml(readFileSync(propsPath, 'utf8')) as { models?: Array<Record<string, unknown>> } | null;
      for (const m of parsed?.models ?? []) {
        const cols = Array.isArray(m.columns) ? (m.columns as Array<Record<string, unknown>>) : [];
        docs.set(String(m.name), {
          description: typeof m.description === 'string' ? m.description : undefined,
          columns: cols.map((c) => ({ name: String(c.name), description: typeof c.description === 'string' ? c.description : undefined })),
        });
      }
    } catch { /* yml inválido: segue só com os .sql */ }
  }

  const found = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.replace(/\.sql$/, ''))
    .map((name) => ({ name, refs: parseRefs(readFileSync(join(dir, `${name}.sql`), 'utf8')) }));

  // Um Gold pode depender de outro Gold: resolve em rodadas até estabilizar (ou esgotar as camadas).
  const resolved = new Map<string, CatalogModel>(t.models);
  const out: CatalogModel[] = [];
  let pending = found;
  for (let round = 0; round < 5 && pending.length > 0; round++) {
    const next: typeof pending = [];
    for (const g of pending) {
      const depOnUnresolvedGold = g.refs.some((r) => found.some((f) => f.name === r) && !resolved.has(r));
      if (depOnUnresolvedGold && round < 4) { next.push(g); continue; }
      const dataset = deriveGoldDataset(g.refs, resolved, fallbackDataset);
      if (!dataset) continue;
      const model: CatalogModel = {
        name: g.name,
        layer: 'gold',
        sistema: null,
        dataset,
        primaryKey: [],
        columns: docs.get(g.name)?.columns ?? [],
        description: docs.get(g.name)?.description,
      };
      resolved.set(g.name, model);
      out.push(model);
    }
    pending = next;
  }
  return out;
}

export async function loadTenantContext(idEmpresa: number): Promise<TenantContext> {
  // O disco do gateway é efêmero: antes de ler os modelos, traz o que o GitHub tem de novo
  // (Gold salvo depois do último deploy). Não lança e é limitado a 1x/30 s.
  await syncDbtFromRemote();
  const supabase = getSupabaseAdmin();

  const { data: empresa, error: empresaError } = await supabase
    .from('empresas')
    .select('id, nome, slug')
    .eq('id', idEmpresa)
    .maybeSingle();
  if (empresaError) throw new Error(empresaError.message);
  if (!empresa) throw new Error(`Empresa ${idEmpresa} não encontrada.`);

  const { data: integracoes, error: intError } = await supabase
    .from('integracoes')
    .select('id, nome, airbyte_connection_id, tabelas_selecionadas, dataset_override, origens(nome), destinos(tipo, configuracao)')
    .eq('id_empresa', idEmpresa);
  if (intError) throw new Error(intError.message);

  const projectDir = resolveDbtProjectDir();
  const bronzeManifest = readJsonManifest<BronzeManifest>(projectDir, BRONZE_MANIFEST_FILE);
  const silverManifest = readJsonManifest<BronzeManifest>(projectDir, SILVER_MANIFEST_FILE);

  const models = new Map<string, CatalogModel>();
  const integrations: TenantIntegration[] = [];
  const bronzeDatasets = new Set<string>();
  const silverDatasets = new Set<string>();
  const goldCount = new Map<string, number>();
  let projectId = '';

  for (const row of (integracoes ?? []) as unknown as IntegracaoRow[]) {
    const destino = one(row.destinos);
    const origem = one(row.origens);
    if (!destino || destino.tipo !== 'bigquery') continue;

    const cfg = destino.configuracao as { accountOrProject?: string; databaseOrDataset?: string; warehouseOrCluster?: string };
    const rawDataset = row.dataset_override || cfg.databaseOrDataset;
    const sistemaNome = (origem?.nome || '').trim();
    if (!cfg.accountOrProject || !rawDataset || !sistemaNome) continue;

    projectId = projectId || cfg.accountOrProject;
    const ds = deriveDatasets(rawDataset);
    bronzeDatasets.add(ds.bronze);
    silverDatasets.add(ds.silver);
    goldCount.set(ds.gold, (goldCount.get(ds.gold) ?? 0) + 1);

    const sys = sistemaSlug(sistemaNome);
    integrations.push({
      id: Number(row.id),
      nome: String(row.nome || sistemaNome),
      sistemaNome,
      sistema: sys,
      airbyteConnectionId: row.airbyte_connection_id ?? null,
      projectId: cfg.accountOrProject,
      rawDataset,
      bronzeDataset: ds.bronze,
      silverDataset: ds.silver,
      goldDataset: ds.gold,
      location: cfg.warehouseOrCluster || null,
      tables: [...(row.tabelas_selecionadas ?? [])],
    });
    for (const table of row.tabelas_selecionadas ?? []) {
      const bName = bronzeModelName(sistemaNome, table);
      const bDoc = bronzeManifest[sys]?.[bName];
      models.set(bName, {
        name: bName, layer: 'bronze', sistema: sys, dataset: ds.bronze, integrationId: Number(row.id), sourceTable: table,
        primaryKey: bDoc?.pk ?? [], columns: bDoc?.columns ?? [],
      });
      const sName = silverModelName(sistemaNome, table);
      const sDoc = silverManifest[sys]?.[sName];
      models.set(sName, {
        name: sName, layer: 'silver', sistema: sys, dataset: ds.silver, integrationId: Number(row.id), sourceTable: table,
        primaryKey: sDoc?.pk ?? [], columns: sDoc?.columns ?? [],
      });
    }
  }

  const goldDataset = [...goldCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const goldDatasets = [...goldCount.keys()];

  const tenant: TenantContext = {
    idEmpresa,
    empresaNome: String(empresa.nome),
    empresaSlug: sistemaSlug(String(empresa.slug || empresa.nome)),
    projectId,
    goldDataset,
    datasets: { bronze: [...bronzeDatasets], silver: [...silverDatasets], gold: goldDatasets },
    integrations,
    allowedDatasets: new Set([...bronzeDatasets, ...silverDatasets, ...goldDatasets]),
    models,
  };

  for (const g of readGoldModels(tenant, goldDataset)) models.set(g.name, g);
  return tenant;
}

/** Prefixos de tabela consultáveis: as tabelas Raw (raw_*) ficam de fora mesmo
 *  quando Bronze e Raw dividem o dataset (rawDataset sem prefixo raw_). */
export const QUERYABLE_TABLE_PREFIXES = ['bronze_', 'silver_', 'gold_'];

export function summarizeModel(m: CatalogModel) {
  return {
    name: m.name,
    layer: m.layer,
    sistema: m.sistema,
    table: `${m.dataset}.${m.name}`,
    source_table: m.sourceTable ?? null,
    columns: m.columns.length,
    description: m.description ?? null,
  };
}

export function listModels(t: TenantContext, opts: { layer?: Layer; search?: string }): CatalogModel[] {
  const term = (opts.search || '').trim().toLowerCase();
  return [...t.models.values()]
    .filter((m) => !opts.layer || m.layer === opts.layer)
    .filter((m) => {
      if (!term) return true;
      const hay = [m.name, m.sourceTable, m.description, ...m.columns.map((c) => c.name)].join(' ').toLowerCase();
      return term.split(/\s+/).every((w) => hay.includes(w));
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** ref('modelo') -> tabela totalmente qualificada no BigQuery (null se desconhecido). */
export function resolveRef(t: TenantContext, name: string): { projectId: string; dataset: string; table: string } | null {
  const m = t.models.get(name);
  return m ? { projectId: t.projectId, dataset: m.dataset, table: m.name } : null;
}

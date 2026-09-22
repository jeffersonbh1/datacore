import { gatewayUserRequest } from './dataChat';

// -----------------------------------------------------------------------------
// Linhagem de dados (Studio Visual ETL Gold): tipos, chamadas ao gateway e a
// lógica PURA do grafo — quem alimenta quem (fechamento para os dois lados) e o
// layout em colunas. Sem React aqui, para testar isolado.
// -----------------------------------------------------------------------------

export type LineageLayer = 'source' | 'raw' | 'bronze' | 'silver' | 'gold';

export interface LineageNode {
  id: string;
  layer: LineageLayer;
  name: string;
  /** Nome original da tabela na origem (igual nas 3 camadas de uma mesma tabela). */
  table: string | null;
  dataset: string | null;
  integrationId: number | null;
  integrationName: string | null;
  sistema: string | null;
  columns: number | null;
  description: string | null;
  built: boolean | null;
  rows: number | null;
  lastModified: string | null;
}

export interface LineageEdge { id: string; source: string; target: string }

export interface LineageIntegration {
  id: number;
  nome: string;
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

export interface Lineage {
  nodes: LineageNode[];
  edges: LineageEdge[];
  integrations: LineageIntegration[];
  generatedAt: string;
}

export interface ModelSql {
  name: string;
  layer: LineageLayer;
  dataset: string;
  sql: string | null;
  columns: Array<{ name: string; source?: string; description?: string }>;
  primaryKey: string[];
}

export interface GoldBuildResult {
  model: string;
  dataset: string | null;
  status: 'ok' | 'error';
  rowsAffected: number | null;
  error: string | null;
  tests: Array<{ name: string; status: string; message: string | null }>;
}

export const fetchLineage = () => gatewayUserRequest<Lineage>('/api/lineage');
export const fetchModelSql = (model: string) => gatewayUserRequest<ModelSql>(`/api/lineage/sql?model=${encodeURIComponent(model)}`);
/** Sobrescreve o .sql real de um modelo Bronze/Silver/Gold — usado pelo editor completo do Studio Gold. */
export const saveModelSql = (model: string, sql: string) =>
  gatewayUserRequest<{ ok: boolean; name: string }>(`/api/lineage/sql?model=${encodeURIComponent(model)}`, { method: 'PUT', body: JSON.stringify({ sql }) });
/** _properties.yml real (documentação/testes) da entrada deste modelo — só leitura. */
export const fetchModelProperties = (model: string) =>
  gatewayUserRequest<{ yaml: string | null }>(`/api/lineage/properties?model=${encodeURIComponent(model)}`);
/** `dbt compile` de verdade (não simulado) — renderiza o Jinja contra o dataset real, sem gravar no BigQuery. */
export const compileModel = (model: string) =>
  gatewayUserRequest<{ sql: string }>('/api/lineage/compile', { method: 'POST', body: JSON.stringify({ model }) });
export const buildGoldModels = (models: string[]) =>
  gatewayUserRequest<{ results: GoldBuildResult[] }>('/api/lineage/gold/build', { method: 'POST', body: JSON.stringify({ models }) });

// ---- Grafo --------------------------------------------------------------------------

export const LAYERS: LineageLayer[] = ['source', 'raw', 'bronze', 'silver', 'gold'];
export const LAYER_LABEL: Record<LineageLayer, string> = { source: 'Origem', raw: 'Raw', bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };
const layerIndex = (l: LineageLayer) => LAYERS.indexOf(l);

export interface LineageIndex {
  byId: Map<string, LineageNode>;
  parents: Map<string, string[]>;
  children: Map<string, string[]>;
}

export function indexLineage(l: Lineage): LineageIndex {
  const byId = new Map(l.nodes.map((n) => [n.id, n]));
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const n of l.nodes) { parents.set(n.id, []); children.set(n.id, []); }
  for (const e of l.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    parents.get(e.target)!.push(e.source);
    children.get(e.source)!.push(e.target);
  }
  return { byId, parents, children };
}

/** Todos os nós alcançáveis a partir de `id` (sem incluí-lo): 'up' = de onde vem, 'down' = para onde vai. */
export function collect(index: LineageIndex, id: string, dir: 'up' | 'down'): Set<string> {
  const next = dir === 'up' ? index.parents : index.children;
  const seen = new Set<string>();
  const stack = [...(next.get(id) ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur) || cur === id) continue;
    seen.add(cur);
    for (const n of next.get(cur) ?? []) stack.push(n);
  }
  return seen;
}

export interface Focus {
  id: string;
  upstream: Set<string>;
  downstream: Set<string>;
  /** upstream + o próprio nó + downstream: o fluxo inteiro a mostrar. */
  ids: Set<string>;
}

export function focusOn(index: LineageIndex, id: string): Focus {
  const upstream = collect(index, id, 'up');
  const downstream = collect(index, id, 'down');
  return { id, upstream, downstream, ids: new Set([...upstream, id, ...downstream]) };
}

export const NODE_W = 232;
export const NODE_H = 92;
const COL_GAP = 78;
const ROW_GAP = 20;
const PAD_X = 28;
const HEADER_H = 34;
const PAD_Y = 16;

export interface GraphLayout {
  positions: Map<string, { x: number; y: number; rank: number }>;
  columns: Array<{ rank: number; x: number; label: string }>;
  width: number;
  height: number;
}

/**
 * Layout em colunas por "rank": a coluna de um nó é a camada dele (Origem, Raw, Bronze,
 * Silver, Gold) ou, se algum pai estiver à direita, uma coluna depois do pai — é o que faz
 * um Gold que depende de outro Gold cair numa coluna nova, em vez de ligar a mesma coluna.
 * Dentro de cada coluna a ordem vem do baricentro dos pais (menos cruzamento de setas).
 */
export function layoutGraph(index: LineageIndex, ids: Set<string>): GraphLayout {
  const rankMemo = new Map<string, number>();
  const visiting = new Set<string>();
  const rankOf = (id: string): number => {
    const known = rankMemo.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return layerIndex(index.byId.get(id)!.layer); // ciclo: não deveria existir em dbt
    visiting.add(id);
    let rank = layerIndex(index.byId.get(id)!.layer);
    for (const p of index.parents.get(id) ?? []) if (ids.has(p)) rank = Math.max(rank, rankOf(p) + 1);
    visiting.delete(id);
    rankMemo.set(id, rank);
    return rank;
  };

  const byRank = new Map<number, string[]>();
  for (const id of ids) {
    const r = rankOf(id);
    byRank.set(r, [...(byRank.get(r) ?? []), id]);
  }
  const ranks = [...byRank.keys()].sort((a, b) => a - b);
  const label = (a: string, b: string) => {
    const na = index.byId.get(a)!; const nb = index.byId.get(b)!;
    return (na.integrationName || '').localeCompare(nb.integrationName || '') || na.name.localeCompare(nb.name);
  };
  for (const r of ranks) byRank.get(r)!.sort(label);

  // Baricentro: 2 rodadas (pais -> filhos e filhos -> pais) reduzem os cruzamentos.
  const orderIndex = new Map<string, number>();
  const refreshIndex = () => { for (const r of ranks) byRank.get(r)!.forEach((id, i) => orderIndex.set(id, i)); };
  const bary = (id: string, rel: Map<string, string[]>) => {
    const vs = (rel.get(id) ?? []).filter((x) => ids.has(x)).map((x) => orderIndex.get(x)!).filter((x) => x !== undefined);
    return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
  };
  refreshIndex();
  for (let pass = 0; pass < 2; pass++) {
    for (const r of ranks) {
      const col = byRank.get(r)!;
      const keyed = col.map((id, i) => ({ id, key: bary(id, index.parents) ?? i }));
      keyed.sort((a, b) => a.key - b.key || label(a.id, b.id));
      byRank.set(r, keyed.map((k) => k.id));
      refreshIndex();
    }
    for (const r of [...ranks].reverse()) {
      const col = byRank.get(r)!;
      const keyed = col.map((id, i) => ({ id, key: bary(id, index.children) ?? i }));
      keyed.sort((a, b) => a.key - b.key || label(a.id, b.id));
      byRank.set(r, keyed.map((k) => k.id));
      refreshIndex();
    }
  }

  const colStep = NODE_W + COL_GAP;
  const maxCount = Math.max(1, ...ranks.map((r) => byRank.get(r)!.length));
  const innerH = maxCount * NODE_H + (maxCount - 1) * ROW_GAP;
  const positions = new Map<string, { x: number; y: number; rank: number }>();
  const columns: GraphLayout['columns'] = [];
  ranks.forEach((r, colIdx) => {
    const col = byRank.get(r)!;
    const colH = col.length * NODE_H + (col.length - 1) * ROW_GAP;
    const offset = (innerH - colH) / 2; // centraliza a coluna na altura do grafo
    const x = PAD_X + colIdx * colStep;
    col.forEach((id, i) => positions.set(id, { x, y: PAD_Y + HEADER_H + offset + i * (NODE_H + ROW_GAP), rank: r }));
    const layer = LAYERS[Math.min(r, LAYERS.length - 1)];
    const isGoldDependent = r >= LAYERS.length;
    columns.push({ rank: r, x, label: isGoldDependent ? 'Gold (depende de Gold)' : LAYER_LABEL[layer] });
  });
  return {
    positions,
    columns,
    width: PAD_X * 2 + ranks.length * colStep - COL_GAP,
    height: PAD_Y * 2 + HEADER_H + innerH,
  };
}

/** Nós de uma camada, ordenados para os comboboxes (por integração e nome). */
export function nodesOfLayer(l: Lineage, layer: LineageLayer): LineageNode[] {
  return l.nodes
    .filter((n) => n.layer === layer)
    .sort((a, b) => (a.integrationName || '').localeCompare(b.integrationName || '') || a.name.localeCompare(b.name));
}

/** Ordem topológica (dependências primeiro) dos nós de `ids` — usada para construir Gold em ordem. */
export function topoOrder(index: LineageIndex, ids: Set<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id) || !ids.has(id)) return;
    seen.add(id);
    for (const p of index.parents.get(id) ?? []) visit(p);
    out.push(id);
  };
  [...ids].sort().forEach(visit);
  return out;
}

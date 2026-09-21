import { getBigQueryClient } from '../bigqueryClient';
import { piiMacroFor } from '../dbtCodegen';
import { QUERYABLE_TABLE_PREFIXES, resolveRef, type TenantContext } from './catalog';

// -----------------------------------------------------------------------------
// Guarda-corpo das ferramentas de SQL do agente. Toda consulta que o modelo
// (ou um Gold salvo por ele) queira executar/validar passa por aqui, e a
// autorização NÃO depende de reconhecer texto: usa a lista de tabelas
// referenciadas que o próprio BigQuery devolve no DRY RUN. Só passa se:
//   - for um único SELECT (statementType === 'SELECT', nada de script/DML/DDL);
//   - todas as tabelas forem bronze_/silver_/gold_ dos datasets DA EMPRESA
//     (nunca Raw, nunca outro tenant);
//   - o custo estimado couber no teto de bytes.
// A checagem por texto (assertSafeText) só cobre o que o dry run não enxerga
// (INFORMATION_SCHEMA regional, EXTERNAL_QUERY, ML.*).
// -----------------------------------------------------------------------------

const LOCATION = () => process.env.DBT_GCP_LOCATION || 'southamerica-east1';
const MAX_BYTES = () => Number(process.env.AGENT_MAX_BYTES_BILLED) || 1_000_000_000; // 1 GB
const MAX_RESULT_CHARS = 30_000;

export interface SqlColumn { name: string; type: string }

/** Remove comentários e o CONTEÚDO de literais de texto (mantém aspas e
 *  identificadores com crase) — para varrer palavras-chave sem falso positivo. */
export function stripSqlNoise(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const next3 = sql.slice(i, i + 3);
    if (c === '-' && sql[i + 1] === '-') { while (i < sql.length && sql[i] !== '\n') i++; continue; }
    if (c === '#') { while (i < sql.length && sql[i] !== '\n') i++; continue; }
    if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += ' ';
      continue;
    }
    if (next3 === "'''" || next3 === '"""') {
      const end = sql.indexOf(next3, i + 3);
      out += `${next3}${next3}`;
      i = end === -1 ? sql.length : end + 3;
      continue;
    }
    if (c === "'" || c === '"') {
      out += c;
      i++;
      while (i < sql.length && sql[i] !== c) { if (sql[i] === '\\') i++; i++; }
      out += c;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export interface ResolvedSql {
  sql: string;
  unknownRefs: string[];
  /** Sobrou Jinja além de ref()/config() — não dá para compilar aqui. */
  unsupportedJinja: boolean;
}

/** Compila só o mínimo de Jinja do dbt: remove {{ config() }} e troca
 *  {{ ref('x') }} pela tabela real da empresa. */
export function resolveDbtJinja(tenant: TenantContext, raw: string): ResolvedSql {
  const unknownRefs: string[] = [];
  let sql = raw
    .replace(/\{#[\s\S]*?#\}/g, ' ')
    .replace(/\{\{\s*config\s*\([\s\S]*?\)\s*\}\}/g, ' ')
    .replace(/\{\{\s*ref\(\s*['"]([A-Za-z0-9_]+)['"]\s*\)\s*\}\}/g, (_m, name: string) => {
      const r = resolveRef(tenant, name);
      if (!r) {
        unknownRefs.push(name);
        return `\`${name}\``;
      }
      return `\`${r.projectId}.${r.dataset}.${r.table}\``;
    });
  sql = sql.trim();
  return { sql, unknownRefs, unsupportedJinja: /\{\{|\{%/.test(sql) };
}

export function assertSafeText(sql: string): void {
  const clean = stripSqlNoise(sql);
  if (/\binformation_schema\b/i.test(clean)) throw new Error('INFORMATION_SCHEMA não é permitido — use a ferramenta describe_table para ver o schema.');
  if (/\bexternal_query\b/i.test(clean)) throw new Error('EXTERNAL_QUERY não é permitido.');
  if (/\bml\s*\./i.test(clean)) throw new Error('Funções ML.* não são permitidas.');
  if (/@@/.test(clean)) throw new Error('Variáveis de sistema (@@) não são permitidas.');
}

interface DryRunResult {
  statementType: string;
  referencedTables: Array<{ projectId: string; datasetId: string; tableId: string }>;
  bytes: number;
  schema: SqlColumn[];
}

async function dryRun(sql: string): Promise<DryRunResult> {
  const [job] = await getBigQueryClient().createQueryJob({ query: sql, dryRun: true, location: LOCATION() });
  const stats = (job.metadata?.statistics?.query ?? {}) as {
    statementType?: string;
    referencedTables?: Array<{ projectId: string; datasetId: string; tableId: string }>;
    totalBytesProcessed?: string;
    schema?: { fields?: Array<{ name: string; type: string }> };
  };
  return {
    statementType: stats.statementType || '',
    referencedTables: stats.referencedTables ?? [],
    bytes: Number(stats.totalBytesProcessed || 0),
    schema: (stats.schema?.fields ?? []).map((f) => ({ name: f.name, type: f.type })),
  };
}

/** Falha se a consulta tocar qualquer coisa fora do escopo da empresa. */
function assertWithinTenant(tenant: TenantContext, dry: DryRunResult): void {
  if (dry.statementType !== 'SELECT') {
    throw new Error(`Só consultas SELECT são permitidas (o BigQuery classificou como "${dry.statementType || 'desconhecida'}").`);
  }
  for (const t of dry.referencedTables) {
    const fq = `${t.projectId}.${t.datasetId}.${t.tableId}`;
    if (t.projectId !== tenant.projectId || !tenant.allowedDatasets.has(t.datasetId)) {
      throw new Error(`Acesso negado a ${fq}: fora dos datasets da sua empresa (${[...tenant.allowedDatasets].join(', ')}).`);
    }
    if (!QUERYABLE_TABLE_PREFIXES.some((p) => t.tableId.startsWith(p))) {
      throw new Error(`Acesso negado a ${fq}: só tabelas bronze_/silver_/gold_ podem ser consultadas (a Raw não).`);
    }
  }
}

function refErrors(r: ResolvedSql, tenant: TenantContext): string[] {
  const errors: string[] = [];
  if (r.unknownRefs.length > 0) {
    errors.push(`ref() para modelo(s) inexistente(s) no catálogo da empresa: ${[...new Set(r.unknownRefs)].join(', ')}. Use list_catalog para ver os nomes válidos (${tenant.models.size} modelos).`);
  }
  return errors;
}

export interface ValidationResult {
  /** true = válido; false = erro; null = não foi possível validar (Jinja além de ref/config). */
  ok: boolean | null;
  errors: string[];
  warnings: string[];
  outputColumns: SqlColumn[];
  referencedTables: string[];
  bytesEstimate: number | null;
  note?: string;
}

/** Valida SQL de modelo dbt (aceita ref()/config()): tabelas e colunas existem? tipos? escopo? */
export async function validateSql(tenant: TenantContext, raw: string): Promise<ValidationResult> {
  const base: ValidationResult = { ok: false, errors: [], warnings: [], outputColumns: [], referencedTables: [], bytesEstimate: null };
  const resolved = resolveDbtJinja(tenant, raw);
  base.errors.push(...refErrors(resolved, tenant));
  if (base.errors.length > 0) return base;

  if (resolved.unsupportedJinja) {
    return { ...base, ok: null, note: 'O SQL usa Jinja além de ref()/config() (macros, var(), is_incremental()...) — não é possível validar contra o BigQuery aqui; revise manualmente ou rode `dbt compile`.' };
  }

  try {
    assertSafeText(resolved.sql);
    const dry = await dryRun(resolved.sql);
    assertWithinTenant(tenant, dry);
    return {
      ...base,
      ok: true,
      outputColumns: dry.schema,
      referencedTables: dry.referencedTables.map((t) => `${t.datasetId}.${t.tableId}`),
      bytesEstimate: dry.bytes,
    };
  } catch (err) {
    return { ...base, errors: [err instanceof Error ? err.message : String(err)] };
  }
}

function serializeCell(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return `[binário ${v.length} bytes]`;
  if (Array.isArray(v)) return v.map(serializeCell);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    // BigQueryDate/Datetime/Timestamp/Time/Geography embrulham o valor em { value }.
    if ('value' in o && Object.keys(o).length === 1) return serializeCell(o.value);
    // NUMERIC/BIGNUMERIC chegam como Big.js.
    if (typeof (o as { toFixed?: unknown }).toFixed === 'function') return String(v);
    return Object.fromEntries(Object.entries(o).map(([k, val]) => [k, serializeCell(val)]));
  }
  return v;
}

export interface QueryResult {
  columns: SqlColumn[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
  bytesProcessed: number;
  omittedPiiColumns: string[];
}

export async function runSelect(tenant: TenantContext, raw: string, maxRows: number): Promise<QueryResult> {
  const resolved = resolveDbtJinja(tenant, raw);
  const errors = refErrors(resolved, tenant);
  if (errors.length > 0) throw new Error(errors.join(' '));
  if (resolved.unsupportedJinja) throw new Error('Use SQL puro do BigQuery (só {{ ref(\'modelo\') }} é aceito como Jinja).');
  assertSafeText(resolved.sql);

  const dry = await dryRun(resolved.sql);
  assertWithinTenant(tenant, dry);
  const cap = MAX_BYTES();
  if (dry.bytes > cap) {
    throw new Error(`A consulta processaria ~${(dry.bytes / 1e9).toFixed(2)} GB, acima do teto de ${(cap / 1e9).toFixed(2)} GB. Filtre por período/colunas, agregue ou use uma tabela Silver/Gold menor.`);
  }

  const bq = getBigQueryClient();
  const [job] = await bq.createQueryJob({
    query: resolved.sql,
    location: LOCATION(),
    maximumBytesBilled: String(cap),
    jobTimeoutMs: 60_000,
    labels: { app: 'datacore-agent', empresa: String(tenant.idEmpresa) },
  });
  const [rawRows] = await job.getQueryResults({ maxResults: maxRows + 1 });
  const truncated = rawRows.length > maxRows;

  // LGPD (defesa em profundidade): a Bronze/Silver já mascaram dado pessoal, mas
  // se uma integração rodou sem sanitização — ou uma coluna foge da heurística de
  // máscara — nunca devolvemos ao modelo valores de colunas com nome de dado pessoal.
  const omitted = new Set<string>();
  const rows = rawRows.slice(0, maxRows).map((row: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (piiMacroFor(k)) { omitted.add(k); out[k] = '[omitido: dado pessoal]'; }
      else out[k] = serializeCell(v);
    }
    return out;
  });

  return {
    columns: dry.schema,
    rows,
    rowCount: rows.length,
    truncated,
    bytesProcessed: dry.bytes,
    omittedPiiColumns: [...omitted],
  };
}

/** Limita o tamanho do JSON devolvido ao modelo (protege o contexto). */
export function capJson(value: unknown): string {
  const text = JSON.stringify(value);
  if (text.length <= MAX_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_RESULT_CHARS)}… [resultado truncado em ${MAX_RESULT_CHARS} caracteres — refine a consulta (menos colunas/linhas, agregue)]`;
}

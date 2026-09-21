import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMap, isSeq, parse as parseYaml, parseDocument } from 'yaml';
import { gitCommit, retrySync, sanitizeIdent, type WriteModelsResult } from '../dbtCodegen';
import { goldDir, goldNamePrefix, type TenantContext } from './catalog';
import { stripSqlNoise, validateSql, type ValidationResult } from './sql';
import type { DataCoreUser } from '../userSession';

// -----------------------------------------------------------------------------
// Salvar um modelo Gold proposto pelo agente. É SEMPRE uma ação do usuário
// (botão + confirmação na tela) — o modelo de IA não tem ferramenta de escrita.
// Como o resultado vira código que o dbt executará com a service account do
// gateway (que enxerga todos os datasets), este módulo é a fronteira de
// governança: nome com prefixo da empresa, só ref() de modelos da empresa, sem
// Raw/source(), sem DDL/DML, SQL restrito ao escopo da empresa (dry run) e YAML
// reduzido a chaves e testes permitidos.
// -----------------------------------------------------------------------------

export class GoldSaveError extends Error {
  constructor(message: string, readonly status: number, readonly details?: unknown) {
    super(message);
  }
}

const MAX_SQL = 100_000;
const FORBIDDEN_KEYWORDS = /\b(insert|update|delete|merge|drop|alter|truncate|create|grant|revoke|call|declare|execute|export|load)\b/i;

const ALLOWED_TESTS = new Set([
  'not_null',
  'unique',
  'accepted_values',
  'relationships',
  'dbt_utils.unique_combination_of_columns',
  'dbt_utils.accepted_range',
  'dbt_utils.expression_is_true',
]);
// Argumentos de teste viram SQL no `dbt test`: nada de subconsultas nem DDL/DML.
const FORBIDDEN_IN_TEST_ARGS = /\b(select|from|join|insert|update|delete|merge|drop|alter|create|truncate)\b/i;

/** Nome final do modelo: minúsculo, identificador válido e com o prefixo Gold da empresa. */
export function normalizeGoldName(tenant: TenantContext, raw: string): string {
  const prefix = goldNamePrefix(tenant);
  let name = sanitizeIdent(String(raw || '').trim().toLowerCase());
  if (!name.startsWith(prefix)) name = `${prefix}${name.replace(/^gold_/, '')}`;
  if (name === prefix || name.length > 100) throw new GoldSaveError(`Nome de modelo inválido (use "${prefix}<assunto>", até 100 caracteres).`, 400);
  return name;
}

function checkSql(tenant: TenantContext, sql: string): void {
  if (!sql.trim()) throw new GoldSaveError('SQL vazio.', 400);
  if (sql.length > MAX_SQL) throw new GoldSaveError(`SQL excede ${MAX_SQL} caracteres.`, 400);
  if (/\{\{\s*source\s*\(/.test(sql)) {
    throw new GoldSaveError('Modelos Gold não podem ler a Raw via source() (LGPD) — use ref() de modelos Bronze/Silver/Gold da empresa.', 422);
  }

  const bareJinja = sql.replace(/\{#[\s\S]*?#\}/g, ' ').replace(/\{\{[\s\S]*?\}\}/g, ' ').replace(/\{%[\s\S]*?%\}/g, ' ');
  const clean = stripSqlNoise(bareJinja).trim().toLowerCase();
  if (!/^(select|with|\()/.test(clean)) throw new GoldSaveError('O modelo deve ser uma consulta SELECT/WITH.', 422);
  const forbidden = clean.match(FORBIDDEN_KEYWORDS);
  if (forbidden) throw new GoldSaveError(`Palavra-chave não permitida em modelo Gold: ${forbidden[1].toUpperCase()} (só SELECT).`, 422);

  const refs = [...sql.matchAll(/\{\{\s*ref\(\s*['"]([A-Za-z0-9_]+)['"]\s*\)\s*\}\}/g)].map((m) => m[1]);
  const unknown = [...new Set(refs.filter((r) => !tenant.models.has(r)))];
  if (unknown.length > 0) throw new GoldSaveError(`ref() para modelo(s) fora do catálogo da empresa: ${unknown.join(', ')}.`, 422);

  // Tabelas fixas entre crases (`projeto.dataset.tabela`) só nos datasets da empresa.
  for (const m of sql.matchAll(/`([\w-]+)\.([\w-]+)\.([\w-]+)`/g)) {
    if (m[1] !== tenant.projectId || !tenant.allowedDatasets.has(m[2])) {
      throw new GoldSaveError(`Referência a ${m[0]} fora dos datasets da empresa.`, 422);
    }
  }
}

function sanitizeTests(tenant: TenantContext, tests: unknown, where: string): unknown[] {
  if (tests === undefined || tests === null) return [];
  if (!Array.isArray(tests)) throw new GoldSaveError(`${where}: data_tests deve ser uma lista.`, 422);
  return tests.map((t) => {
    if (typeof t === 'string') {
      if (!ALLOWED_TESTS.has(t)) throw new GoldSaveError(`${where}: teste "${t}" não permitido (permitidos: ${[...ALLOWED_TESTS].join(', ')}).`, 422);
      return t;
    }
    if (t && typeof t === 'object' && !Array.isArray(t) && Object.keys(t).length === 1) {
      const [testName, args] = Object.entries(t as Record<string, unknown>)[0];
      if (!ALLOWED_TESTS.has(testName)) throw new GoldSaveError(`${where}: teste "${testName}" não permitido (permitidos: ${[...ALLOWED_TESTS].join(', ')}).`, 422);
      if (args !== null && (typeof args !== 'object' || Array.isArray(args))) throw new GoldSaveError(`${where}: argumentos do teste "${testName}" inválidos.`, 422);
      const argText = JSON.stringify(args ?? {});
      if ('config' in ((args as Record<string, unknown>) ?? {})) throw new GoldSaveError(`${where}: "config" não é permitido em testes.`, 422);
      // relationships aponta para OUTRO modelo (to: ref('x')) — ele precisa ser da empresa.
      if (testName === 'relationships') {
        const to = JSON.stringify((args as Record<string, unknown>)?.to ?? (args as { arguments?: { to?: unknown } })?.arguments?.to ?? '');
        const target = to.match(/ref\(\s*\\?['"]([A-Za-z0-9_]+)\\?['"]\s*\)/)?.[1];
        if (!target || !tenant.models.has(target)) throw new GoldSaveError(`${where}: relationships.to deve ser ref('modelo') do catálogo da empresa.`, 422);
      } else if (FORBIDDEN_IN_TEST_ARGS.test(argText)) {
        throw new GoldSaveError(`${where}: argumentos de teste não podem conter subconsultas ou DDL/DML.`, 422);
      }
      return t;
    }
    throw new GoldSaveError(`${where}: formato de teste inválido.`, 422);
  });
}

/** Reduz o YAML proposto a UM modelo com só name/description/columns/data_tests. */
function sanitizeModelEntry(tenant: TenantContext, yamlText: string, finalName: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch (err) {
    throw new GoldSaveError(`YAML inválido: ${err instanceof Error ? err.message : String(err)}`, 422);
  }
  const models = (parsed as { models?: unknown } | null)?.models;
  if (!Array.isArray(models) || models.length === 0) throw new GoldSaveError('YAML deve ter "models:" com o modelo proposto.', 422);
  const source = models[0] as Record<string, unknown>;
  if (!source || typeof source !== 'object') throw new GoldSaveError('YAML: entrada de modelo inválida.', 422);

  const entry: Record<string, unknown> = { name: finalName };
  if (typeof source.description === 'string') entry.description = source.description;

  const modelTests = sanitizeTests(tenant, source.data_tests ?? source.tests, `modelo ${finalName}`);
  if (modelTests.length) entry.data_tests = modelTests;

  if (Array.isArray(source.columns)) {
    entry.columns = (source.columns as Array<Record<string, unknown>>).map((c) => {
      if (!c || typeof c !== 'object' || typeof c.name !== 'string') throw new GoldSaveError('YAML: coluna sem "name".', 422);
      const col: Record<string, unknown> = { name: c.name };
      if (typeof c.description === 'string') col.description = c.description;
      const tests = sanitizeTests(tenant, c.data_tests ?? c.tests, `coluna ${c.name}`);
      if (tests.length) col.data_tests = tests;
      return col;
    });
  }
  return entry;
}

function upsertProperties(path: string, entry: Record<string, unknown>): void {
  const doc = existsSync(path) ? parseDocument(readFileSync(path, 'utf8')) : parseDocument('version: 2\nmodels: []\n');
  let models = doc.get('models', true);
  if (!isSeq(models)) {
    doc.set('models', doc.createNode([]));
    models = doc.get('models', true);
  }
  if (!isSeq(models)) throw new GoldSaveError('_properties.yml existente está num formato inesperado.', 500);
  models.flow = false; // `models: []` (flow) faria todo o arquivo sair como [ {name: ...} ]
  models.items = models.items.filter((it) => !(isMap(it) && it.get('name') === entry.name));
  models.add(doc.createNode(entry));
  retrySync(() => writeFileSync(path, doc.toString(), 'utf8'));
}

export interface SaveGoldInput { name: string; sql: string; yaml?: string; overwrite?: boolean; acceptInvalid?: boolean }

export interface SaveGoldResult {
  name: string;
  files: string[];
  overwritten: boolean;
  validation: ValidationResult;
  git: WriteModelsResult['git'];
  gitDetail?: string;
}

/** Só a checagem (sem gravar): usada pelo modal de confirmação da tela. */
export async function previewGold(tenant: TenantContext, input: Pick<SaveGoldInput, 'name' | 'sql' | 'yaml'>) {
  const name = normalizeGoldName(tenant, input.name);
  checkSql(tenant, input.sql);
  if (input.yaml) sanitizeModelEntry(tenant, input.yaml, name);
  const validation = await validateSql(tenant, input.sql);
  const dir = goldDir(tenant);
  return { name, exists: existsSync(join(dir, `${name}.sql`)), validation };
}

export async function saveGoldModel(tenant: TenantContext, user: DataCoreUser, input: SaveGoldInput): Promise<SaveGoldResult> {
  const name = normalizeGoldName(tenant, input.name);
  checkSql(tenant, input.sql);
  const entry = input.yaml ? sanitizeModelEntry(tenant, input.yaml, name) : null;

  const validation = await validateSql(tenant, input.sql);
  // Acesso fora do escopo da empresa nunca é liberável; já erro de coluna/tabela
  // (ex.: depende de outro Gold ainda não construído) o usuário pode aceitar.
  if (validation.errors.some((e) => e.startsWith('Acesso negado'))) throw new GoldSaveError(validation.errors.join(' '), 403, validation);
  if (validation.ok === false && !input.acceptInvalid) {
    throw new GoldSaveError('O SQL não passou na validação do BigQuery.', 422, validation);
  }

  const dir = goldDir(tenant);
  const sqlPath = join(dir, `${name}.sql`);
  const overwritten = existsSync(sqlPath);
  if (overwritten && !input.overwrite) throw new GoldSaveError(`O modelo ${name} já existe.`, 409, { exists: true });

  retrySync(() => mkdirSync(dir, { recursive: true }));
  const header = [
    '-- Modelo Gold proposto pelo agente "Converse com os dados" (DataCore) e revisado/salvo por uma pessoa.',
    `-- Empresa: ${tenant.empresaNome} | Salvo por: ${user.nome} | Em: ${new Date().toISOString()}`,
    '',
  ].join('\n');
  retrySync(() => writeFileSync(sqlPath, `${header}${input.sql.trim()}\n`, 'utf8'));
  const files = [`${tenant.empresaSlug}/${name}.sql`];

  if (entry) {
    upsertProperties(join(dir, '_properties.yml'), entry);
    files.push(`${tenant.empresaSlug}/_properties.yml`);
  }

  const mode = (process.env.DBT_CODEGEN_GIT || 'off').toLowerCase();
  let git: Pick<WriteModelsResult, 'git' | 'gitDetail'> = { git: 'skipped' };
  if (mode === 'commit' || mode === 'push') {
    git = await gitCommit(dir, `dbt: modelo Gold ${name} (Converse com os dados)`, mode === 'push');
  }

  return { name, files, overwritten, validation, ...git };
}

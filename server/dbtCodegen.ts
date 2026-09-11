import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { resolveDbtProjectDir } from './dbtRunner';

const execFileP = promisify(execFile);

// -----------------------------------------------------------------------------
// Codegen dos modelos dbt da camada Bronze, organizados por CAMADA e por SISTEMA
// DE ORIGEM:
//   dbt/models/medallion/bronze/<sistema>/bronze_<sistema>_<tabela>.sql
//   dbt/models/medallion/bronze/<sistema>/_properties.yml   (todos os modelos do sistema)
//   dbt/models/sources/_datacore_raw__sources.yml           (source compartilhada)
// A regeração SOBRESCREVE os arquivos daquele sistema. O nome do modelo carrega o
// sistema (namespace global do dbt) e o alias => tabela bronze_<sistema>_<tabela>.
// A source resolve o dataset via env_var(DBT_RAW_DATASET) e o schema de saída via
// DBT_SCHEMA_BRONZE — ambos setados pelo gateway por requisição.
// -----------------------------------------------------------------------------

export interface IntegrationTableSpec {
  /** Nome do stream / base da tabela raw (a tabela real é raw_<name>). */
  name: string;
  /** Colunas selecionadas. Vazio => passthrough `select *` sem LGPD. */
  columns?: string[];
  /** Chave primária (do stream Airbyte). Habilita dedup CDC + unique_key. */
  primaryKey?: string[];
  cursorField?: string | null;
  loadType?: 'full_refresh' | 'incremental';
}

export interface IntegrationModelsSpec {
  /** Nome do sistema de origem (do cadastro da integração). Define a subpasta e
   *  o prefixo do nome do modelo/tabela Bronze. */
  sistema: string;
  projectId?: string;
  rawDataset?: string;
  bronzeDataset?: string;
  applyLgpd?: boolean;
  tables: IntegrationTableSpec[];
}

export interface WriteModelsResult {
  dir: string;
  sistema: string;
  files: string[];
  models: string[];
  sources: string[];
  git: 'skipped' | 'committed' | 'pushed' | 'failed';
  gitDetail?: string;
}

const SOURCE_NAME = 'datacore_raw';
const SOURCES_FILE = '_datacore_raw__sources.yml';
const SOURCES_MANIFEST_FILE = '_generated_sources.json';
const PROPERTIES_FILE = '_properties.yml';
const BRONZE_MANIFEST_FILE = '_generated_bronze.json';

// Windows + OneDrive às vezes seguram um handle e devolvem EPERM/EBUSY momentâneo.
function retrySync<T>(fn: () => T, tries = 5, delayMs = 120): T {
  for (let i = 0; ; i++) {
    try {
      return fn();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (i >= tries - 1 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'ENOTEMPTY')) throw err;
      const until = Date.now() + delayMs * (i + 1);
      while (Date.now() < until) { /* espera curta */ }
    }
  }
}

/** dbt exige nomes de nó no formato [A-Za-z_][A-Za-z0-9_]*. */
export function sanitizeIdent(raw: string): string {
  const s = raw.replace(/[^A-Za-z0-9_]/g, '_');
  return /^[A-Za-z_]/.test(s) ? s : `t_${s}`;
}

/** Slug do nome do sistema — vira o nome da subpasta e o prefixo do modelo. */
export function sistemaSlug(sistema: string): string {
  const s = (sistema || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s || 'sistema';
}

/** Nome do modelo Bronze: bronze_<sistema>_<tabela>. */
export function bronzeModelName(sistema: string, table: string): string {
  return `bronze_${sistemaSlug(sistema)}_${sanitizeIdent(table)}`;
}

type PiiMacro = 'mascarar_cpf' | 'tokenizar_email' | 'hash_sha256';

function piiMacroFor(column: string): PiiMacro | null {
  const c = column.toLowerCase();
  if (/(^|_)(cpf|cnpj|documento|doc|num_doc)(_|$)/.test(c)) return 'mascarar_cpf';
  if (/(e_?mail)/.test(c)) return 'tokenizar_email';
  if (/(cartao|card|pan|num(ero)?_cartao|nr_cartao)/.test(c)) return 'hash_sha256';
  if (/(telefone|phone|celular|fone|msisdn|whatsapp)/.test(c)) return 'hash_sha256';
  if (/(^|_)(rg|passaporte|passport|ssn|cnh)(_|$)/.test(c)) return 'hash_sha256';
  if (/(^|_)senha(_|$)|password|secret/.test(c)) return 'hash_sha256';
  return null;
}

// --- manifestos (json fora de model-paths) -----------------------------------

function readJsonManifest<T>(projectDir: string, file: string): T {
  const p = join(projectDir, file);
  if (!existsSync(p)) return {} as T;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as T;
  } catch {
    return {} as T;
  }
}

// --- source compartilhada ---------------------------------------------------

type SourcesManifest = Record<string, { identifier: string }>;

function renderSourcesYml(manifest: SourcesManifest): string {
  const tables = Object.keys(manifest)
    .sort()
    .map(
      (name) => `      - name: ${name}
        identifier: ${manifest[name].identifier}
        config:
          loaded_at_field: _airbyte_extracted_at`,
    )
    .join('\n');
  return `version: 2

# GERADO por server/dbtCodegen.ts a partir de dbt/${SOURCES_MANIFEST_FILE}.
# Não editar à mão. database/schema resolvem via env var (o gateway seta
# DBT_GCP_PROJECT / DBT_RAW_DATASET por requisição); os defaults só existem para
# o \`dbt parse\`/\`dbt docs\` local.
sources:
  - name: ${SOURCE_NAME}
    database: "{{ env_var('DBT_GCP_PROJECT', 'data-plataform-dev') }}"
    schema: "{{ env_var('DBT_RAW_DATASET', 'raw') }}"
    loader: airbyte
    tables:
${tables}
`;
}

// --- modelo Bronze ---------------------------------------------------------

function renderBronzeSql(spec: IntegrationModelsSpec, t: IntegrationTableSpec): string {
  const sys = sistemaSlug(spec.sistema);
  const srcName = sanitizeIdent(t.name);
  const modelAlias = `bronze_${sys}_${srcName}`;
  const pk = (t.primaryKey || []).map((k) => k.split('.').pop() as string).filter(Boolean);
  const incremental = t.loadType === 'incremental' && pk.length > 0;
  const cols = t.columns && t.columns.length > 0;

  const cfg: string[] = [
    `    materialized = '${incremental ? 'incremental' : 'table'}'`,
    `    , alias = '${modelAlias}'`,
  ];
  if (incremental) {
    cfg.push(
      pk.length === 1
        ? `    , unique_key = '${pk[0]}'`
        : `    , unique_key = [${pk.map((k) => `'${k}'`).join(', ')}]`,
    );
    cfg.push(`    , incremental_strategy = 'merge'`);
  }

  let projection: string;
  if (cols) {
    projection = t
      .columns!.map((c) => {
        const macro = spec.applyLgpd ? piiMacroFor(c) : null;
        return macro ? `        {{ ${macro}('${c}') }} as ${c},` : `        ${c},`;
      })
      .join('\n');
  } else {
    projection = '        *,';
  }

  const incrementalFilter = incremental
    ? `
    {% if is_incremental() %}
    where _airbyte_extracted_at > (select max(dt_ingestao_lake) from {{ this }})
    {% endif %}`
    : '';

  const dedup =
    pk.length > 0
      ? `
, deduplicado as (
    select *
    from tipado
    qualify row_number() over (
        partition by ${pk.join(', ')}
        order by dt_ingestao_lake desc
    ) = 1
)

select * from deduplicado
`
      : `
select * from tipado
`;

  return `{{ config(
${cfg.join('\n')}
) }}

-- GERADO por server/dbtCodegen.ts — sistema "${spec.sistema}", camada Bronze, tabela ${t.name}.
-- A regeração sobrescreve este arquivo.
-- Origem: source('${SOURCE_NAME}', '${srcName}')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.${modelAlias}  (renome + LGPD Art. 46 + dedup CDC)

with fonte as (
    select * from {{ source('${SOURCE_NAME}', '${srcName}') }}${incrementalFilter}
),

tipado as (
    select
${projection}
        cast(_airbyte_extracted_at as timestamp) as dt_ingestao_lake,
        current_timestamp() as _dbt_loaded_at
    from fonte
)
${dedup}`;
}

// --- _properties.yml por sistema ------------------------------------------------

/** Manifesto aninhado: sistema -> modelo -> { tabela raw, PK }. Acumula por sistema. */
type BronzeManifest = Record<string, Record<string, { table: string; pk: string[] }>>;

function bronzeModelBlock(name: string, table: string, pk: string[]): string {
  if (pk.length === 1) {
    return `  - name: ${name}
    description: "Bronze gerado — tabela ${table}."
    columns:
      - name: ${pk[0]}
        data_tests: [unique, not_null]`;
  }
  if (pk.length > 1) {
    return `  - name: ${name}
    description: "Bronze gerado — tabela ${table}."
    data_tests:
      - dbt_utils.unique_combination_of_columns:
          combination_of_columns:
${pk.map((k) => `            - ${k}`).join('\n')}
    columns:
${pk.map((k) => `      - name: ${k}\n        data_tests: [not_null]`).join('\n')}`;
  }
  return `  - name: ${name}
    description: "Bronze gerado — tabela ${table} (sem PK; sem deduplicação)."`;
}

function renderSistemaPropertiesYml(sistema: string, sys: string, models: Record<string, { table: string; pk: string[] }>): string {
  const blocks = Object.keys(models)
    .sort()
    .map((name) => bronzeModelBlock(name, models[name].table, models[name].pk))
    .join('\n');
  return `version: 2

# _properties.yml — sistema "${sistema}" (${sys}), camada Bronze.
# TODOS os modelos deste sistema. GERADO por server/dbtCodegen.ts a partir de
# dbt/${BRONZE_MANIFEST_FILE} — não editar à mão.
models:
${blocks}
`;
}

// --- escrita ---------------------------------------------------------------

function validateSpec(spec: IntegrationModelsSpec): string | null {
  if (!spec || typeof spec !== 'object') return 'corpo inválido';
  if (!spec.sistema || !String(spec.sistema).trim()) return 'campo "sistema" (nome do sistema de origem) obrigatório';
  if (!Array.isArray(spec.tables) || spec.tables.length === 0) return 'tables (não vazio) obrigatório';
  for (const t of spec.tables) {
    if (!t.name || !/^[A-Za-z0-9_.\-]+$/.test(t.name)) return `nome de tabela inválido: ${t?.name}`;
  }
  return null;
}

async function gitCommit(repoHintDir: string, message: string, push: boolean): Promise<Pick<WriteModelsResult, 'git' | 'gitDetail'>> {
  try {
    const { stdout: top } = await execFileP('git', ['-C', repoHintDir, 'rev-parse', '--show-toplevel']);
    const repo = top.trim();
    const name = process.env.GIT_AUTHOR_NAME || 'DataCore Gateway';
    const email = process.env.GIT_AUTHOR_EMAIL || 'gateway@datacore.local';
    await execFileP('git', ['-C', repo, 'add', '--', 'dbt']);
    const { stdout: staged } = await execFileP('git', ['-C', repo, 'diff', '--cached', '--name-only']);
    if (!staged.trim()) return { git: 'committed', gitDetail: 'nada a commitar' };
    await execFileP('git', ['-C', repo, '-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-m', message]);
    if (push) {
      await execFileP('git', ['-C', repo, 'push']);
      return { git: 'pushed' };
    }
    return { git: 'committed' };
  } catch (err) {
    return { git: 'failed', gitDetail: err instanceof Error ? err.message : String(err) };
  }
}

/** Escreve (sobrescrevendo) os modelos Bronze do sistema do spec + a source. */
export async function writeIntegrationModels(spec: IntegrationModelsSpec): Promise<WriteModelsResult> {
  const err = validateSpec(spec);
  if (err) throw new Error(err);

  const sys = sistemaSlug(spec.sistema);
  const projectDir = resolveDbtProjectDir();
  const sysDir = join(projectDir, 'models', 'medallion', 'bronze', sys);
  const sourcesDir = join(projectDir, 'models', 'sources');
  retrySync(() => mkdirSync(sysDir, { recursive: true }));
  retrySync(() => mkdirSync(sourcesDir, { recursive: true }));

  // 1) source compartilhada: acumula as tabelas e re-renderiza o yml
  const sourcesManifest = readJsonManifest<SourcesManifest>(projectDir, SOURCES_MANIFEST_FILE);
  for (const t of spec.tables) {
    sourcesManifest[sanitizeIdent(t.name)] = { identifier: `raw_${t.name}` };
  }
  retrySync(() => writeFileSync(join(projectDir, SOURCES_MANIFEST_FILE), JSON.stringify(sourcesManifest, null, 2) + '\n', 'utf8'));
  retrySync(() => writeFileSync(join(sourcesDir, SOURCES_FILE), renderSourcesYml(sourcesManifest), 'utf8'));

  // 2) um modelo por tabela em models/medallion/bronze/<sistema>/ — sobrescreve
  const files: string[] = [SOURCES_FILE, `${sys}/${PROPERTIES_FILE}`];
  const models: string[] = [];
  for (const t of spec.tables) {
    const base = bronzeModelName(spec.sistema, t.name);
    retrySync(() => writeFileSync(join(sysDir, `${base}.sql`), renderBronzeSql(spec, t), 'utf8'));
    files.push(`${sys}/${base}.sql`);
    models.push(base);
  }

  // 3) _properties.yml do sistema: acumula {modelo -> tabela, PK} e re-renderiza
  const bronzeManifest = readJsonManifest<BronzeManifest>(projectDir, BRONZE_MANIFEST_FILE);
  const sysModels = bronzeManifest[sys] || {};
  for (const t of spec.tables) {
    const pk = (t.primaryKey || []).map((k) => k.split('.').pop() as string).filter(Boolean);
    sysModels[bronzeModelName(spec.sistema, t.name)] = { table: t.name, pk };
  }
  bronzeManifest[sys] = sysModels;
  retrySync(() => writeFileSync(join(projectDir, BRONZE_MANIFEST_FILE), JSON.stringify(bronzeManifest, null, 2) + '\n', 'utf8'));
  retrySync(() => writeFileSync(join(sysDir, PROPERTIES_FILE), renderSistemaPropertiesYml(spec.sistema, sys, sysModels), 'utf8'));

  const mode = (process.env.DBT_CODEGEN_GIT || 'off').toLowerCase();
  let git: Pick<WriteModelsResult, 'git' | 'gitDetail'> = { git: 'skipped' };
  if (mode === 'commit' || mode === 'push') {
    git = await gitCommit(sysDir, `dbt: modelos Bronze do sistema ${sys} (${models.length})`, mode === 'push');
  }

  return { dir: sysDir, sistema: sys, files, models, sources: Object.keys(sourcesManifest), ...git };
}

/** Lista os modelos Bronze gerados (bronze_*.sql em models/medallion/bronze/<sistema>/). */
export function listGeneratedModels(): string[] {
  const base = join(resolveDbtProjectDir(), 'models', 'medallion', 'bronze');
  if (!existsSync(base)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const f of readdirSync(join(base, entry.name))) {
      if (f.startsWith('bronze_') && f.endsWith('.sql')) out.push(f.replace(/\.sql$/, ''));
    }
  }
  return out.sort();
}

/** Localiza o .sql de um modelo Bronze gerado por nome, em qualquer subpasta de sistema. */
function findGeneratedModelPath(name: string): string | null {
  // Mesmo charset de sanitizeIdent/sistemaSlug — barra path traversal.
  if (!/^[A-Za-z0-9_]+$/.test(name)) return null;
  const base = join(resolveDbtProjectDir(), 'models', 'medallion', 'bronze');
  if (!existsSync(base)) return null;
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = join(base, entry.name, `${name}.sql`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Lê o .sql de um modelo Bronze gerado (o mesmo arquivo que o `dbt build` executa). */
export function readGeneratedModelSql(name: string): string {
  const path = findGeneratedModelPath(name);
  if (!path) throw new Error(`Modelo dbt "${name}" não encontrado em models/medallion/bronze/.`);
  return readFileSync(path, 'utf8');
}

/**
 * Sobrescreve o .sql de um modelo Bronze já gerado (edição manual no Studio).
 * Só edita arquivos existentes — um modelo inexistente precisa ser gerado antes
 * (POST /api/dbt/models). A próxima regeração da integração (writeIntegrationModels)
 * sobrescreve esta edição manual, como qualquer outro arquivo gerado.
 */
export function writeGeneratedModelSql(name: string, sql: string): void {
  const path = findGeneratedModelPath(name);
  if (!path) throw new Error(`Modelo dbt "${name}" não encontrado — gere o modelo da integração antes de editá-lo.`);
  retrySync(() => writeFileSync(path, sql, 'utf8'));
}

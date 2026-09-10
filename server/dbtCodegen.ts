import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { resolveDbtProjectDir } from './dbtRunner';

const execFileP = promisify(execFile);

// -----------------------------------------------------------------------------
// Codegen dos modelos dbt da camada Bronze — organizados POR CAMADA:
//   dbt/models/medallion/bronze/bronze_<tabela>.sql   (+ .yml de testes)
//   dbt/models/sources/_datacore_raw__sources.yml     (uma source, tabelas acumuladas)
// Um arquivo por tabela; a regeração SOBRESCREVE o arquivo existente.
// A source aponta o dataset via env_var (DBT_RAW_DATASET), e o schema de saída
// vem de DBT_SCHEMA_BRONZE — ambos setados pelo gateway por requisição. Assim o
// mesmo bronze_<tabela>.sql serve qualquer integração cuja raw tenha essa tabela.
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
  /** Só usado como dica; a source resolve o dataset via DBT_RAW_DATASET. */
  projectId?: string;
  rawDataset?: string;
  bronzeDataset?: string;
  applyLgpd?: boolean;
  tables: IntegrationTableSpec[];
}

export interface WriteModelsResult {
  dir: string;
  files: string[];
  models: string[];
  sources: string[];
  git: 'skipped' | 'committed' | 'pushed' | 'failed';
  gitDetail?: string;
}

const SOURCE_NAME = 'datacore_raw';
const SOURCES_FILE = '_datacore_raw__sources.yml';
const SOURCES_MANIFEST_FILE = '_generated_sources.json';
// Um arquivo de propriedades por camada, com todos os modelos da camada.
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

/** Nome do modelo Bronze de uma tabela: bronze_<tabela sanitizada>. */
export function bronzeModelName(table: string): string {
  return `bronze_${sanitizeIdent(table)}`;
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

// --- manifestos (json fora de model-paths) -------------------------------------

function readJsonManifest<T>(projectDir: string, file: string): T {
  const p = join(projectDir, file);
  if (!existsSync(p)) return {} as T;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as T;
  } catch {
    return {} as T;
  }
}

// --- sources ---------------------------------------------------------------

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
# Não editar à mão — a lista de tabelas cresce conforme integrações são criadas.
# database/schema resolvem via env var (o gateway seta DBT_GCP_PROJECT / DBT_RAW_DATASET
# por requisição); os defaults só existem para o \`dbt parse\`/\`dbt docs\` local.
sources:
  - name: ${SOURCE_NAME}
    database: "{{ env_var('DBT_GCP_PROJECT', 'data-plataform-dev') }}"
    schema: "{{ env_var('DBT_RAW_DATASET', 'raw') }}"
    loader: airbyte
    tables:
${tables}
`;
}

// --- bronze model --------------------------------------------------------------

function renderBronzeSql(spec: IntegrationModelsSpec, t: IntegrationTableSpec): string {
  const srcName = sanitizeIdent(t.name);
  const pk = (t.primaryKey || []).map((k) => k.split('.').pop() as string).filter(Boolean);
  const incremental = t.loadType === 'incremental' && pk.length > 0;
  const cols = t.columns && t.columns.length > 0;

  const cfg: string[] = [
    `    materialized = '${incremental ? 'incremental' : 'table'}'`,
    `    , alias = 'bronze_${t.name}'`,
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

-- GERADO por server/dbtCodegen.ts — camada Bronze, tabela ${t.name}.
-- Um arquivo por tabela; a regeração sobrescreve este arquivo.
-- Origem: source('${SOURCE_NAME}', '${srcName}')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_${t.name}  (renome + LGPD Art. 46 + dedup CDC)

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

// --- _properties.yml da camada Bronze ---------------------------------------

/** Manifesto: modelo -> { tabela raw, PK }. Acumula entre integrações. */
type BronzeManifest = Record<string, { table: string; pk: string[] }>;

/** Bloco YAML (item de `models:`) de um modelo Bronze gerado. */
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

// Bloco fixo do modelo de EXEMPLO (bronze_transacoes). Fica no _properties.yml
// para a camada ter "todos os dados" num arquivo só; só participa do build com
// DBT_DEMO_ENABLED=true.
const BRONZE_DEMO_BLOCK = `  - name: bronze_transacoes
    description: "EXEMPLO — Bronze do seed transacoes (só com DBT_DEMO_ENABLED=true)."
    columns:
      - name: id_transacao
        data_tests: [unique, not_null]
      - name: status_transacao
        data_tests:
          - not_null
          - accepted_values:
              values: ["APROVADO", "PENDENTE", "CANCELADO", "RECUSADO", "PAID", "SUCCESS", "CAPTURADO", "FAILED"]
              config:
                severity: warn
      - name: dt_ingestao_lake
        data_tests: [not_null]`;

function renderBronzePropertiesYml(manifest: BronzeManifest): string {
  const generated = Object.keys(manifest)
    .sort()
    .map((name) => bronzeModelBlock(name, manifest[name].table, manifest[name].pk))
    .join('\n');
  return `version: 2

# _properties.yml — CAMADA BRONZE (todos os modelos da camada num arquivo só).
# bronze_transacoes é EXEMPLO (fixo). As demais entradas são GERADAS por
# server/dbtCodegen.ts a partir de dbt/${BRONZE_MANIFEST_FILE} — não editar à mão.
models:
${BRONZE_DEMO_BLOCK}
${generated}
`;
}

// --- escrita -----------------------------------------------------------------

function validateSpec(spec: IntegrationModelsSpec): string | null {
  if (!spec || typeof spec !== 'object') return 'corpo inválido';
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

/** Escreve (sobrescrevendo) os modelos Bronze das tabelas do spec + a source. */
export async function writeIntegrationModels(spec: IntegrationModelsSpec): Promise<WriteModelsResult> {
  const err = validateSpec(spec);
  if (err) throw new Error(err);

  const projectDir = resolveDbtProjectDir();
  const bronzeDir = join(projectDir, 'models', 'medallion', 'bronze');
  const sourcesDir = join(projectDir, 'models', 'sources');
  retrySync(() => mkdirSync(bronzeDir, { recursive: true }));
  retrySync(() => mkdirSync(sourcesDir, { recursive: true }));

  // 1) source: acumula as tabelas no manifesto e re-renderiza o yml
  const sourcesManifest = readJsonManifest<SourcesManifest>(projectDir, SOURCES_MANIFEST_FILE);
  for (const t of spec.tables) {
    sourcesManifest[sanitizeIdent(t.name)] = { identifier: `raw_${t.name}` };
  }
  retrySync(() => writeFileSync(join(projectDir, SOURCES_MANIFEST_FILE), JSON.stringify(sourcesManifest, null, 2) + '\n', 'utf8'));
  retrySync(() => writeFileSync(join(sourcesDir, SOURCES_FILE), renderSourcesYml(sourcesManifest), 'utf8'));

  // 2) um bronze_<tabela>.sql por tabela — sobrescreve
  const files: string[] = [SOURCES_FILE, PROPERTIES_FILE];
  const models: string[] = [];
  for (const t of spec.tables) {
    const base = bronzeModelName(t.name);
    retrySync(() => writeFileSync(join(bronzeDir, `${base}.sql`), renderBronzeSql(spec, t), 'utf8'));
    files.push(`${base}.sql`);
    models.push(base);
  }

  // 3) _properties.yml da camada: acumula {modelo -> tabela, PK} e re-renderiza
  const bronzeManifest = readJsonManifest<BronzeManifest>(projectDir, BRONZE_MANIFEST_FILE);
  for (const t of spec.tables) {
    const pk = (t.primaryKey || []).map((k) => k.split('.').pop() as string).filter(Boolean);
    bronzeManifest[bronzeModelName(t.name)] = { table: t.name, pk };
  }
  retrySync(() => writeFileSync(join(projectDir, BRONZE_MANIFEST_FILE), JSON.stringify(bronzeManifest, null, 2) + '\n', 'utf8'));
  retrySync(() => writeFileSync(join(bronzeDir, PROPERTIES_FILE), renderBronzePropertiesYml(bronzeManifest), 'utf8'));

  const mode = (process.env.DBT_CODEGEN_GIT || 'off').toLowerCase();
  let git: Pick<WriteModelsResult, 'git' | 'gitDetail'> = { git: 'skipped' };
  if (mode === 'commit' || mode === 'push') {
    git = await gitCommit(bronzeDir, `dbt: modelos Bronze (${models.join(', ')})`, mode === 'push');
  }

  return { dir: bronzeDir, files, models, sources: Object.keys(sourcesManifest), ...git };
}

/** Lista os modelos Bronze gerados (bronze_*.sql em models/medallion/bronze/). */
export function listGeneratedModels(): string[] {
  const dir = join(resolveDbtProjectDir(), 'models', 'medallion', 'bronze');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith('bronze_') && f.endsWith('.sql') && f !== 'bronze_transacoes.sql')
    .map((f) => f.replace(/\.sql$/, ''))
    .sort();
}

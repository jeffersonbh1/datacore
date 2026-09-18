import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { isMap, isSeq, parseDocument } from 'yaml';
import { resolveDbtProjectDir } from './dbtRunner';
import { buildColumnRenameMap } from './bronzeNaming';

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
  /** Modelos Silver gerados (1 por tabela, passthrough do Bronze — ver renderSilverSql). */
  silverModels: string[];
  sources: string[];
  git: 'skipped' | 'committed' | 'pushed' | 'failed';
  gitDetail?: string;
}

const SOURCE_NAME = 'datacore_raw';
const SOURCES_FILE = '_datacore_raw__sources.yml';
const SOURCES_MANIFEST_FILE = '_generated_sources.json';
const PROPERTIES_FILE = '_properties.yml';
export const BRONZE_MANIFEST_FILE = '_generated_bronze.json';
const SILVER_MANIFEST_FILE = '_generated_silver.json';

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

/** Nome do modelo Silver: silver_<sistema>_<tabela>. */
export function silverModelName(sistema: string, table: string): string {
  return `silver_${sistemaSlug(sistema)}_${sanitizeIdent(table)}`;
}

/** Nome-base da chave primária (do stream Airbyte, ex. "public.usuarios.id" -> "id"). */
function primaryKeyBaseNames(t: IntegrationTableSpec): string[] {
  return (t.primaryKey || []).map((k) => k.split('.').pop() as string).filter(Boolean);
}

/** Resolve os nomes da PK para o nome PADRONIZADO (ver server/bronzeNaming.ts):
 *  se a tabela tem `columns` (o caso normal), a PK vira o alias que a
 *  projeção da Bronze de fato gera — dedup/incremental têm que apontar para a
 *  coluna que existe, não para o nome original do source. Sem `columns`
 *  (passthrough `select *`, sem renome possível), mantém o nome original. */
function resolvePrimaryKey(t: IntegrationTableSpec, renameMap: Map<string, string> | null): string[] {
  return primaryKeyBaseNames(t).map((k) => (renameMap ? renameMap.get(k) ?? k : k));
}

/** Uma coluna documentada no _properties.yml: nome final (padronizado) +
 *  origem (nome da coluna no source) + descrição opcional explícita. Colunas
 *  de negócio não trazem `description` — o texto é derivado de `source` em
 *  `columnsBlock`; marca d'água e controle do Airbyte trazem descrição fixa,
 *  já que seu texto não é um simples "veio do campo X". */
export interface ColumnDoc {
  name: string;
  source: string;
  description?: string;
}

/** As duas colunas de marca d'água que `renderBronzeSql` sempre acrescenta,
 *  fora da lista de colunas de negócio (ver ali). `source` aqui é o nome raw
 *  de verdade quando existe um (dt_ingestao_lake vem de _airbyte_extracted_at)
 *  — é o que permite ao Dicionário de Dados (server/bronzeColumnDocs.ts)
 *  reconhecer essa coluna ao navegar a tabela raw. */
const WATERMARK_COLUMNS: ColumnDoc[] = [
  {
    name: 'dt_ingestao_lake',
    source: '_airbyte_extracted_at',
    description: 'Data de ingestão no lake — marca d\'água do Airbyte (derivada de _airbyte_extracted_at).',
  },
  {
    name: '_dbt_loaded_at',
    source: 'current_timestamp()',
    description: 'Data/hora em que este build do dbt foi executado (current_timestamp()).',
  },
];

/** Colunas de controle que o Airbyte grava em toda tabela raw (Destination v2)
 *  — não entram na projeção de negócio da Bronze (`renderBronzeSql` não as
 *  seleciona), mas o Dicionário de Dados do Hub de Governança & LGPD lê o
 *  schema ao vivo da Raw e precisa poder documentá-las também. Só fazem
 *  sentido na Bronze (a Silver é passthrough da Bronze — não tem essas
 *  colunas nem indiretamente), documentadas sob o próprio nome raw.
 *  _airbyte_extracted_at fica de fora daqui — já é WATERMARK_COLUMNS acima. */
const AIRBYTE_CONTROL_COLUMNS: ColumnDoc[] = [
  {
    name: '_airbyte_raw_id',
    source: '_airbyte_raw_id',
    description: 'Identificador único gerado pelo Airbyte para o registro bruto.',
  },
  {
    name: '_airbyte_meta',
    source: '_airbyte_meta',
    description: 'Metadados internos do Airbyte sobre a sincronização deste registro (erros por coluna, etc.).',
  },
  {
    name: '_airbyte_generation_id',
    source: '_airbyte_generation_id',
    description: 'Identificador de geração da sincronização do Airbyte (Destination v2).',
  },
];

/** Todas as colunas do modelo gerado, na mesma ordem da projeção: as de
 *  negócio (já padronizadas — ver server/bronzeNaming.ts — com o nome
 *  original do source anotado) seguidas das de marca d'água e, só na Bronze,
 *  das colunas de controle do Airbyte. Usado para documentar o schema inteiro
 *  (o MAPEAMENTO origem -> padronizado de cada campo) no _properties.yml. */
function resolveColumnDocs(t: IntegrationTableSpec, renameMap: Map<string, string> | null, layer: Layer): ColumnDoc[] {
  const business: ColumnDoc[] = t.columns && t.columns.length > 0
    ? t.columns.map((c) => ({ name: renameMap ? renameMap.get(c) ?? c : c, source: c }))
    : [];
  const control = layer === 'Bronze' ? AIRBYTE_CONTROL_COLUMNS : [];
  return [...business, ...WATERMARK_COLUMNS, ...control];
}

type PiiMacro = 'mascarar_cpf' | 'tokenizar_email' | 'hash_sha256';

/** Heurística de nome usada tanto para decidir a máscara LGPD da Bronze quanto
 *  para sinalizar "dado pessoal" no catálogo Raw (server/routes/rawCatalog.ts) —
 *  mesma regra, uma fonte só. */
export function piiMacroFor(column: string): PiiMacro | null {
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
  const cols = t.columns && t.columns.length > 0;
  // Padronização de nomes (server/bronzeNaming.ts): só é possível renomear
  // quando a lista de colunas é conhecida — sem ela a projeção é `select *`
  // (passthrough) e os nomes originais do source são preservados.
  const renameMap = cols ? buildColumnRenameMap(t.columns!, t.name) : null;
  const pk = resolvePrimaryKey(t, renameMap);
  const incremental = t.loadType === 'incremental' && pk.length > 0;

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

  // Marca d'água (sempre acrescentada — ver `tipado`, abaixo) entra no MESMO
  // grupo de alinhamento das colunas de negócio, para o "AS" cair na mesma
  // coluna em toda a projeção (mesmo estilo de dbt/models/medallion/bronze/bronze_transacoes.sql).
  const watermarkCols: { left: string; alias: string }[] = [
    { left: 'cast(_airbyte_extracted_at AS TIMESTAMP)', alias: 'dt_ingestao_lake' },
    { left: 'current_timestamp()', alias: '_dbt_loaded_at' },
  ];

  let projection: string;
  let watermark: string;
  let renameComment = '';
  if (cols) {
    const renamed: string[] = [];
    const businessCols = t.columns!.map((c) => {
      const novo = renameMap!.get(c)!;
      if (novo !== c) renamed.push(`${c} -> ${novo}`);
      const macro = spec.applyLgpd ? piiMacroFor(c) : null;
      return { left: macro ? `{{ ${macro}('${c}') }}` : c, alias: novo };
    });
    if (renamed.length > 0) {
      renameComment = `\n-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):\n${renamed.map((r) => `--   ${r}`).join('\n')}`;
    }
    // Largura de alinhamento: a maior expressão da tabela (negócio + marca
    // d'água) + 2 espaços de respiro mínimo — mesma folga usada nos exemplos.
    const allCols = [...businessCols, ...watermarkCols];
    const width = Math.max(...allCols.map((p) => p.left.length)) + 2;
    const renderCol = (p: { left: string; alias: string }, last: boolean) =>
      `        ${p.left.padEnd(width)}AS ${p.alias}${last ? '' : ','}`;
    projection = businessCols.map((p) => renderCol(p, false)).join('\n') + '\n';
    watermark = watermarkCols.map((p, i) => renderCol(p, i === watermarkCols.length - 1)).join('\n');
  } else {
    projection = '        *,\n';
    watermark = watermarkCols.map((p, i) => `        ${p.left} AS ${p.alias}${i === watermarkCols.length - 1 ? '' : ','}`).join('\n');
  }

  const incrementalFilter = incremental
    ? `
    {% if is_incremental() %}
    WHERE _airbyte_extracted_at > (SELECT max(dt_ingestao_lake) FROM {{ this }})
    {% endif %}`
    : '';

  const dedup =
    pk.length > 0
      ? `
, deduplicado AS (
    SELECT *
    FROM tipado
    QUALIFY row_number() OVER (
        PARTITION BY ${pk.join(', ')}
        ORDER BY dt_ingestao_lake DESC
    ) = 1
)

SELECT * FROM deduplicado
`
      : `
SELECT * FROM tipado
`;

  return `{{ config(
${cfg.join('\n')}
) }}

-- GERADO por server/dbtCodegen.ts — sistema "${spec.sistema}", camada Bronze, tabela ${t.name}.
-- A regeração sobrescreve este arquivo.
-- Origem: source('${SOURCE_NAME}', '${srcName}')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.${modelAlias}  (renome + LGPD Art. 46 + dedup CDC)${renameComment}

WITH fonte AS (
    SELECT * FROM {{ source('${SOURCE_NAME}', '${srcName}') }}${incrementalFilter}
),

tipado AS (
    SELECT
${projection}${watermark}
    FROM fonte
)
${dedup}`;
}

// --- modelo Silver ----------------------------------------------------------
// Curadoria mínima real: um modelo por tabela, materializado como table, lendo
// do Bronze já tipado/deduplicado/sanitizado (LGPD). Sem regra de negócio
// específica — isso não dá pra gerar automaticamente —, mas é dbt de verdade,
// executa contra o BigQuery real e fica em models/medallion/silver/<sistema>/
// pronto para o usuário estender (o editor visual do Studio edita este mesmo
// arquivo). Regenerar sobrescreve, igual à Bronze.
function renderSilverSql(spec: IntegrationModelsSpec, t: IntegrationTableSpec): string {
  const sys = sistemaSlug(spec.sistema);
  const srcName = sanitizeIdent(t.name);
  const bronzeRef = bronzeModelName(spec.sistema, t.name);
  const modelAlias = `silver_${sys}_${srcName}`;

  return `{{ config(
    materialized = 'table'
    , alias = '${modelAlias}'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "${spec.sistema}", camada Silver, tabela ${t.name}.
-- A regeração sobrescreve este arquivo. Ponto de partida: passthrough do Bronze
-- já tipado/deduplicado/sanitizado — adicione aqui as regras de curadoria do
-- negócio (joins, métricas, renomes analíticos) conforme necessário.
-- Origem: ref('${bronzeRef}')
-- Saída : <DBT_SCHEMA_SILVER>.${modelAlias}

SELECT * FROM {{ ref('${bronzeRef}') }}
`;
}

// --- _properties.yml por sistema ------------------------------------------------

/** Manifesto aninhado: sistema -> modelo -> { tabela raw, PK, o MAPEAMENTO
 *  completo origem -> padronizado de toda coluna do modelo }. Acumula por sistema. */
export type BronzeManifest = Record<string, Record<string, { table: string; pk: string[]; columns: ColumnDoc[] }>>;

type Layer = 'Bronze' | 'Silver';

/** Escapa para caber numa string YAML entre aspas duplas — a descrição
 *  preservada de uma regeração anterior pode ter sido editada à mão (Hub de
 *  Governança & LGPD) e conter aspas, barras, etc. */
function yamlQuote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
}

/** Descrições já presentes no _properties.yml atual (antes de sobrescrever),
 *  por modelo -> coluna. Usado para NÃO perder uma descrição já preenchida —
 *  seja a gerada automaticamente numa regeração anterior, seja uma editada à
 *  mão pelo Dicionário de Dados — quando a integração é recriada/resincronizada:
 *  a descrição só é (re)gerada na primeira vez que a coluna aparece; depois
 *  disso, fica "mantida" através de qualquer regeração. */
function readExistingDescriptions(path: string): Map<string, Map<string, string>> {
  const result = new Map<string, Map<string, string>>();
  if (!existsSync(path)) return result;
  let doc;
  try {
    doc = parseDocument(readFileSync(path, 'utf8'));
  } catch {
    return result;
  }
  const models = doc.get('models');
  if (!isSeq(models)) return result;
  for (const model of models.items) {
    if (!isMap(model)) continue;
    const modelName = model.get('name');
    if (typeof modelName !== 'string') continue;
    const columns = model.get('columns');
    if (!isSeq(columns)) continue;
    const colMap = new Map<string, string>();
    for (const col of columns.items) {
      if (!isMap(col)) continue;
      const colName = col.get('name');
      const desc = col.get('description');
      if (typeof colName === 'string' && typeof desc === 'string') colMap.set(colName, desc);
    }
    result.set(modelName, colMap);
  }
  return result;
}

/** Lista TODAS as colunas do modelo em `columns:` — não só a PK — com uma
 *  descrição para cada uma (o mapeamento origem -> padronizado, ou a
 *  descrição fixa das colunas de marca d'água/controle do Airbyte — ver
 *  WATERMARK_COLUMNS/AIRBYTE_CONTROL_COLUMNS —, ou a que já existia no
 *  arquivo antes desta regeração, com prioridade sobre as anteriores). A(s)
 *  coluna(s) de PK mantêm os data_tests de unicidade/not-null. */
function columnsBlock(pk: string[], columns: ColumnDoc[], existing?: Map<string, string>): string {
  if (columns.length === 0) return '';
  const pkSet = new Set(pk);
  const lines = columns.map(({ name, source, description }) => {
    const generated = description ?? `Campo raw correspondente: "${source}".`;
    const text = existing?.get(name) ?? generated;
    const desc = `        description: ${yamlQuote(text)}`;
    if (!pkSet.has(name)) return `      - name: ${name}\n${desc}`;
    const tests = pk.length === 1 ? '[unique, not_null]' : '[not_null]';
    return `      - name: ${name}\n${desc}\n        data_tests: ${tests}`;
  });
  return `\n    columns:\n${lines.join('\n')}`;
}

function layerModelBlock(
  layer: Layer,
  name: string,
  table: string,
  pk: string[],
  columns: ColumnDoc[],
  existing?: Map<string, string>,
): string {
  const cols = columnsBlock(pk, columns, existing);
  if (pk.length > 1) {
    return `  - name: ${name}
    description: "${layer} gerado — tabela ${table}."
    data_tests:
      - dbt_utils.unique_combination_of_columns:
          combination_of_columns:
${pk.map((k) => `            - ${k}`).join('\n')}${cols}`;
  }
  const semPk = pk.length === 0 ? ' (sem PK; sem deduplicação)' : '';
  return `  - name: ${name}
    description: "${layer} gerado — tabela ${table}${semPk}."${cols}`;
}

function renderSistemaPropertiesYml(
  layer: Layer,
  manifestFile: string,
  sistema: string,
  sys: string,
  models: Record<string, { table: string; pk: string[]; columns: ColumnDoc[] }>,
  existingPath: string,
): string {
  const existingByModel = readExistingDescriptions(existingPath);
  const blocks = Object.keys(models)
    .sort()
    .map((name) => layerModelBlock(layer, name, models[name].table, models[name].pk, models[name].columns, existingByModel.get(name)))
    .join('\n');
  return `version: 2

# _properties.yml — sistema "${sistema}" (${sys}), camada ${layer}.
# TODOS os modelos deste sistema. GERADO por server/dbtCodegen.ts a partir de
# dbt/${manifestFile} — não editar à mão (descrições de coluna são
# preservadas entre regerações — ver readExistingDescriptions).
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
      // Remote SSH explícito via deploy key (ver Dockerfile/GIT_SSH_COMMAND) —
      // não depende do remote que a imagem trouxe do checkout que a gerou
      // (normalmente HTTPS, sem credencial). GIT_PUSH_REMOTE_URL vem do
      // cloudbuild.gateway.yaml (git@github.com:<owner>/<repo>.git).
      const remoteUrl = process.env.GIT_PUSH_REMOTE_URL;
      if (remoteUrl) await execFileP('git', ['-C', repo, 'remote', 'set-url', 'origin', remoteUrl]);
      // Push explícito pro branch atual (HEAD:<branch>) em vez de `git push` puro —
      // a imagem pode não ter upstream configurado para o branch copiado do
      // checkout que gerou o build.
      const { stdout: branchOut } = await execFileP('git', ['-C', repo, 'rev-parse', '--abbrev-ref', 'HEAD']);
      const branch = branchOut.trim();
      await execFileP('git', ['-C', repo, 'push', 'origin', `HEAD:${branch}`]);
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
  const silverSysDir = join(projectDir, 'models', 'medallion', 'silver', sys);
  const sourcesDir = join(projectDir, 'models', 'sources');
  retrySync(() => mkdirSync(sysDir, { recursive: true }));
  retrySync(() => mkdirSync(silverSysDir, { recursive: true }));
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
    // Mesmo mapa de renome usado em renderBronzeSql — os testes do
    // _properties.yml precisam apontar para a coluna PADRONIZADA (é essa que
    // existe na tabela gerada), não para o nome original do source.
    const renameMap = t.columns && t.columns.length > 0 ? buildColumnRenameMap(t.columns, t.name) : null;
    const pk = resolvePrimaryKey(t, renameMap);
    const columns = resolveColumnDocs(t, renameMap, 'Bronze');
    sysModels[bronzeModelName(spec.sistema, t.name)] = { table: t.name, pk, columns };
  }
  bronzeManifest[sys] = sysModels;
  retrySync(() => writeFileSync(join(projectDir, BRONZE_MANIFEST_FILE), JSON.stringify(bronzeManifest, null, 2) + '\n', 'utf8'));
  const bronzePropertiesPath = join(sysDir, PROPERTIES_FILE);
  retrySync(() => writeFileSync(bronzePropertiesPath, renderSistemaPropertiesYml('Bronze', BRONZE_MANIFEST_FILE, spec.sistema, sys, sysModels, bronzePropertiesPath), 'utf8'));

  // 4) um modelo Silver por tabela em models/medallion/silver/<sistema>/ — mesmo
  // padrão da Bronze: passthrough do Bronze correspondente, pronto para o
  // usuário adicionar as regras de curadoria pelo editor visual do Studio.
  const silverModels: string[] = [];
  for (const t of spec.tables) {
    const base = silverModelName(spec.sistema, t.name);
    retrySync(() => writeFileSync(join(silverSysDir, `${base}.sql`), renderSilverSql(spec, t), 'utf8'));
    files.push(`${sys}/${base}.sql`);
    silverModels.push(base);
  }
  const silverManifest = readJsonManifest<BronzeManifest>(projectDir, SILVER_MANIFEST_FILE);
  const silverSysModels = silverManifest[sys] || {};
  for (const t of spec.tables) {
    // Silver é passthrough do Bronze (renderSilverSql): herda os mesmos nomes
    // de coluna já padronizados, então a PK do teste é a mesma da Bronze.
    const renameMap = t.columns && t.columns.length > 0 ? buildColumnRenameMap(t.columns, t.name) : null;
    const pk = resolvePrimaryKey(t, renameMap);
    const columns = resolveColumnDocs(t, renameMap, 'Silver');
    silverSysModels[silverModelName(spec.sistema, t.name)] = { table: t.name, pk, columns };
  }
  silverManifest[sys] = silverSysModels;
  retrySync(() => writeFileSync(join(projectDir, SILVER_MANIFEST_FILE), JSON.stringify(silverManifest, null, 2) + '\n', 'utf8'));
  const silverPropertiesPath = join(silverSysDir, PROPERTIES_FILE);
  retrySync(() => writeFileSync(silverPropertiesPath, renderSistemaPropertiesYml('Silver', SILVER_MANIFEST_FILE, spec.sistema, sys, silverSysModels, silverPropertiesPath), 'utf8'));
  files.push(`${sys}/${PROPERTIES_FILE} (silver)`);

  const mode = (process.env.DBT_CODEGEN_GIT || 'off').toLowerCase();
  let git: Pick<WriteModelsResult, 'git' | 'gitDetail'> = { git: 'skipped' };
  if (mode === 'commit' || mode === 'push') {
    git = await gitCommit(sysDir, `dbt: modelos Bronze+Silver do sistema ${sys} (${models.length}+${silverModels.length})`, mode === 'push');
  }

  return { dir: sysDir, sistema: sys, files, models, silverModels, sources: Object.keys(sourcesManifest), ...git };
}

/** Lista os modelos Bronze/Silver gerados ({bronze,silver}_*.sql em models/medallion/<camada>/<sistema>/). */
export function listGeneratedModels(): string[] {
  const medallionDir = join(resolveDbtProjectDir(), 'models', 'medallion');
  const out: string[] = [];
  for (const layerDir of ['bronze', 'silver']) {
    const base = join(medallionDir, layerDir);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const f of readdirSync(join(base, entry.name))) {
        if (f.startsWith(`${layerDir}_`) && f.endsWith('.sql')) out.push(f.replace(/\.sql$/, ''));
      }
    }
  }
  return out.sort();
}

/** Localiza o .sql de um modelo Bronze ou Silver gerado por nome, em qualquer sistema/camada. */
function findGeneratedModelPath(name: string): string | null {
  // Mesmo charset de sanitizeIdent/sistemaSlug — barra path traversal.
  if (!/^[A-Za-z0-9_]+$/.test(name)) return null;
  const medallionDir = join(resolveDbtProjectDir(), 'models', 'medallion');
  for (const layerDir of ['bronze', 'silver']) {
    const base = join(medallionDir, layerDir);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = join(base, entry.name, `${name}.sql`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** Lê o .sql de um modelo Bronze/Silver gerado (o mesmo arquivo que o `dbt build` executa). */
export function readGeneratedModelSql(name: string): string {
  const path = findGeneratedModelPath(name);
  if (!path) throw new Error(`Modelo dbt "${name}" não encontrado em models/medallion/{bronze,silver}/.`);
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


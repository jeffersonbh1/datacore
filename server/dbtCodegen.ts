import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { resolveDbtProjectDir } from './dbtRunner';

const execFileP = promisify(execFile);

// -----------------------------------------------------------------------------
// Codegen dos modelos dbt da camada Bronze — um modelo por tabela da integração.
// Escreve dbt/models/generated/<slug>/{ _<slug>__sources.yml, stg_<slug>__<t>.sql,
// bronze_<slug>__<t>.sql, _<slug>__models.yml } e (opcional) commita no repo.
// Chamado por POST /api/dbt/models na criação da integração; consumido pelo
// `dbt build --select tag:<slug>` em server/routes/bronze.ts.
// -----------------------------------------------------------------------------

export interface IntegrationTableSpec {
  /** Nome do stream / base da tabela raw (a tabela real é raw_<name>). */
  name: string;
  /** Colunas selecionadas na integração. Vazio => passthrough `select *` sem LGPD. */
  columns?: string[];
  /** Chave primária (do stream Airbyte). Habilita dedup CDC + unique_key. */
  primaryKey?: string[];
  /** Campo de cursor incremental (informativo — a marca d'água usada é _airbyte_extracted_at). */
  cursorField?: string | null;
  loadType?: 'full_refresh' | 'incremental';
}

export interface IntegrationModelsSpec {
  /** Identificador estável da integração, ex.: "conn_<airbyteConnectionId>". */
  slug: string;
  projectId: string;
  /** Dataset raw_ do Airbyte. */
  rawDataset: string;
  /** Dataset bronze_ de saída. */
  bronzeDataset: string;
  applyLgpd?: boolean;
  tables: IntegrationTableSpec[];
}

export interface WriteModelsResult {
  slug: string;
  dir: string;
  files: string[];
  models: string[];
  git: 'skipped' | 'committed' | 'pushed' | 'failed';
  gitDetail?: string;
}

// Windows + OneDrive/AV às vezes seguram um handle no diretório e devolvem
// EPERM/EBUSY momentâneo — repete a operação de FS algumas vezes.
function retrySync<T>(fn: () => T, tries = 5, delayMs = 120): T {
  for (let i = 0; ; i++) {
    try {
      return fn();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (i >= tries - 1 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'ENOTEMPTY')) throw err;
      const until = Date.now() + delayMs * (i + 1);
      while (Date.now() < until) { /* espera bloqueante curta */ }
    }
  }
}

/** dbt exige nomes de nó no formato [A-Za-z_][A-Za-z0-9_]*. */
export function sanitizeIdent(raw: string): string {
  const s = raw.replace(/[^A-Za-z0-9_]/g, '_');
  return /^[A-Za-z_]/.test(s) ? s : `t_${s}`;
}

export function slugIsValid(slug: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]{1,120}$/.test(slug);
}

/**
 * Slug estável de uma integração a partir do airbyteConnectionId.
 * DEVE bater exatamente com o frontend (src/lib/pipelineBuilder.ts e
 * AutoPipelineView.handleCreateAutoIntegration). O prefixo "conn_" já garante
 * início com letra, então NÃO usa sanitizeIdent (que prefixaria "t_" quando o
 * connectionId começa com dígito, quebrando o casamento).
 */
export function slugFromConnectionId(connectionId: string): string {
  return `conn_${connectionId.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

/** Nome do modelo Bronze gerado para uma tabela (único no projeto via prefixo do slug). */
export function bronzeModelName(slug: string, table: string): string {
  return `bronze_${slug}__${sanitizeIdent(table)}`;
}

type PiiMacro = 'mascarar_cpf' | 'tokenizar_email' | 'hash_sha256';

function piiMacroFor(column: string): PiiMacro | null {
  const c = column.toLowerCase();
  if (/(^|_)(cpf|cnpj|documento|doc|num_doc)(_|$)/.test(c)) return 'mascarar_cpf';
  if (/(e_?mail)/.test(c)) return 'tokenizar_email';
  if (/(cartao|card|pan|num(ero)?_cartao|nr_cartao)/.test(c)) return 'hash_sha256';
  if (/(telefone|phone|celular|fone|msisdn|whatsapp)/.test(c)) return 'hash_sha256';
  if (/(^|_)(rg|passaporte|passport|ssn|cnh)(_|$)/.test(c)) return 'hash_sha256';
  return null;
}

function yamlList(items: string[], indent: string): string {
  return items.map((i) => `${indent}- ${i}`).join('\n');
}

function renderSourcesYml(spec: IntegrationModelsSpec): string {
  const tables = spec.tables
    .map(
      (t) => `      - name: ${sanitizeIdent(t.name)}
        identifier: raw_${t.name}
        config:
          loaded_at_field: _airbyte_extracted_at`,
    )
    .join('\n');
  return `version: 2

# GERADO por server/dbtCodegen.ts — integração ${spec.slug}. Não editar à mão.
sources:
  - name: ${spec.slug}
    database: "{{ env_var('DBT_GCP_PROJECT', 'data-plataform-dev') }}"
    schema: "{{ env_var('DBT_RAW_DATASET', '${spec.rawDataset}') }}"
    loader: airbyte
    tables:
${tables}
`;
}

function renderStagingSql(spec: IntegrationModelsSpec, t: IntegrationTableSpec): string {
  const src = `{{ source('${spec.slug}', '${sanitizeIdent(t.name)}') }}`;
  const cols = t.columns && t.columns.length > 0;
  const projection = cols
    ? t.columns!.map((c) => `        ${c},`).join('\n')
    : '        *,';
  return `{{ config(
    materialized = 'ephemeral',
    enabled = env_var('DBT_ACTIVE_SLUG', '${spec.slug}') == '${spec.slug}',
    tags = ['generated', '${spec.slug}', 'staging'],
) }}

-- GERADO por server/dbtCodegen.ts — integração ${spec.slug}, tabela ${t.name}.
-- Ephemeral: compilado como CTE dentro do bronze_ correspondente (sem objeto no BQ).
-- enabled: só participa do parse quando DBT_ACTIVE_SLUG é esta integração (ou
-- não está setado). Evita colisão de alias quando integrações compartilham o
-- mesmo bronze dataset.
with fonte as (
    select * from ${src}
),

renomeado as (
    select
${projection}
        cast(_airbyte_extracted_at as timestamp) as dt_ingestao_lake,
        _airbyte_raw_id as _raw_id
    from fonte
)

select * from renomeado
`;
}

function renderBronzeSql(spec: IntegrationModelsSpec, t: IntegrationTableSpec): string {
  const stgRef = `stg_${spec.slug}__${sanitizeIdent(t.name)}`;
  const pk = (t.primaryKey || []).map((k) => k.split('.').pop() as string).filter(Boolean);
  const incremental = t.loadType === 'incremental' && pk.length > 0;
  const cols = t.columns && t.columns.length > 0;

  const cfg: string[] = [
    `    materialized = '${incremental ? 'incremental' : 'table'}'`,
    `    , alias = 'bronze_${t.name}'`,
    // schema vem do +schema em dbt_project.yml (models.generated) — não repetir
    // aqui: dentro de {{ config(...) }} um "{{ env_var(...) }}" aninhado não é
    // reavaliado, viraria string literal.
    // enabled: só quando DBT_ACTIVE_SLUG é esta integração (ou não setado) —
    // integrações que compartilham bronze dataset colidiriam no alias bronze_<t>.
    `    , enabled = env_var('DBT_ACTIVE_SLUG', '${spec.slug}') == '${spec.slug}'`,
    `    , tags = ['generated', '${spec.slug}', 'bronze']`,
    `    , partition_by = {'field': 'dt_ingestao_lake', 'data_type': 'timestamp', 'granularity': 'day'}`,
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
    where dt_ingestao_lake > (select max(dt_ingestao_lake) from {{ this }})
    {% endif %}`
    : '';

  const dedup =
    pk.length > 0
      ? `
, deduplicado as (
    select *
    from sanitizado
    qualify row_number() over (
        partition by ${pk.join(', ')}
        order by dt_ingestao_lake desc
    ) = 1
)

select * from deduplicado
`
      : `
select * from sanitizado
`;

  return `{{ config(
${cfg.join('\n')}
) }}

-- GERADO por server/dbtCodegen.ts — integração ${spec.slug}, tabela ${t.name}.
-- Camada Bronze: renome/tipagem leve + LGPD (Art. 46) + deduplicação CDC.
-- Editar aqui é permitido; a regeração sobrescreve o diretório inteiro.

with raw_source as (
    select * from {{ ref('${stgRef}') }}${incrementalFilter}
),

sanitizado as (
    select
${projection}
        dt_ingestao_lake,
        current_timestamp() as _dbt_loaded_at
    from raw_source
)
${dedup}`;
}

function renderModelsYml(spec: IntegrationModelsSpec): string {
  const blocks = spec.tables.map((t) => {
    const name = bronzeModelName(spec.slug, t.name);
    const pk = (t.primaryKey || []).map((k) => k.split('.').pop() as string).filter(Boolean);
    if (pk.length === 1) {
      return `  - name: ${name}
    description: "Bronze gerado — integração ${spec.slug}, tabela ${t.name}."
    columns:
      - name: ${pk[0]}
        data_tests: [unique, not_null]`;
    }
    if (pk.length > 1) {
      return `  - name: ${name}
    description: "Bronze gerado — integração ${spec.slug}, tabela ${t.name}."
    data_tests:
      - dbt_utils.unique_combination_of_columns:
          combination_of_columns:
${yamlList(pk, '            ')}
    columns:
${pk.map((k) => `      - name: ${k}\n        data_tests: [not_null]`).join('\n')}`;
    }
    return `  - name: ${name}
    description: "Bronze gerado — integração ${spec.slug}, tabela ${t.name} (sem PK; sem deduplicação)."`;
  });
  return `version: 2

# GERADO por server/dbtCodegen.ts — integração ${spec.slug}.
models:
${blocks.join('\n')}
`;
}

export function renderIntegrationModels(spec: IntegrationModelsSpec): { name: string; content: string }[] {
  const files: { name: string; content: string }[] = [
    { name: `_${spec.slug}__sources.yml`, content: renderSourcesYml(spec) },
    { name: `_${spec.slug}__models.yml`, content: renderModelsYml(spec) },
  ];
  for (const t of spec.tables) {
    const suffix = sanitizeIdent(t.name);
    files.push({ name: `stg_${spec.slug}__${suffix}.sql`, content: renderStagingSql(spec, t) });
    files.push({ name: `bronze_${spec.slug}__${suffix}.sql`, content: renderBronzeSql(spec, t) });
  }
  return files;
}

function validateSpec(spec: IntegrationModelsSpec): string | null {
  if (!spec || typeof spec !== 'object') return 'corpo inválido';
  if (!slugIsValid(spec.slug)) return 'slug inválido (esperado [A-Za-z_][A-Za-z0-9_]{1,120})';
  if (!spec.projectId) return 'projectId obrigatório';
  if (!spec.rawDataset || !spec.bronzeDataset) return 'rawDataset e bronzeDataset obrigatórios';
  if (!Array.isArray(spec.tables) || spec.tables.length === 0) return 'tables (não vazio) obrigatório';
  for (const t of spec.tables) {
    if (!t.name || !/^[A-Za-z0-9_.\-]+$/.test(t.name)) return `nome de tabela inválido: ${t?.name}`;
  }
  return null;
}

async function gitCommit(dir: string, message: string, push: boolean): Promise<Pick<WriteModelsResult, 'git' | 'gitDetail'>> {
  try {
    const { stdout: top } = await execFileP('git', ['-C', dir, 'rev-parse', '--show-toplevel']);
    const repo = top.trim();
    const name = process.env.GIT_AUTHOR_NAME || 'DataCore Gateway';
    const email = process.env.GIT_AUTHOR_EMAIL || 'gateway@datacore.local';
    await execFileP('git', ['-C', repo, 'add', '--', dir]);
    // Nada mudou? `git commit` falharia — trata como sucesso silencioso.
    const { stdout: staged } = await execFileP('git', ['-C', repo, 'diff', '--cached', '--name-only']);
    if (!staged.trim()) return { git: 'committed', gitDetail: 'nada a commitar (sem alterações)' };
    await execFileP('git', [
      '-C', repo,
      '-c', `user.name=${name}`,
      '-c', `user.email=${email}`,
      'commit', '-m', message,
    ]);
    if (push) {
      await execFileP('git', ['-C', repo, 'push']);
      return { git: 'pushed' };
    }
    return { git: 'committed' };
  } catch (err) {
    return { git: 'failed', gitDetail: err instanceof Error ? err.message : String(err) };
  }
}

/** Escreve (e opcionalmente commita) os modelos de uma integração. Regenera o diretório do zero. */
export async function writeIntegrationModels(spec: IntegrationModelsSpec): Promise<WriteModelsResult> {
  const err = validateSpec(spec);
  if (err) throw new Error(err);

  const projectDir = resolveDbtProjectDir();
  const dir = join(projectDir, 'models', 'generated', spec.slug);
  const rendered = renderIntegrationModels(spec);

  // Regenera o diretório do zero (cobre tabela removida da integração), com
  // retry para os EPERM transitórios de FS no Windows.
  retrySync(() => rmSync(dir, { recursive: true, force: true }));
  retrySync(() => mkdirSync(dir, { recursive: true }));
  for (const f of rendered) {
    retrySync(() => writeFileSync(join(dir, f.name), f.content, 'utf8'));
  }

  const mode = (process.env.DBT_CODEGEN_GIT || 'off').toLowerCase();
  let git: Pick<WriteModelsResult, 'git' | 'gitDetail'> = { git: 'skipped' };
  if (mode === 'commit' || mode === 'push') {
    git = await gitCommit(dir, `dbt: modelos Bronze gerados para ${spec.slug}`, mode === 'push');
  }

  return {
    slug: spec.slug,
    dir,
    files: rendered.map((f) => f.name),
    models: spec.tables.map((t) => bronzeModelName(spec.slug, t.name)),
    ...git,
  };
}

/** Remove os modelos de uma integração (ex.: integração excluída). */
export async function removeIntegrationModels(slug: string): Promise<{ slug: string; removed: boolean; git: string; gitDetail?: string }> {
  if (!slugIsValid(slug)) throw new Error('slug inválido');
  const projectDir = resolveDbtProjectDir();
  const dir = join(projectDir, 'models', 'generated', slug);
  const existed = existsSync(dir);
  rmSync(dir, { recursive: true, force: true });

  const mode = (process.env.DBT_CODEGEN_GIT || 'off').toLowerCase();
  let git: Pick<WriteModelsResult, 'git' | 'gitDetail'> = { git: 'skipped' };
  if (existed && (mode === 'commit' || mode === 'push')) {
    git = await gitCommit(dirname(dir), `dbt: remove modelos Bronze de ${slug}`, mode === 'push');
  }
  return { slug, removed: existed, git: git.git, gitDetail: git.gitDetail };
}

/** Lista os slugs com modelos gerados. */
export function listGeneratedSlugs(): string[] {
  const base = join(resolveDbtProjectDir(), 'models', 'generated');
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

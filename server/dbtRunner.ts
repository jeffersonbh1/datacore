import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// -----------------------------------------------------------------------------
// Ponte gateway -> dbt-core. Substitui o CREATE OR REPLACE TABLE ... AS SELECT
// da camada Bronze (server/routes/bronze.ts) por uma execução real de
// `dbt build` sobre o projeto em <repo>/dbt. Mesmas credenciais que o gateway
// já usa (BIGQUERY_CREDENTIALS_JSON) — nenhum segredo novo.
// -----------------------------------------------------------------------------

export interface RunDbtInput {
  /** GCP project — vira DBT_GCP_PROJECT. */
  projectId: string;
  /** Dataset raw_ do Airbyte — vira DBT_RAW_DATASET (fonte dos models de staging). */
  rawDataset: string;
  /** Dataset de saída da Bronze — vira DBT_SCHEMA_BRONZE. */
  bronzeDataset: string;
  /** Datasets Silver/Gold/Staging. Default: bronzeDataset com o prefixo trocado. */
  silverDataset?: string;
  goldDataset?: string;
  stagingDataset?: string;
  /** Localização dos datasets BigQuery (ex.: "southamerica-east1"). */
  location?: string;
  /** Seletor do dbt (`--select`). Default: process.env.DBT_BRONZE_SELECT. */
  select?: string;
  /** Passa `--full-refresh` (reconstrói models incrementais do zero). */
  fullRefresh?: boolean;
  /** Target do profiles.yml. Default: process.env.DBT_TARGET || "prod". */
  target?: string;
}

export interface DbtModelResult {
  /** Nome do model (ex.: "bronze_transacoes"). */
  name: string;
  /** unique_id completo do dbt (ex.: "model.datacore_dbt.bronze_transacoes"). */
  uniqueId: string;
  /** "success" | "error" | "skipped" | "pass" | "fail" | "warn" | "runtime error" */
  status: string;
  message?: string;
  executionTime?: number;
}

export interface RunDbtResult {
  ok: boolean;
  exitCode: number | null;
  select: string;
  target: string;
  /** Resultados por nó lidos de target/run_results.json. */
  models: DbtModelResult[];
  stdoutTail: string;
  stderrTail: string;
  error?: string;
}

export class DbtUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbtUnavailableError';
  }
}

/** True quando o operador desligou explicitamente a integração dbt. */
export function isDbtDisabled(): boolean {
  return String(process.env.DBT_DISABLED || '').toLowerCase() === 'true';
}

const DEFAULT_SELECT = 'staging medallion.bronze';
const RUN_TIMEOUT_MS = Number(process.env.DBT_RUN_TIMEOUT_MS) || 15 * 60 * 1000;

/** Localiza a pasta do projeto dbt (contém dbt_project.yml). */
export function resolveDbtProjectDir(): string {
  const fromEnv = process.env.DBT_PROJECT_DIR;
  if (fromEnv) {
    const abs = resolve(fromEnv);
    if (existsSync(join(abs, 'dbt_project.yml'))) return abs;
    throw new DbtUnavailableError(`DBT_PROJECT_DIR="${fromEnv}" não contém dbt_project.yml.`);
  }
  // Sobe a árvore a partir do cwd e de __dirname procurando ./dbt/dbt_project.yml.
  let here = process.cwd();
  try {
    here = dirname(fileURLToPath(import.meta.url));
  } catch {
    // import.meta.url indisponível (bundle CJS) — fica só com o cwd.
  }
  const starts = [process.cwd(), here];
  for (const start of starts) {
    let dir = resolve(start);
    for (let i = 0; i < 8; i++) {
      const candidate = join(dir, 'dbt', 'dbt_project.yml');
      if (existsSync(candidate)) return join(dir, 'dbt');
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new DbtUnavailableError(
    'Projeto dbt não encontrado. Defina DBT_PROJECT_DIR ou garanta que a pasta ./dbt está no deploy.',
  );
}

/**
 * Garante um keyfile de service account para o dbt. Se DBT_GCP_KEYFILE já
 * aponta para um arquivo existente, usa-o; senão materializa
 * BIGQUERY_CREDENTIALS_JSON num arquivo temporário e retorna o caminho.
 * Retorna null quando não há credencial (modo dev/oauth).
 */
export function ensureKeyfile(): string | null {
  const explicit = process.env.DBT_GCP_KEYFILE;
  if (explicit && existsSync(explicit)) return explicit;

  const raw = process.env.BIGQUERY_CREDENTIALS_JSON;
  if (!raw) return null;

  const hash = createHash('sha256').update(raw).digest('hex').slice(0, 16);
  const dir = join(tmpdir(), 'datacore-dbt');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `sa-${hash}.json`);
  if (!existsSync(path)) {
    // Valida que é JSON antes de gravar — falha cedo com erro claro.
    JSON.parse(raw);
    writeFileSync(path, raw, { mode: 0o600 });
  }
  return path;
}

function deriveDataset(bronzeDataset: string, layerPrefix: 'silver_' | 'gold_' | 'staging_'): string {
  if (/^bronze_/.test(bronzeDataset)) return bronzeDataset.replace(/^bronze_/, layerPrefix);
  // bronzeDataset sem o prefixo padrão: usa o nome da camada como sufixo.
  return `${layerPrefix}${bronzeDataset}`;
}

function tail(text: string, lines = 40): string {
  const arr = text.split('\n');
  return arr.slice(-lines).join('\n').trim();
}

function spawnDbt(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('dbt', args, { cwd, env, shell: false });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectPromise(new Error(`dbt ${args[0]} excedeu o tempo limite de ${RUN_TIMEOUT_MS}ms.`));
    }, RUN_TIMEOUT_MS);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        rejectPromise(new DbtUnavailableError(
          'Executável "dbt" não encontrado no PATH. Instale dbt-bigquery (ver dbt/requirements.txt) — a camada Bronze depende dele.',
        ));
        return;
      }
      rejectPromise(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr });
    });
  });
}

interface RunResultsFile {
  results: Array<{
    unique_id: string;
    status: string;
    message: string | null;
    execution_time: number;
  }>;
}

function readRunResults(projectDir: string): DbtModelResult[] {
  const path = join(projectDir, 'target', 'run_results.json');
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as RunResultsFile;
  return (parsed.results || []).map((r) => ({
    name: r.unique_id.split('.').pop() || r.unique_id,
    uniqueId: r.unique_id,
    status: r.status,
    message: r.message || undefined,
    executionTime: r.execution_time,
  }));
}

// Serializa execuções dentro do processo: dbt escreve em target/ e duas
// invocações concorrentes (botão do Studio + auto-sync) corromperiam o estado.
let queue: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(() => undefined, () => undefined);
  return run;
}

let depsInstalled = false;

export async function runDbt(input: RunDbtInput): Promise<RunDbtResult> {
  if (isDbtDisabled()) {
    throw new DbtUnavailableError('Integração dbt desativada (DBT_DISABLED=true).');
  }

  const projectDir = resolveDbtProjectDir();
  const target = input.target || process.env.DBT_TARGET || 'prod';
  const select = input.select || process.env.DBT_BRONZE_SELECT || DEFAULT_SELECT;

  const keyfile = ensureKeyfile();
  if (target !== 'dev' && !keyfile) {
    throw new DbtUnavailableError(
      'Sem credencial para o dbt: defina BIGQUERY_CREDENTIALS_JSON ou DBT_GCP_KEYFILE (ou use DBT_TARGET=dev).',
    );
  }

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DBT_PROFILES_DIR: process.env.DBT_PROFILES_DIR || projectDir,
    DBT_TARGET: target,
    DBT_GCP_PROJECT: input.projectId,
    DBT_GCP_LOCATION: input.location || process.env.DBT_GCP_LOCATION || 'southamerica-east1',
    DBT_RAW_DATASET: input.rawDataset,
    DBT_SCHEMA_STAGING: input.stagingDataset || process.env.DBT_SCHEMA_STAGING || deriveDataset(input.bronzeDataset, 'staging_'),
    DBT_SCHEMA_BRONZE: input.bronzeDataset,
    DBT_SCHEMA_SILVER: input.silverDataset || deriveDataset(input.bronzeDataset, 'silver_'),
    DBT_SCHEMA_GOLD: input.goldDataset || deriveDataset(input.bronzeDataset, 'gold_'),
    // O gateway só constrói modelos gerados por integração. Os modelos de
    // exemplo (transacoes) ficam desligados — se ativos, colidiriam no parse
    // com o alias `bronze_<t>` dos gerados.
    DBT_GENERATED_ENABLED: 'true',
    DBT_DEMO_ENABLED: 'false',
  };
  if (keyfile) childEnv.DBT_GCP_KEYFILE = keyfile;

  return withLock(async () => {
    let stdout = '';
    let stderr = '';

    if (!depsInstalled && !existsSync(join(projectDir, 'dbt_packages'))) {
      const deps = await spawnDbt(['--no-use-colors', 'deps', '--project-dir', projectDir, '--profiles-dir', childEnv.DBT_PROFILES_DIR as string], projectDir, childEnv);
      stdout += deps.stdout;
      stderr += deps.stderr;
      if (deps.code !== 0) {
        return {
          ok: false, exitCode: deps.code, select, target, models: [],
          stdoutTail: tail(stdout), stderrTail: tail(stderr),
          error: 'Falha em "dbt deps" (instalação de pacotes).',
        };
      }
    }
    depsInstalled = true;

    const args = [
      '--no-use-colors',
      'build',
      '--select', ...select.split(/\s+/).filter(Boolean),
      '--target', target,
      '--project-dir', projectDir,
      '--profiles-dir', childEnv.DBT_PROFILES_DIR as string,
    ];
    if (input.fullRefresh) args.push('--full-refresh');

    // Remove o run_results.json anterior: se este build falhar antes de escrever
    // o seu (erro de compilação/parse), não queremos ler resultados obsoletos.
    rmSync(join(projectDir, 'target', 'run_results.json'), { force: true });

    const built = await spawnDbt(args, projectDir, childEnv);
    stdout += built.stdout;
    stderr += built.stderr;

    const models = readRunResults(projectDir);
    const hasNodeFailure = models.some((m) => m.status === 'error' || m.status === 'fail' || m.status === 'runtime error');

    return {
      ok: built.code === 0 && !hasNodeFailure,
      exitCode: built.code,
      select,
      target,
      models,
      stdoutTail: tail(stdout),
      stderrTail: tail(stderr),
      error: built.code === 0 && !hasNodeFailure ? undefined : 'dbt build reportou falhas — ver models[] e stderrTail.',
    };
  });
}

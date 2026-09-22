import { Router } from 'express';
import {
  loadTenantContext, readCompiledModelSql, readModelPropertiesYaml, readModelSql, writeModelSql,
  type CatalogModel, type TenantContext,
} from '../agent/catalog';
import { buildLineage, silverDatasetsOf } from '../agent/lineage';
import { DbtUnavailableError, runDbt } from '../dbtRunner';
import { canSaveGoldModels, getDataCoreUser } from '../userSession';

// -----------------------------------------------------------------------------
// Tela "Studio Visual ETL Gold": grafo de linhagem da empresa, SQL de um modelo
// (somente leitura) e construção de modelos Gold. Montada em index.ts atrás de
// requireGatewayApiKey + requireUserSession — a empresa vem do usuário autenticado.
// -----------------------------------------------------------------------------

export const lineageRouter = Router();

const MAX_BUILD_MODELS = 20;

/**
 * Nome do teste a partir do unique_id do dbt: `test.<projeto>.<nome_do_teste>.<hash>`. O `name` que o runDbt
 * devolve é o ÚLTIMO trecho do unique_id — para modelos é o nome do modelo, mas para testes é só o hash —,
 * então o nome real tem que vir do unique_id.
 */
export function testNameFromUniqueId(uniqueId: string): string {
  return uniqueId.replace(/^test\.[^.]+\./, '').replace(/\.[0-9a-f]{6,}$/i, '');
}

lineageRouter.get('/', async (_req, res) => {
  try {
    const tenant = await loadTenantContext(getDataCoreUser(res).idEmpresa);
    res.json(await buildLineage(tenant));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao montar a linhagem.' });
  }
});

/** SQL (somente leitura) de um modelo do catálogo da empresa. */
lineageRouter.get('/sql', async (req, res) => {
  try {
    const name = String(req.query.model || '');
    const tenant = await loadTenantContext(getDataCoreUser(res).idEmpresa);
    const model = tenant.models.get(name);
    if (!model) {
      res.status(404).json({ error: `Modelo "${name}" não existe no catálogo da empresa.` });
      return;
    }
    res.json({
      name: model.name,
      layer: model.layer,
      dataset: model.dataset,
      sql: readModelSql(tenant, model),
      columns: model.columns,
      primaryKey: model.primaryKey,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao ler o modelo.' });
  }
});

/** _properties.yml real (documentação/testes) da entrada deste modelo — somente leitura. */
lineageRouter.get('/properties', async (req, res) => {
  try {
    const name = String(req.query.model || '');
    const tenant = await loadTenantContext(getDataCoreUser(res).idEmpresa);
    const model = tenant.models.get(name);
    if (!model) {
      res.status(404).json({ error: `Modelo "${name}" não existe no catálogo da empresa.` });
      return;
    }
    res.json({ yaml: readModelPropertiesYaml(tenant, model) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao ler a documentação do modelo.' });
  }
});

interface DbtRunParams {
  projectId: string;
  rawDataset: string;
  bronzeDataset: string;
  silverDataset: string;
  goldDataset: string;
  location?: string;
}

/** Datasets/projeto necessários pra rodar o dbt (build ou compile) sobre um modelo de
 *  qualquer camada — mesmo critério do build de Gold (silverDatasetsOf) pra achar a
 *  integração dona, generalizado pra Bronze/Silver (que já têm integrationId direto). */
function resolveDbtRunParams(tenant: TenantContext, model: CatalogModel): DbtRunParams | { error: string } {
  if (model.layer === 'gold') {
    const silvers = silverDatasetsOf(tenant, model);
    if (silvers.size === 0) return { error: 'Não foi possível identificar de qual Silver este Gold depende (nenhum ref() a um modelo Silver).' };
    if (silvers.size > 1) return { error: `Depende de Silvers em datasets diferentes (${[...silvers].join(', ')}): a execução usa um dataset Silver por vez e ainda não suporta isto.` };
    const silverDataset = [...silvers][0];
    const integ = tenant.integrations.find((i) => i.silverDataset === silverDataset);
    if (!integ) return { error: `Nenhuma integração da empresa usa o dataset ${silverDataset}.` };
    return {
      projectId: integ.projectId, rawDataset: integ.rawDataset, bronzeDataset: integ.bronzeDataset,
      silverDataset, goldDataset: model.dataset, location: integ.location || undefined,
    };
  }
  const integ = tenant.integrations.find((i) => i.id === model.integrationId);
  if (!integ) return { error: 'Integração não encontrada para este modelo.' };
  return {
    projectId: integ.projectId, rawDataset: integ.rawDataset, bronzeDataset: integ.bronzeDataset,
    silverDataset: integ.silverDataset, goldDataset: integ.goldDataset, location: integ.location || undefined,
  };
}

/**
 * `dbt compile` de verdade (não uma simulação) — renderiza o Jinja do modelo contra o
 * dataset real, sem materializar nada no BigQuery. Usado pela aba "SQL Compilado" do
 * editor do Studio Gold. Mesmo critério de permissão do build (spawna um processo dbt real).
 */
lineageRouter.post('/compile', async (req, res) => {
  const user = getDataCoreUser(res);
  if (!canSaveGoldModels(user.papel)) {
    res.status(403).json({ error: 'Seu perfil não pode compilar modelos dbt (requer administrador ou engenheiro de dados).' });
    return;
  }
  const name = String((req.body as { model?: unknown })?.model || '');
  if (!name) {
    res.status(400).json({ error: 'Campo "model" é obrigatório.' });
    return;
  }
  try {
    const tenant = await loadTenantContext(user.idEmpresa);
    const model = tenant.models.get(name);
    if (!model) {
      res.status(404).json({ error: `Modelo "${name}" não existe no catálogo da empresa.` });
      return;
    }
    const params = resolveDbtRunParams(tenant, model);
    if ('error' in params) {
      res.status(422).json({ error: params.error });
      return;
    }
    const run = await runDbt({ ...params, select: model.name, command: 'compile' });
    if (!run.ok) {
      res.status(422).json({ error: run.error || 'dbt compile falhou.', detail: run.stderrTail });
      return;
    }
    const sql = readCompiledModelSql(tenant, model);
    if (sql === null) {
      res.status(500).json({ error: 'dbt compile terminou sem erro, mas o arquivo compilado não foi encontrado.' });
      return;
    }
    res.json({ sql });
  } catch (err) {
    if (err instanceof DbtUnavailableError) { res.status(503).json({ error: err.message }); return; }
    res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao compilar o modelo.' });
  }
});

/** Sobrescreve o .sql (somente leitura antes) — abre o editor completo do Studio Gold
 *  a poder editar, não só ver. Mesmo critério de quem pode escrever no repositório dbt
 *  usado pelo build de Gold (admin/engenheiro de dados). */
lineageRouter.put('/sql', async (req, res) => {
  try {
    const user = getDataCoreUser(res);
    if (!canSaveGoldModels(user.papel)) {
      res.status(403).json({ error: 'Seu perfil não pode editar modelos dbt (requer administrador ou engenheiro de dados).' });
      return;
    }
    const name = String(req.query.model || '');
    const { sql } = req.body as { sql?: string };
    if (typeof sql !== 'string' || !sql.trim()) {
      res.status(400).json({ error: 'Campo "sql" (string não vazia) é obrigatório.' });
      return;
    }
    const tenant = await loadTenantContext(user.idEmpresa);
    const model = tenant.models.get(name);
    if (!model) {
      res.status(404).json({ error: `Modelo "${name}" não existe no catálogo da empresa.` });
      return;
    }
    const ok = writeModelSql(tenant, model, sql);
    if (!ok) {
      res.status(404).json({ error: `Modelo "${name}" não tem arquivo .sql real no projeto dbt.` });
      return;
    }
    res.json({ ok: true, name });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao salvar o modelo.' });
  }
});

interface GoldBuildResult {
  model: string;
  dataset: string | null;
  status: 'ok' | 'error';
  rowsAffected: number | null;
  error: string | null;
  tests: Array<{ name: string; status: string; message: string | null }>;
}

/**
 * Constrói modelos Gold com `dbt build` (modelo + os testes do _properties.yml).
 * O dbt resolve ref() pelo dataset Silver da EXECUÇÃO (DBT_SCHEMA_SILVER é um só por
 * chamada), então só constrói Golds cujas Silvers estejam num único dataset — os demais
 * voltam com erro explicando, em vez de compilar apontando para a tabela errada.
 */
lineageRouter.post('/gold/build', async (req, res) => {
  const user = getDataCoreUser(res);
  // Cria tabelas no BigQuery: mesmo critério de quem pode salvar modelos (admin/engenheiro).
  if (!canSaveGoldModels(user.papel)) {
    res.status(403).json({ error: 'Seu perfil não pode construir modelos Gold (requer administrador ou engenheiro de dados).' });
    return;
  }
  const raw = (req.body as { models?: unknown })?.models;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_BUILD_MODELS || raw.some((m) => typeof m !== 'string')) {
    res.status(400).json({ error: `Campo "models" (lista de 1 a ${MAX_BUILD_MODELS} nomes de modelo) é obrigatório.` });
    return;
  }

  try {
    const tenant = await loadTenantContext(user.idEmpresa);
    const results: GoldBuildResult[] = [];
    const fail = (model: string, dataset: string | null, error: string) =>
      results.push({ model, dataset, status: 'error', rowsAffected: null, error, tests: [] });

    const groups = new Map<string, CatalogModel[]>();
    for (const name of [...new Set(raw as string[])]) {
      const m = tenant.models.get(name);
      if (!m || m.layer !== 'gold') { fail(name, null, 'Não é um modelo Gold da sua empresa.'); continue; }
      const silvers = silverDatasetsOf(tenant, m);
      if (silvers.size === 0) { fail(name, m.dataset, 'Não foi possível identificar de qual Silver este Gold depende (nenhum ref() a um modelo Silver).'); continue; }
      if (silvers.size > 1) {
        fail(name, m.dataset, `Depende de Silvers em datasets diferentes (${[...silvers].join(', ')}): a construção via dbt usa um dataset Silver por execução e ainda não suporta isto.`);
        continue;
      }
      const key = [...silvers][0];
      groups.set(key, [...(groups.get(key) ?? []), m]);
    }

    for (const [silverDataset, models] of groups) {
      const integ = tenant.integrations.find((i) => i.silverDataset === silverDataset);
      if (!integ) { for (const m of models) fail(m.name, m.dataset, `Nenhuma integração da empresa usa o dataset ${silverDataset}.`); continue; }
      const run = await runDbt({
        projectId: tenant.projectId,
        rawDataset: integ.rawDataset,
        bronzeDataset: integ.bronzeDataset,
        silverDataset,
        goldDataset: models[0].dataset,
        location: integ.location || undefined,
        select: models.map((m) => m.name).join(' '),
      });
      for (const m of models) {
        const own = run.models.find((r) => r.uniqueId.startsWith('model.') && r.name === m.name);
        // Os testes do _properties.yml carregam o nome do modelo no nome (`not_null_<modelo>_<coluna>`).
        const tests = run.models
          .filter((r) => r.uniqueId.startsWith('test.'))
          .map((r) => ({ name: testNameFromUniqueId(r.uniqueId), status: r.status, message: r.message ?? null }))
          .filter((t) => t.name.includes(m.name));
        const ok = own?.status === 'success';
        results.push({
          model: m.name,
          dataset: m.dataset,
          status: ok ? 'ok' : 'error',
          rowsAffected: own?.rowsAffected ?? null,
          error: ok ? null : own?.message || run.error || run.stderrTail.split('\n').slice(-6).join('\n') || 'Falha ao construir o modelo.',
          tests,
        });
      }
    }
    res.status(results.some((r) => r.status === 'error') ? 207 : 200).json({ results });
  } catch (err) {
    if (err instanceof DbtUnavailableError) { res.status(503).json({ error: err.message }); return; }
    res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao construir o Gold.' });
  }
});

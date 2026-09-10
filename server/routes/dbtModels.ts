import { Router } from 'express';
import { airbyteFetch } from '../airbyteClient';
import {
  listGeneratedSlugs,
  removeIntegrationModels,
  slugFromConnectionId,
  slugIsValid,
  writeIntegrationModels,
  type IntegrationModelsSpec,
  type IntegrationTableSpec,
} from '../dbtCodegen';
import { getSupabaseAdmin } from '../supabaseAdmin';

export const dbtModelsRouter = Router();

// Gera/regenera os modelos dbt da camada Bronze de uma integração — um modelo
// por tabela em dbt/models/generated/<slug>/. Chamado pelo frontend logo após
// criar a conexão no Airbyte (AutoPipelineView.handleCreateAutoIntegration).
dbtModelsRouter.post('/', async (req, res) => {
  try {
    const spec = req.body as IntegrationModelsSpec;
    const result = await writeIntegrationModels(spec);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Falha ao gerar modelos dbt.' });
  }
});

interface StreamMeta {
  streamName: string;
  sourceDefinedPrimaryKey?: string[][];
}

interface IntegracaoRow {
  tabelas_selecionadas: string[] | null;
  table_sync_configs: Record<string, { loadType?: string; cursorField?: string; selectedColumns?: string[] }> | null;
  aplicar_sanitizacao_lgpd: boolean | null;
  origens: { airbyte_source_id: string | null } | { airbyte_source_id: string | null }[] | null;
  destinos: { tipo: string; configuracao: Record<string, unknown> } | { tipo: string; configuracao: Record<string, unknown> }[] | null;
}

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

// Reconstrói o spec a partir do estado persistido (Supabase) + PKs do Airbyte e
// regenera os modelos. É a garantia idempotente de que a integração tem seus
// modelos dbt — segura para retry manual e para o gatilho de orquestração
// (Airflow) que virá depois. Body: { connectionId }.
dbtModelsRouter.post('/from-integration', async (req, res) => {
  try {
    const { connectionId } = req.body as { connectionId?: string };
    if (!connectionId) {
      res.status(400).json({ error: 'Campo "connectionId" é obrigatório.' });
      return;
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('integracoes')
      .select('tabelas_selecionadas, table_sync_configs, aplicar_sanitizacao_lgpd, origens(airbyte_source_id), destinos(tipo, configuracao)')
      .eq('airbyte_connection_id', connectionId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) {
      res.status(404).json({ error: `Nenhuma integração com airbyte_connection_id="${connectionId}".` });
      return;
    }

    const row = data as unknown as IntegracaoRow;
    const destino = one(row.destinos);
    const origem = one(row.origens);
    if (!destino || destino.tipo !== 'bigquery') {
      res.status(422).json({ error: 'Integração não é BigQuery — sem camada Bronze / modelos dbt.' });
      return;
    }

    const cfg = destino.configuracao as { accountOrProject?: string; databaseOrDataset?: string };
    const projectId = cfg.accountOrProject;
    const rawDataset = cfg.databaseOrDataset;
    if (!projectId || !rawDataset) {
      res.status(422).json({ error: 'Destino BigQuery sem accountOrProject/databaseOrDataset.' });
      return;
    }

    const tableNames = row.tabelas_selecionadas || [];
    if (tableNames.length === 0) {
      res.status(422).json({ error: 'Integração sem tabelas selecionadas.' });
      return;
    }

    // PKs do Airbyte (best-effort — sem elas o modelo sai sem deduplicação CDC).
    const pkByStream = new Map<string, string[]>();
    const sourceId = origem?.airbyte_source_id;
    if (sourceId) {
      try {
        const streams = await airbyteFetch<StreamMeta[]>(`/streams?sourceId=${sourceId}`);
        for (const s of streams) {
          pkByStream.set(s.streamName, (s.sourceDefinedPrimaryKey || []).map((p) => p.join('.')));
        }
      } catch { /* segue sem PK */ }
    }

    const syncCfgs = row.table_sync_configs || {};
    const tables: IntegrationTableSpec[] = tableNames.map((name) => {
      const c = syncCfgs[name] || {};
      const loadType = c.loadType === 'incremental' ? 'incremental' : 'full_refresh';
      return {
        name,
        columns: c.selectedColumns || [],
        primaryKey: pkByStream.get(name) || [],
        cursorField: loadType === 'incremental' ? c.cursorField || null : null,
        loadType,
      };
    });

    const spec: IntegrationModelsSpec = {
      slug: slugFromConnectionId(connectionId),
      projectId,
      rawDataset,
      bronzeDataset: rawDataset.replace(/^raw_/, 'bronze_'),
      applyLgpd: row.aplicar_sanitizacao_lgpd ?? true,
      tables,
    };

    const result = await writeIntegrationModels(spec);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao regenerar modelos dbt.' });
  }
});

dbtModelsRouter.get('/', (_req, res) => {
  res.json({ slugs: listGeneratedSlugs() });
});

dbtModelsRouter.delete('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    if (!slugIsValid(slug)) {
      res.status(400).json({ error: 'slug inválido.' });
      return;
    }
    const result = await removeIntegrationModels(slug);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao remover modelos dbt.' });
  }
});

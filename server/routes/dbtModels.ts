import { Router } from 'express';
import {
  listGeneratedSlugs,
  removeIntegrationModels,
  slugIsValid,
  writeIntegrationModels,
  type IntegrationModelsSpec,
} from '../dbtCodegen';

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

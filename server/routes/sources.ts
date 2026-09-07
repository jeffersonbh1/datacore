import { Router } from 'express';
import { airbyteFetch } from '../airbyteClient';
import { SOURCE_CATALOG } from '../connectorCatalog';
import { handleAirbyteError } from '../handleAirbyteError';
import { buildSourceConfiguration } from '../sourceConfigBuilder';

export const sourcesRouter = Router();

sourcesRouter.get('/', async (_req, res) => {
  try {
    const workspaceId = process.env.AIRBYTE_WORKSPACE_ID || '';
    const data = await airbyteFetch(`/sources?workspaceIds=${workspaceId}`);
    res.json(data);
  } catch (err) {
    handleAirbyteError(res, err);
  }
});

sourcesRouter.post('/', async (req, res) => {
  try {
    const { name, catalogId, config } = req.body as {
      name: string;
      catalogId: string;
      config: Record<string, unknown>;
    };

    if (!name || !catalogId) {
      res.status(400).json({ error: 'Campos "name" e "catalogId" são obrigatórios.' });
      return;
    }

    const catalogEntry = SOURCE_CATALOG.find(c => c.id === catalogId);
    if (!catalogEntry) {
      res.status(400).json({ error: `Tipo de conector "${catalogId}" não suportado.` });
      return;
    }

    const configuration = buildSourceConfiguration(catalogEntry.airbyteSourceType, config || {});
    const workspaceId = process.env.AIRBYTE_WORKSPACE_ID || '';

    const data = await airbyteFetch('/sources', {
      method: 'POST',
      body: JSON.stringify({ name, workspaceId, configuration }),
    });

    res.status(201).json(data);
  } catch (err) {
    handleAirbyteError(res, err);
  }
});

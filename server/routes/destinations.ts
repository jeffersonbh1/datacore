import { Router } from 'express';
import { airbyteFetch } from '../airbyteClient';
import { handleAirbyteError } from '../handleAirbyteError';

export const destinationsRouter = Router();

destinationsRouter.get('/', async (_req, res) => {
  try {
    const workspaceId = process.env.AIRBYTE_WORKSPACE_ID || '';
    const data = await airbyteFetch(`/destinations?workspaceIds=${workspaceId}`);
    res.json(data);
  } catch (err) {
    handleAirbyteError(res, err);
  }
});

destinationsRouter.post('/', async (req, res) => {
  try {
    const { name, destinationType, config } = req.body as {
      name: string;
      destinationType: string;
      config: Record<string, unknown>;
    };

    if (!name || !destinationType) {
      res.status(400).json({ error: 'Campos "name" e "destinationType" são obrigatórios.' });
      return;
    }

    if (destinationType !== 'bigquery') {
      res.status(400).json({ error: `Criação real para o destino "${destinationType}" ainda não suportada.` });
      return;
    }

    const configuration = {
      destinationType,
      project_id: config?.projectId,
      dataset_id: config?.datasetId,
      dataset_location: config?.datasetLocation || 'US',
      credentials_json: config?.credentialsJson,
    };

    const workspaceId = process.env.AIRBYTE_WORKSPACE_ID || '';
    const data = await airbyteFetch('/destinations', {
      method: 'POST',
      body: JSON.stringify({ name, workspaceId, configuration }),
    });

    res.status(201).json(data);
  } catch (err) {
    handleAirbyteError(res, err);
  }
});

destinationsRouter.delete('/:destinationId', async (req, res) => {
  try {
    await airbyteFetch(`/destinations/${req.params.destinationId}`, { method: 'DELETE' });
    res.status(204).send();
  } catch (err) {
    handleAirbyteError(res, err);
  }
});

import { Router } from 'express';
import { airbyteFetch } from '../airbyteClient';
import { handleAirbyteError } from '../handleAirbyteError';

export const destinationsRouter = Router();

// Every tenant (empresa) gets its own Airbyte workspace (Fase 3 — see sql/001's
// empresas.airbyte_workspace_id). The caller passes it explicitly; falling back
// to the single shared AIRBYTE_WORKSPACE_ID keeps the original tenant (whose
// row was backfilled to this same id) and any not-yet-updated caller working.
function resolveWorkspaceId(candidate: unknown): string {
  return (typeof candidate === 'string' && candidate) || process.env.AIRBYTE_WORKSPACE_ID || '';
}

destinationsRouter.get('/', async (req, res) => {
  try {
    const workspaceId = resolveWorkspaceId(req.query.workspaceId);
    const data = await airbyteFetch(`/destinations?workspaceIds=${workspaceId}`);
    res.json(data);
  } catch (err) {
    handleAirbyteError(res, err);
  }
});

destinationsRouter.post('/', async (req, res) => {
  try {
    const { name, destinationType, config, workspaceId: workspaceIdInput } = req.body as {
      name: string;
      destinationType: string;
      config: Record<string, unknown>;
      workspaceId?: string;
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

    const workspaceId = resolveWorkspaceId(workspaceIdInput);
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

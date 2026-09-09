import { Router } from 'express';
import { airbyteFetch } from '../airbyteClient';
import { SOURCE_CATALOG } from '../connectorCatalog';
import { handleAirbyteError } from '../handleAirbyteError';
import { buildSourceConfiguration } from '../sourceConfigBuilder';

export const sourcesRouter = Router();

// Every tenant (empresa) gets its own Airbyte workspace (Fase 3 — see sql/001's
// empresas.airbyte_workspace_id). The caller passes it explicitly; falling back
// to the single shared AIRBYTE_WORKSPACE_ID keeps the original tenant (whose
// row was backfilled to this same id) and any not-yet-updated caller working.
function resolveWorkspaceId(candidate: unknown): string {
  return (typeof candidate === 'string' && candidate) || process.env.AIRBYTE_WORKSPACE_ID || '';
}

sourcesRouter.get('/', async (req, res) => {
  try {
    const workspaceId = resolveWorkspaceId(req.query.workspaceId);
    const data = await airbyteFetch(`/sources?workspaceIds=${workspaceId}`);
    res.json(data);
  } catch (err) {
    handleAirbyteError(res, err);
  }
});

sourcesRouter.post('/', async (req, res) => {
  try {
    const { name, catalogId, config, workspaceId: workspaceIdInput } = req.body as {
      name: string;
      catalogId: string;
      config: Record<string, unknown>;
      workspaceId?: string;
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
    const workspaceId = resolveWorkspaceId(workspaceIdInput);

    const data = await airbyteFetch('/sources', {
      method: 'POST',
      body: JSON.stringify({ name, workspaceId, configuration }),
    });

    res.status(201).json(data);
  } catch (err) {
    handleAirbyteError(res, err);
  }
});

sourcesRouter.delete('/:sourceId', async (req, res) => {
  try {
    await airbyteFetch(`/sources/${req.params.sourceId}`, { method: 'DELETE' });
    res.status(204).send();
  } catch (err) {
    handleAirbyteError(res, err);
  }
});

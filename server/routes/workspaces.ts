import { Router } from 'express';
import { airbyteFetch } from '../airbyteClient';
import { handleAirbyteError } from '../handleAirbyteError';

export const workspacesRouter = Router();

interface AirbyteWorkspace {
  workspaceId: string;
  name: string;
}

// Fase 3 (multi-tenant): each empresa gets its own Airbyte workspace so its
// sources/destinations/connections stay isolated from every other tenant's —
// today they'd all land in the single shared AIRBYTE_WORKSPACE_ID. Called once
// when an empresa is created (see EmpresasView.tsx); the resulting workspaceId
// is stored on empresas.airbyte_workspace_id and passed on every subsequent
// sources/destinations call for that tenant.
workspacesRouter.post('/', async (req, res) => {
  try {
    const { name } = req.body as { name?: string };
    if (!name) {
      res.status(400).json({ error: 'Campo "name" é obrigatório.' });
      return;
    }

    const data = await airbyteFetch<AirbyteWorkspace>('/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });

    res.status(201).json(data);
  } catch (err) {
    handleAirbyteError(res, err);
  }
});

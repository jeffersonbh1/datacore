import { Router } from 'express';
import { SOURCE_CATALOG } from '../connectorCatalog';

export const connectorsRouter = Router();

connectorsRouter.get('/sources', (_req, res) => {
  res.json({ data: SOURCE_CATALOG });
});

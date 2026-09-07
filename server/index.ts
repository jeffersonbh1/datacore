import './loadEnv';

import cors from 'cors';
import express from 'express';
import { requireGatewayApiKey } from './authMiddleware';
import { connectorsRouter } from './routes/connectors';
import { destinationsRouter } from './routes/destinations';
import { sourcesRouter } from './routes/sources';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/connectors', requireGatewayApiKey, connectorsRouter);
app.use('/api/airbyte/sources', requireGatewayApiKey, sourcesRouter);
app.use('/api/airbyte/destinations', requireGatewayApiKey, destinationsRouter);

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => {
  console.log(`airbyte-gateway listening on port ${port}`);
});

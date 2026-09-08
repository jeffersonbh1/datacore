import './loadEnv';

import cors from 'cors';
import express from 'express';
import { requireGatewayApiKey } from './authMiddleware';
import { connectionsRouter } from './routes/connections';
import { connectorsRouter } from './routes/connectors';
import { destinationsRouter } from './routes/destinations';
import { sourcesRouter } from './routes/sources';
import { streamsRouter } from './routes/streams';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/connectors', requireGatewayApiKey, connectorsRouter);
app.use('/api/airbyte/sources', requireGatewayApiKey, sourcesRouter);
app.use('/api/airbyte/destinations', requireGatewayApiKey, destinationsRouter);
app.use('/api/airbyte/streams', requireGatewayApiKey, streamsRouter);
app.use('/api/airbyte/connections', requireGatewayApiKey, connectionsRouter);

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => {
  console.log(`airbyte-gateway listening on port ${port}`);
});

import { Router } from 'express';
import { airbyteFetch } from '../airbyteClient';
import { handleAirbyteError } from '../handleAirbyteError';

export const streamsRouter = Router();

export interface AirbyteStream {
  streamName: string;
  defaultCursorField?: string[];
  sourceDefinedCursorField?: boolean;
  sourceDefinedPrimaryKey?: string[][];
  propertyFields: string[][];
}

streamsRouter.get('/', async (req, res) => {
  try {
    const sourceId = req.query.sourceId as string | undefined;
    if (!sourceId) {
      res.status(400).json({ error: 'Parâmetro "sourceId" é obrigatório.' });
      return;
    }

    const data = await airbyteFetch<AirbyteStream[]>(`/streams?sourceId=${sourceId}`);
    res.json({ data });
  } catch (err) {
    handleAirbyteError(res, err);
  }
});

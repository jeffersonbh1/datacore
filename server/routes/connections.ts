import { Router } from 'express';
import { airbyteFetch } from '../airbyteClient';
import { handleAirbyteError } from '../handleAirbyteError';
import type { AirbyteStream } from './streams';

export const connectionsRouter = Router();

type WriteMode = 'append' | 'merge_upsert' | 'overwrite';

function buildDailyCronExpression(dailyTime: string): string {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(dailyTime);
  const [hour, minute] = match ? [Number(match[1]), Number(match[2])] : [2, 0];
  return `0 ${minute} ${hour} * * ? UTC`;
}

function pickSyncMode(writeMode: WriteMode, hasPrimaryKey: boolean, hasCursor: boolean): string {
  if (writeMode === 'merge_upsert' && hasPrimaryKey && hasCursor) return 'incremental_deduped_history';
  if (writeMode === 'append' && hasCursor) return 'incremental_append';
  if (writeMode === 'append') return 'full_refresh_append';
  return 'full_refresh_overwrite';
}

connectionsRouter.post('/', async (req, res) => {
  try {
    const { name, sourceId, destinationId, streamNames, writeMode, dailyTime } = req.body as {
      name: string;
      sourceId: string;
      destinationId: string;
      streamNames: string[];
      writeMode: WriteMode;
      dailyTime?: string;
    };

    if (!name || !sourceId || !destinationId || !streamNames?.length) {
      res.status(400).json({ error: 'Campos "name", "sourceId", "destinationId" e "streamNames" são obrigatórios.' });
      return;
    }

    const discovered = await airbyteFetch<AirbyteStream[]>(`/streams?sourceId=${sourceId}`);
    const byName = new Map(discovered.map(s => [s.streamName, s]));

    const streams = streamNames.map(streamName => {
      const meta = byName.get(streamName);
      const hasPrimaryKey = Boolean(meta?.sourceDefinedPrimaryKey?.length);
      const hasCursor = Boolean(meta?.defaultCursorField?.length);
      const syncMode = pickSyncMode(writeMode || 'overwrite', hasPrimaryKey, hasCursor);

      const stream: Record<string, unknown> = { name: streamName, syncMode };
      if (syncMode === 'incremental_deduped_history' || syncMode === 'incremental_append') {
        stream.cursorField = meta?.defaultCursorField;
      }
      if (syncMode === 'incremental_deduped_history') {
        stream.primaryKey = meta?.sourceDefinedPrimaryKey;
      }
      return stream;
    });

    const data = await airbyteFetch('/connections', {
      method: 'POST',
      body: JSON.stringify({
        name,
        sourceId,
        destinationId,
        configurations: { streams },
        schedule: { scheduleType: 'cron', cronExpression: buildDailyCronExpression(dailyTime || '02:00') },
      }),
    });

    res.status(201).json(data);
  } catch (err) {
    handleAirbyteError(res, err);
  }
});

import { Router } from 'express';
import { airbyteFetch } from '../airbyteClient';
import { handleAirbyteError } from '../handleAirbyteError';
import type { AirbyteStream } from './streams';

export const connectionsRouter = Router();

type WriteMode = 'append' | 'merge_upsert' | 'overwrite';
type LoadType = 'full_refresh' | 'incremental';
type ScheduleFrequency = 'daily' | 'weekly' | 'monthly' | 'once';

interface StreamSyncInput {
  name: string;
  loadType: LoadType;
  cursorField?: string;
  columns?: string[];
}

interface ScheduleInput {
  frequency: ScheduleFrequency;
  executionTimes: string[];
  /** Only for "weekly". Unix cron convention: '0'-'6', Sunday = '0' (matches the wizard's weekday picker). */
  weeklyDays?: string[];
  /** Only for "monthly". Day of month, 1-31. */
  monthlyDay?: number;
}

function parseTime(time: string): { hour: number; minute: number } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : { hour: 2, minute: 0 };
}

// Airbyte (Quartz cron) accepts a single expression per connection — it can't represent
// independent HH:MM pairs. When every configured time shares the same minute we fold them
// into one hour list (e.g. "0 8,14 * * ? UTC"); otherwise we fall back to the first time,
// same as the previous daily-only implementation did.
function buildTimeFields(executionTimes: string[]): { minute: number; hourList: string } {
  const parsed = (executionTimes.length ? executionTimes : ['02:00']).map(parseTime);
  const uniqueMinutes = Array.from(new Set(parsed.map(p => p.minute)));

  if (uniqueMinutes.length === 1) {
    const hours = Array.from(new Set(parsed.map(p => p.hour))).sort((a, b) => a - b);
    return { minute: uniqueMinutes[0], hourList: hours.join(',') };
  }

  return { minute: parsed[0].minute, hourList: String(parsed[0].hour) };
}

function buildAirbyteSchedule(input: ScheduleInput): { scheduleType: 'cron' | 'manual'; cronExpression?: string } {
  if (input.frequency === 'once') {
    // Airbyte has no native "run once in the future" schedule — only recurring cron or
    // manual. The connection is created in manual mode; the sync must be triggered by hand
    // (or by a future scheduler feature) at the chosen date/time.
    return { scheduleType: 'manual' };
  }

  const { minute, hourList } = buildTimeFields(input.executionTimes);

  if (input.frequency === 'weekly') {
    const days = (input.weeklyDays?.length ? input.weeklyDays : ['1'])
      .map(d => String(Number(d) + 1)) // Unix 0-6 (Sun=0) -> Quartz day-of-week 1-7 (Sun=1)
      .join(',');
    return { scheduleType: 'cron', cronExpression: `0 ${minute} ${hourList} ? * ${days} UTC` };
  }

  if (input.frequency === 'monthly') {
    const day = input.monthlyDay && input.monthlyDay >= 1 && input.monthlyDay <= 31 ? input.monthlyDay : 1;
    return { scheduleType: 'cron', cronExpression: `0 ${minute} ${hourList} ${day} * ? UTC` };
  }

  // daily
  return { scheduleType: 'cron', cronExpression: `0 ${minute} ${hourList} * * ? UTC` };
}

function pickSyncMode(writeMode: WriteMode, loadType: LoadType, hasPrimaryKey: boolean): string {
  if (loadType === 'incremental') {
    if (writeMode === 'merge_upsert' && hasPrimaryKey) return 'incremental_deduped_history';
    return 'incremental_append';
  }
  if (writeMode === 'append') return 'full_refresh_append';
  return 'full_refresh_overwrite';
}

connectionsRouter.post('/', async (req, res) => {
  try {
    const { name, sourceId, destinationId, streams: streamInputs, writeMode, schedule } = req.body as {
      name: string;
      sourceId: string;
      destinationId: string;
      streams: StreamSyncInput[];
      writeMode: WriteMode;
      schedule: ScheduleInput;
    };

    if (!name || !sourceId || !destinationId || !streamInputs?.length || !schedule?.frequency) {
      res.status(400).json({ error: 'Campos "name", "sourceId", "destinationId", "streams" e "schedule" são obrigatórios.' });
      return;
    }

    for (const s of streamInputs) {
      if (s.loadType === 'incremental' && !s.cursorField) {
        res.status(400).json({ error: `Campo de cursor é obrigatório para a tabela "${s.name}" em carga incremental.` });
        return;
      }
    }

    const discovered = await airbyteFetch<AirbyteStream[]>(`/streams?sourceId=${sourceId}`);
    const byName = new Map(discovered.map(s => [s.streamName, s]));

    const streams = streamInputs.map(input => {
      const meta = byName.get(input.name);
      const hasPrimaryKey = Boolean(meta?.sourceDefinedPrimaryKey?.length);
      const syncMode = pickSyncMode(writeMode || 'overwrite', input.loadType, hasPrimaryKey);

      const stream: Record<string, unknown> = { name: input.name, syncMode };
      if (syncMode === 'incremental_deduped_history' || syncMode === 'incremental_append') {
        stream.cursorField = (input.cursorField || '').split('.');
      }
      if (syncMode === 'incremental_deduped_history') {
        stream.primaryKey = meta?.sourceDefinedPrimaryKey;
      }

      const allColumns = meta?.propertyFields.map(p => p.join('.')) || [];
      if (input.columns && allColumns.length > 0 && input.columns.length < allColumns.length) {
        stream.selectedFields = input.columns.map(col => ({ fieldPath: col.split('.') }));
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
        schedule: buildAirbyteSchedule(schedule),
      }),
    });

    res.status(201).json(data);
  } catch (err) {
    handleAirbyteError(res, err);
  }
});

interface AirbyteJob {
  jobId: number;
  status: 'pending' | 'running' | 'incomplete' | 'failed' | 'succeeded' | 'cancelled';
  jobType: 'sync' | 'reset' | 'clear' | 'refresh';
  connectionId: string;
  startTime: string;
  lastUpdatedTime?: string;
  duration?: string;
  bytesSynced?: number;
  rowsSynced?: number;
}

// Real sync/execution history for a connection — the source of truth Fase 2's
// pipeline_runs is populated from (see src/lib/pipelineRuns.ts), instead of the
// static placeholder metrics the canvas used to show.
connectionsRouter.get('/:connectionId/jobs', async (req, res) => {
  try {
    const { connectionId } = req.params;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const data = await airbyteFetch<{ data: AirbyteJob[] }>(
      `/jobs?connectionId=${connectionId}&jobType=sync&limit=${limit}`
    );
    res.json(data);
  } catch (err) {
    handleAirbyteError(res, err);
  }
});

// Pauses/resumes a connection's own Airbyte schedule (independent from DataCore's
// "integracoes.status" flag in Supabase — that flag alone does NOT stop a
// scheduled sync from running, only this does).
connectionsRouter.patch('/:connectionId', async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { status } = req.body as { status?: 'active' | 'inactive' };

    if (status !== 'active' && status !== 'inactive') {
      res.status(400).json({ error: 'Campo "status" deve ser "active" ou "inactive".' });
      return;
    }

    const data = await airbyteFetch(`/connections/${connectionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });

    res.json(data);
  } catch (err) {
    handleAirbyteError(res, err);
  }
});

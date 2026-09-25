import { Router } from 'express';
import { airbyteFetch } from '../airbyteClient';
import { handleAirbyteError } from '../handleAirbyteError';
import { SCHEMA_CHANGE_POLICY, diagnoseSyncFailure } from '../rawFailurePolicy';
import { getSupabaseAdmin } from '../supabaseAdmin';
import { checkSchemaChanges } from '../schemaChangeCheck';
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

// Configuração de cada stream no formato do Airbyte (syncMode, cursor, PK e
// colunas) a partir do que o assistente pede. Usado na criação da conexão e na
// inclusão de tabelas numa conexão existente (PUT /:connectionId/streams).
async function buildStreamConfigurations(
  sourceId: string,
  streamInputs: StreamSyncInput[],
  writeMode: WriteMode,
  /** Consulta a origem de novo em vez do catálogo guardado (tabelas recém-criadas). */
  refresh = false,
): Promise<Record<string, unknown>[]> {
  const discovered = await airbyteFetch<AirbyteStream[]>(`/streams?sourceId=${sourceId}${refresh ? '&ignoreCache=true' : ''}`);
  const byName = new Map(discovered.map(s => [s.streamName, s]));

  return streamInputs.map(input => {
    const meta = byName.get(input.name);
    const hasPrimaryKey = Boolean(meta?.sourceDefinedPrimaryKey?.length);
    const syncMode = pickSyncMode(writeMode, input.loadType, hasPrimaryKey);

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
}

connectionsRouter.post('/', async (req, res) => {
  try {
    const { name, sourceId, destinationId, streams: streamInputs, writeMode, schedule, datasetOverride } = req.body as {
      name: string;
      sourceId: string;
      destinationId: string;
      streams: StreamSyncInput[];
      writeMode: WriteMode;
      schedule: ScheduleInput;
      /** BigQuery dataset onde esta connection deve gravar — omitido usa o
       *  dataset padrão do destino. Ver createAirbyteConnection em airbyteGateway.ts. */
      datasetOverride?: string;
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

    const streams = await buildStreamConfigurations(sourceId, streamInputs, writeMode || 'overwrite');

    // "raw_" on every destination table name (not just the raw_ dataset itself) —
    // so a table is identifiable as raw layer even outside its dataset's context.
    // Airbyte prepends this to every stream's destination table on sync.
    //
    // Sem namespaceDefinition/namespaceFormat, o Airbyte grava toda connection
    // no dataset PADRÃO já configurado no destino — datasetOverride é o que
    // permite duas integrações com a mesma origem/destino gravarem em datasets
    // diferentes de fato (não só no cadastro do DataCore). Ver reference.airbyte.com/reference/createconnection.
    const namespaceFields = datasetOverride
      ? { namespaceDefinition: 'custom_format' as const, namespaceFormat: datasetOverride }
      : {};

    const data = await airbyteFetch('/connections', {
      method: 'POST',
      body: JSON.stringify({
        name,
        sourceId,
        destinationId,
        configurations: { streams },
        schedule: buildAirbyteSchedule(schedule),
        prefix: 'raw_',
        // Política de mudança de schema da Raw — ver server/rawFailurePolicy.ts.
        ...SCHEMA_CHANGE_POLICY,
        ...namespaceFields,
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

// Dispara uma sincronização manual imediata (POST /jobs, jobType=sync). Usado para
// executar a integração assim que ela é criada — o agendamento (cron) do bloco
// "Frequência de Sincronização" está desativado nesta versão (ver AutoPipelineView),
// então a única forma de a sincronização acontecer de imediato é este disparo manual.
connectionsRouter.post('/:connectionId/sync', async (req, res) => {
  try {
    const { connectionId } = req.params;
    const data = await airbyteFetch('/jobs', {
      method: 'POST',
      body: JSON.stringify({ connectionId, jobType: 'sync' }),
    });
    res.status(201).json(data);
  } catch (err) {
    handleAirbyteError(res, err);
  }
});

// Real sync/execution history for a connection — the source of truth Fase 2's
// pipeline_runs is populated from (see src/lib/pipelineRuns.ts), instead of the
// static placeholder metrics the canvas used to show.
connectionsRouter.get('/:connectionId/jobs', async (req, res) => {
  try {
    const { connectionId } = req.params;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    // orderBy=createdAt|DESC: sem isso o Airbyte devolve os jobs mais ANTIGOS
    // primeiro — uma conexão com mais jobs históricos que `limit` faria o job
    // recém-disparado nunca aparecer na resposta (waitForSyncToFinish no Studio
    // e a reconciliação da tela Execuções dependem de sempre ver o mais recente).
    const data = await airbyteFetch<{ data: AirbyteJob[] }>(
      `/jobs?connectionId=${connectionId}&jobType=sync&limit=${limit}&orderBy=${encodeURIComponent('createdAt|DESC')}`
    );
    res.json(data);
  } catch (err) {
    handleAirbyteError(res, err);
  }
});

// O GET da conexão devolve campos vazios que o PATCH não aceita de volta — ex.:
// selectedFields: [] (= "todas as colunas" na leitura) é recusado no PATCH como
// "No fields selected for stream X". Reenvia só a configuração que importa e
// omite listas vazias, que o Airbyte interpreta como o padrão (todas as colunas,
// cursor/PK definidos pela origem).
function toStreamPatch(stream: Record<string, unknown> & { name: string }): Record<string, unknown> {
  const out: Record<string, unknown> = { name: stream.name };
  if (stream.syncMode) out.syncMode = stream.syncMode;
  for (const key of ['cursorField', 'primaryKey', 'selectedFields', 'mappers'] as const) {
    const value = stream[key];
    if (Array.isArray(value) && value.length > 0) out[key] = value;
  }
  return out;
}

// Edição de uma integração (tela Pipeline Automático, modo edição): inclui e/ou
// remove tabelas (streams) de uma conexão existente. As streams que ficam são
// devolvidas ao Airbyte exatamente como estão (mesmo syncMode/cursor/PK/colunas);
// só as novas são montadas por buildStreamConfigurations. O PATCH do Airbyte
// substitui a lista inteira de streams, por isso a lista completa é enviada.
connectionsRouter.put('/:connectionId/streams', async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { add = [], remove = [], writeMode } = (req.body || {}) as {
      add?: StreamSyncInput[];
      remove?: string[];
      writeMode?: WriteMode;
    };

    for (const s of add) {
      if (s.loadType === 'incremental' && !s.cursorField) {
        res.status(400).json({ error: `Campo de cursor é obrigatório para a tabela "${s.name}" em carga incremental.` });
        return;
      }
    }

    const current = await airbyteFetch<{
      sourceId: string;
      configurations?: { streams?: Array<Record<string, unknown> & { name: string }> };
    }>(`/connections/${connectionId}`);

    const removeSet = new Set(remove);
    const kept = (current.configurations?.streams || []).filter(s => !removeSet.has(s.name));
    const keptNames = new Set(kept.map(s => s.name));
    const toAdd = add.filter(s => !keptNames.has(s.name));

    if (kept.length + toAdd.length === 0) {
      res.status(400).json({ error: 'A integração precisa manter pelo menos uma tabela.' });
      return;
    }

    // refresh: a tabela incluída pode ter sido criada na origem depois da última descoberta.
    const added = toAdd.length ? await buildStreamConfigurations(current.sourceId, toAdd, writeMode || 'overwrite', true) : [];

    const data = await airbyteFetch(`/connections/${connectionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ configurations: { streams: [...kept.map(toStreamPatch), ...added] } }),
    });
    res.json(data);
  } catch (err) {
    handleAirbyteError(res, err);
  }
});

// Verifica se o schema da origem mudou desde a última verificação e grava um
// alerta por mudança (ver server/schemaChangeCheck.ts). Leva o tempo de uma
// descoberta no Airbyte (~15-40 s).
connectionsRouter.post('/:connectionId/schema-check', async (req, res) => {
  try {
    res.json(await checkSchemaChanges(req.params.connectionId));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao verificar o schema da origem.' });
  }
});

// Motivo real da falha de um job de sync (a API pública só devolve 'failed'),
// já classificado e com a ação recomendada — ver server/rawFailurePolicy.ts.
connectionsRouter.get('/:connectionId/jobs/:jobId/diagnosis', async (req, res) => {
  const jobId = Number(req.params.jobId);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    res.status(400).json({ error: 'jobId inválido.' });
    return;
  }
  res.json(await diagnoseSyncFailure(req.params.connectionId, jobId));
});

// Aplica a política de mudança de schema (SCHEMA_CHANGE_POLICY) às conexões que
// já existiam antes dela. Sem corpo: todas as integrações com conexão no
// Airbyte; com { connectionIds: [...] }: só essas. Idempotente.
connectionsRouter.post('/schema-policy', async (req, res) => {
  try {
    let connectionIds = (req.body as { connectionIds?: string[] } | undefined)?.connectionIds;
    if (!connectionIds?.length) {
      const { data, error } = await getSupabaseAdmin()
        .from('integracoes')
        .select('airbyte_connection_id')
        .not('airbyte_connection_id', 'is', null);
      if (error) throw new Error(error.message);
      connectionIds = Array.from(new Set((data || []).map(r => String(r.airbyte_connection_id))));
    }

    const results: Array<{ connectionId: string; ok: boolean; error?: string }> = [];
    for (const connectionId of connectionIds) {
      try {
        await airbyteFetch(`/connections/${connectionId}`, {
          method: 'PATCH',
          body: JSON.stringify(SCHEMA_CHANGE_POLICY),
        });
        results.push({ connectionId, ok: true });
      } catch (err) {
        results.push({ connectionId, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    res.json({ policy: SCHEMA_CHANGE_POLICY, results });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao aplicar a política de schema.' });
  }
});

// Pauses/resumes a connection's own Airbyte schedule (independent from DataCore's
// "integracoes.status" flag in Supabase — that flag alone does NOT stop a
// scheduled sync from running, only this does) e/ou muda o dataset BigQuery de
// uma connection JÁ EXISTENTE sem precisar recriá-la — mesmo mecanismo de
// datasetOverride do POST '/' acima (ver sql/012_integracoes_dataset_override.sql).
connectionsRouter.patch('/:connectionId', async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { status, datasetOverride } = req.body as {
      status?: 'active' | 'inactive';
      datasetOverride?: string;
    };

    if (status !== undefined && status !== 'active' && status !== 'inactive') {
      res.status(400).json({ error: 'Campo "status" deve ser "active" ou "inactive".' });
      return;
    }
    if (status === undefined && !datasetOverride) {
      res.status(400).json({ error: 'Informe "status" e/ou "datasetOverride".' });
      return;
    }

    const patchBody: Record<string, unknown> = {};
    if (status !== undefined) patchBody.status = status;
    if (datasetOverride) {
      patchBody.namespaceDefinition = 'custom_format';
      patchBody.namespaceFormat = datasetOverride;
    }

    const data = await airbyteFetch(`/connections/${connectionId}`, {
      method: 'PATCH',
      body: JSON.stringify(patchBody),
    });

    res.json(data);
  } catch (err) {
    handleAirbyteError(res, err);
  }
});

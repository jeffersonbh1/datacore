import { Pipeline } from '../types';
import { buildBronzeLayer, buildSilverLayer, fetchConnectionJobs, fetchSyncFailureDiagnosis, triggerAirbyteSync, type AirbyteJob } from './airbyteGateway';
import { rawErrorText, recordRawFailure } from './ingestionAlerts';
import { summarizeTableFailures } from './pipelineBuilder';
import { updatePipelineRunLayerStatus, upsertPipelineRuns } from './supabase';
import { buildGoldModels, collect, topoOrder, type LineageIndex, type LineageIntegration } from './lineage';
import type { ExecItem } from './studioExecutions';

// -----------------------------------------------------------------------------
// "Executar fluxo até aqui" da tela Studio Visual ETL Gold. Mesma sequência e mesmas
// regras do Studio (VisualCanvas.handleExecutePipeline): sincroniza a Raw no Airbyte,
// espera, constrói a Bronze e depois a Silver — e acrescenta o Gold no fim. Cada
// camada só roda para o que deu certo na anterior, e um Gold só é construído se tudo
// que ele consome (mesmo em outra integração) está íntegro.
// -----------------------------------------------------------------------------

export type RunState = 'running' | 'success' | 'error' | 'skipped';
export type ExecScope = 'tabela' | 'fluxo';

export interface PlanIntegration {
  integration: LineageIntegration;
  pipeline: Pipeline | null;
  /** Origem + Raw desta integração dentro do fluxo. */
  syncNodeIds: string[];
  bronze: Array<{ nodeId: string; table: string }>;
  silver: Array<{ nodeId: string; table: string }>;
}

export interface PlanGold {
  nodeId: string;
  name: string;
  /** Motivo pelo qual este Gold não pode ser construído agora (ou null). */
  blocked: string | null;
}

export interface ExecPlan {
  focusId: string;
  /** 'tabela' = só o próprio modelo (nada do que o alimenta); 'fluxo' = ele + tudo que o alimenta. */
  scope: ExecScope;
  integrations: PlanIntegration[];
  /** Em ordem de dependência (o que é consumido vem antes). */
  gold: PlanGold[];
  /** Só no escopo 'tabela': entradas diretas que ainda não foram construídas no BigQuery (a construção tende a falhar). */
  unbuiltInputs: string[];
  /** `--full-refresh`: reconstrói do zero (equivalente ao "Do zero" do Studio Visual ETL) — Bronze/Silver
   *  incrementais reprocessam tudo em vez de só o incremento; Gold é sempre `table`, então na prática já
   *  reconstrói inteiro a cada build, mas a flag é repassada mesmo assim por completude/consistência. */
  fullRefresh?: boolean;
}

/**
 * O que precisa rodar para o nó escolhido ficar atualizado. Escopo 'fluxo' (padrão): ele mesmo + tudo que o
 * alimenta. Escopo 'tabela': SÓ ele — usa o que já está construído nas camadas anteriores, sem sincronizar nem
 * reconstruir nada além dele.
 */
export function buildPlan(index: LineageIndex, focusId: string, integrations: LineageIntegration[], pipelines: Pipeline[], scope: ExecScope = 'fluxo', fullRefresh = false): ExecPlan {
  const ids = scope === 'tabela' ? new Set([focusId]) : new Set([...collect(index, focusId, 'up'), focusId]);
  const byIntegration = new Map<number, PlanIntegration>();
  const ensure = (id: number): PlanIntegration | null => {
    const known = byIntegration.get(id);
    if (known) return known;
    const integration = integrations.find((i) => i.id === id);
    if (!integration) return null;
    const created: PlanIntegration = {
      integration,
      pipeline: pipelines.find((p) => p.integrationId === id) ?? null,
      syncNodeIds: [], bronze: [], silver: [],
    };
    byIntegration.set(id, created);
    return created;
  };

  for (const id of ids) {
    const n = index.byId.get(id)!;
    if (n.integrationId === null) continue;
    const pi = ensure(n.integrationId);
    if (!pi) continue;
    if (n.layer === 'source' || n.layer === 'raw') pi.syncNodeIds.push(id);
    else if (n.layer === 'bronze' && n.table) pi.bronze.push({ nodeId: id, table: n.table });
    else if (n.layer === 'silver' && n.table) pi.silver.push({ nodeId: id, table: n.table });
  }

  const goldIds = new Set([...ids].filter((id) => index.byId.get(id)!.layer === 'gold'));
  const gold: PlanGold[] = topoOrder(index, goldIds).map((id) => {
    const silverDatasets = new Set(
      [...collect(index, id, 'up')].map((a) => index.byId.get(a)!).filter((n) => n.layer === 'silver' && n.dataset).map((n) => n.dataset!),
    );
    const blocked = silverDatasets.size === 0
      ? 'Não depende de nenhuma Silver (ref) — não dá para saber de onde ler.'
      : silverDatasets.size > 1
        ? `Depende de Silvers em datasets diferentes (${[...silverDatasets].join(', ')}): a construção via dbt usa um dataset Silver por execução e ainda não suporta isto.`
        : null;
    return { nodeId: id, name: index.byId.get(id)!.name, blocked };
  });

  const unbuiltInputs = scope === 'tabela'
    ? (index.parents.get(focusId) ?? []).map((id) => index.byId.get(id)).filter((n) => n && n.layer !== 'source' && n.built === false).map((n) => n!.name)
    : [];

  return { focusId, scope, integrations: [...byIntegration.values()], gold, unbuiltInputs, fullRefresh };
}

export interface RunHooks {
  log: (message: string, level?: 'info' | 'warn' | 'error') => void;
  setState: (nodeIds: string[], state: RunState) => void;
  isCancelled: () => boolean;
  /** Resultado final de UMA tabela (ou da sincronização de uma integração) — alimenta o histórico da tela Execuções. */
  record?: (item: ExecItem) => void;
}

interface SyncOutcome { ok: boolean; jobId: number | null }

async function waitForSync(connectionId: string, jobId: number, hooks: RunHooks, timeoutMs = 10 * 60 * 1000): Promise<{ state: 'success' | 'error' | 'timeout' | 'cancelled'; job: AirbyteJob | null }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (hooks.isCancelled()) return { state: 'cancelled', job: null };
    const jobs = await fetchConnectionJobs(connectionId, 10);
    const job = jobs.find((j) => j.jobId === jobId);
    // 'pending' e 'running' são os únicos estados não-terminais.
    if (job && job.status !== 'pending' && job.status !== 'running') {
      return { state: job.status === 'succeeded' ? 'success' : 'error', job };
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return { state: 'timeout', job: null };
}

export interface RunOptions {
  includeSync: boolean;
  idEmpresa: number | null;
  index: LineageIndex;
}

export async function runPlan(plan: ExecPlan, opts: RunOptions, hooks: RunHooks): Promise<{ ok: boolean; cancelled: boolean }> {
  const failed = new Set<string>(); // nós cuja construção falhou (ou cuja origem falhou)
  const jobByIntegration = new Map<number, { jobId: number; dbId: number | null }>();
  let cancelled = false;
  const canPersist = (pi: PlanIntegration) => Boolean(opts.idEmpresa && pi.pipeline?.dbId);
  const safe = async (label: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (err) { console.error(`Erro ao registrar ${label}:`, err); }
  };
  const nodeName = (nodeId: string) => opts.index.byId.get(nodeId)?.name ?? nodeId;
  const rec = (
    layer: ExecItem['layer'], name: string, integration: string | null, status: ExecItem['status'],
    extra: { rowsAffected?: number | null; error?: string | null; tests?: ExecItem['tests'] } = {},
  ) => hooks.record?.({ layer, name, integration, status, rowsAffected: extra.rowsAffected ?? null, error: extra.error ?? null, tests: extra.tests ?? null });

  // ---- A) Sincronização real da Raw (todas as integrações em paralelo)
  if (opts.includeSync) {
    await Promise.all(plan.integrations.map(async (pi): Promise<SyncOutcome> => {
      const name = pi.integration.nome;
      const connectionId = pi.pipeline?.airbyteConnectionId || pi.integration.airbyteConnectionId;
      if (!connectionId) {
        hooks.log(`${name}: sem conexão real no Airbyte — sincronização pulada; segue com o que já está na Raw.`, 'warn');
        rec('raw', name, name, 'skipped', { error: 'Sem conexão real no Airbyte — seguiu com o que já estava na Raw.' });
        return { ok: true, jobId: null };
      }
      hooks.setState(pi.syncNodeIds, 'running');
      hooks.log(`${name}: disparando a sincronização no Airbyte…`);
      try {
        const triggered = await triggerAirbyteSync(connectionId);
        jobByIntegration.set(pi.integration.id, { jobId: triggered.jobId, dbId: pi.pipeline?.dbId ?? null });
        if (canPersist(pi)) {
          await safe('o início da sincronização', () => upsertPipelineRuns(opts.idEmpresa!, pi.pipeline!.dbId!, [{
            jobId: triggered.jobId, status: (triggered.status as AirbyteJob['status']) || 'pending',
            jobType: 'sync', connectionId, startTime: new Date().toISOString(),
          }]));
        }
        const { state, job } = await waitForSync(connectionId, triggered.jobId, hooks);
        if (job && canPersist(pi)) await safe('o resultado da sincronização', () => upsertPipelineRuns(opts.idEmpresa!, pi.pipeline!.dbId!, [job]));
        if (state === 'success') {
          hooks.setState(pi.syncNodeIds, 'success');
          hooks.log(`${name}: sincronização concluída.`);
          rec('raw', name, name, 'ok', { rowsAffected: job?.rowsSynced ?? null });
          return { ok: true, jobId: triggered.jobId };
        }
        if (state === 'cancelled') { cancelled = true; hooks.setState(pi.syncNodeIds, 'skipped'); return { ok: false, jobId: triggered.jobId }; }
        hooks.setState(pi.syncNodeIds, 'error');
        // Política de falha da Raw (server/rawFailurePolicy.ts): busca o motivo real
        // da falha, registra o alerta para a empresa e mantém Bronze/Silver no último
        // dado bom (não são construídas). Timeout não tem motivo — o job segue rodando.
        let errorText = 'A sincronização não terminou a tempo (10 min).';
        if (state === 'error') {
          const diagnosis = await fetchSyncFailureDiagnosis(connectionId, triggered.jobId).catch(() => null);
          errorText = diagnosis ? rawErrorText(diagnosis) : 'A sincronização falhou no Airbyte.';
          if (diagnosis && opts.idEmpresa) {
            await safe('o alerta da falha da Raw', () => recordRawFailure({
              idEmpresa: opts.idEmpresa!, integracaoId: pi.integration.id, integracaoNome: name,
              pipelineDbId: pi.pipeline?.dbId ?? null, jobId: triggered.jobId, diagnosis,
            }));
          }
        }
        hooks.log(`${name}: ${errorText} — Bronze/Silver desta integração não serão construídas (seguem com o último dado bom).`, 'error');
        rec('raw', name, name, 'error', { error: errorText });
        for (const b of [...pi.bronze, ...pi.silver]) failed.add(b.nodeId);
        for (const id of pi.syncNodeIds) failed.add(id);
        return { ok: false, jobId: triggered.jobId };
      } catch (err) {
        hooks.setState(pi.syncNodeIds, 'error');
        hooks.log(`${name}: ${err instanceof Error ? err.message : 'falha ao sincronizar'}`, 'error');
        rec('raw', name, name, 'error', { error: err instanceof Error ? err.message : 'Falha ao sincronizar.' });
        for (const b of [...pi.bronze, ...pi.silver]) failed.add(b.nodeId);
        for (const id of pi.syncNodeIds) failed.add(id);
        return { ok: false, jobId: null };
      }
    }));
  }

  // ---- B) Bronze e Silver, integração por integração
  for (const pi of plan.integrations) {
    if (cancelled || hooks.isCancelled()) { cancelled = true; break; }
    const { integration } = pi;
    const run = jobByIntegration.get(integration.id);
    const persistLayer = async (layer: 'bronze' | 'silver', status: 'running' | 'built' | 'failed', error?: string, tables?: Array<{ table: string; status: 'ok' | 'error'; rowsAffected: number | null; error: string | null }>) => {
      if (!run?.dbId || !opts.idEmpresa) return;
      await safe(`o status da ${layer}`, () => updatePipelineRunLayerStatus(run.dbId!, run.jobId, layer, status, error, tables));
    };

    // O que já está marcado como falho aqui é consequência de a sincronização ter falhado.
    for (const b of pi.bronze) if (failed.has(b.nodeId)) rec('bronze', nodeName(b.nodeId), integration.nome, 'skipped', { error: 'Não construída: a sincronização desta integração falhou.' });
    for (const s of pi.silver) if (failed.has(s.nodeId)) rec('silver', nodeName(s.nodeId), integration.nome, 'skipped', { error: 'Não construída: a sincronização desta integração falhou.' });

    const bronze = pi.bronze.filter((b) => !failed.has(b.nodeId));
    let bronzeOk = new Set<string>();
    if (bronze.length > 0) {
      const nodeIds = bronze.map((b) => b.nodeId);
      hooks.setState(nodeIds, 'running');
      hooks.log(`${integration.nome}: construindo Bronze (${bronze.length} tabela${bronze.length > 1 ? 's' : ''})…`);
      await persistLayer('bronze', 'running');
      try {
        const { results } = await buildBronzeLayer({
          projectId: integration.projectId, rawDataset: integration.rawDataset, bronzeDataset: integration.bronzeDataset,
          tables: bronze.map((b) => b.table), sistema: integration.sistemaNome, location: integration.location || undefined,
          fullRefresh: plan.fullRefresh,
        });
        const byTable = new Map(results.map((r) => [r.table, r]));
        for (const b of bronze) {
          const ok = byTable.get(b.table)?.status === 'ok';
          hooks.setState([b.nodeId], ok ? 'success' : 'error');
          if (ok) bronzeOk.add(b.table); else failed.add(b.nodeId);
          const r = byTable.get(b.table);
          rec('bronze', nodeName(b.nodeId), integration.nome, ok ? 'ok' : 'error', { rowsAffected: r?.rowsAffected ?? null, error: ok ? null : (r?.error || 'O dbt não retornou resultado para esta tabela.') });
        }
        const bad = results.filter((r) => r.status === 'error');
        if (bad.length) hooks.log(`${integration.nome}: ${summarizeTableFailures(bad)}`, 'error');
        else hooks.log(`${integration.nome}: Bronze construída.`);
        await persistLayer('bronze', bad.length ? 'failed' : 'built', bad.length ? summarizeTableFailures(bad) : undefined,
          results.map((r) => ({ table: r.table, status: r.status, rowsAffected: r.rowsAffected ?? null, error: r.error || null })));
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Falha ao construir a Bronze.';
        hooks.setState(nodeIds, 'error');
        hooks.log(`${integration.nome}: ${msg}`, 'error');
        for (const id of nodeIds) failed.add(id);
        for (const b of bronze) rec('bronze', nodeName(b.nodeId), integration.nome, 'error', { error: msg });
        await persistLayer('bronze', 'failed', msg, bronze.map((b) => ({ table: b.table, status: 'error', rowsAffected: null, error: msg })));
        bronzeOk = new Set();
      }
    }
    // Se a Bronze não estava no plano (o foco é a Silver de uma tabela já pronta), a Silver segue.
    const silver = pi.silver.filter((s) => !failed.has(s.nodeId) && (pi.bronze.length === 0 || bronzeOk.has(s.table)));
    for (const s of pi.silver) {
      if (silver.includes(s) || failed.has(s.nodeId)) continue;
      failed.add(s.nodeId);
      rec('silver', nodeName(s.nodeId), integration.nome, 'skipped', { error: 'Não construída: a Bronze desta tabela falhou.' });
    }

    if (hooks.isCancelled()) { cancelled = true; break; }
    if (silver.length > 0) {
      const nodeIds = silver.map((s) => s.nodeId);
      hooks.setState(nodeIds, 'running');
      hooks.log(`${integration.nome}: construindo Silver (${silver.length} tabela${silver.length > 1 ? 's' : ''})…`);
      await persistLayer('silver', 'running');
      try {
        const { results } = await buildSilverLayer({
          projectId: integration.projectId, rawDataset: integration.rawDataset, bronzeDataset: integration.bronzeDataset,
          silverDataset: integration.silverDataset, tables: silver.map((s) => s.table), sistema: integration.sistemaNome,
          location: integration.location || undefined, fullRefresh: plan.fullRefresh,
        });
        const byTable = new Map(results.map((r) => [r.table, r]));
        for (const s of silver) {
          const ok = byTable.get(s.table)?.status === 'ok';
          hooks.setState([s.nodeId], ok ? 'success' : 'error');
          if (!ok) failed.add(s.nodeId);
          const r = byTable.get(s.table);
          rec('silver', nodeName(s.nodeId), integration.nome, ok ? 'ok' : 'error', { rowsAffected: r?.rowsAffected ?? null, error: ok ? null : (r?.error || 'O dbt não retornou resultado para esta tabela.') });
        }
        const bad = results.filter((r) => r.status === 'error');
        if (bad.length) hooks.log(`${integration.nome}: ${summarizeTableFailures(bad)}`, 'error');
        else hooks.log(`${integration.nome}: Silver construída.`);
        await persistLayer('silver', bad.length ? 'failed' : 'built', bad.length ? summarizeTableFailures(bad) : undefined,
          results.map((r) => ({ table: r.table, status: r.status, rowsAffected: r.rowsAffected ?? null, error: r.error || null })));
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Falha ao construir a Silver.';
        hooks.setState(nodeIds, 'error');
        hooks.log(`${integration.nome}: ${msg}`, 'error');
        for (const id of nodeIds) failed.add(id);
        for (const s of silver) rec('silver', nodeName(s.nodeId), integration.nome, 'error', { error: msg });
        await persistLayer('silver', 'failed', msg, silver.map((s) => ({ table: s.table, status: 'error', rowsAffected: null, error: msg })));
      }
    }
  }

  // ---- C) Gold — só o que está íntegro em toda a cadeia que ele consome
  if (!cancelled && !hooks.isCancelled() && plan.gold.length > 0) {
    const buildable: PlanGold[] = [];
    for (const g of plan.gold) {
      const brokenUpstream = [...collect(opts.index, g.nodeId, 'up')].some((a) => failed.has(a));
      if (g.blocked) { hooks.setState([g.nodeId], 'error'); hooks.log(`${g.name}: ${g.blocked}`, 'error'); failed.add(g.nodeId); rec('gold', g.name, null, 'error', { error: g.blocked }); }
      else if (brokenUpstream) { hooks.setState([g.nodeId], 'skipped'); hooks.log(`${g.name}: não construído — uma tabela de que ele depende falhou.`, 'warn'); failed.add(g.nodeId); rec('gold', g.name, null, 'skipped', { error: 'Não construído: uma tabela de que ele depende falhou.' }); }
      else buildable.push(g);
    }
    if (buildable.length > 0) {
      hooks.setState(buildable.map((g) => g.nodeId), 'running');
      hooks.log(`Construindo Gold (${buildable.length} modelo${buildable.length > 1 ? 's' : ''}) e rodando os testes do dbt…`);
      try {
        const { results } = await buildGoldModels(buildable.map((g) => g.name), plan.fullRefresh);
        for (const g of buildable) {
          const r = results.find((x) => x.model === g.name);
          if (r?.status === 'ok') {
            hooks.setState([g.nodeId], 'success');
            const bad = r.tests.filter((t) => t.status !== 'pass');
            hooks.log(`${g.name}: construído${r.rowsAffected !== null ? ` (${r.rowsAffected} linhas)` : ''}; testes: ${r.tests.length - bad.length}/${r.tests.length} ok${bad.length ? ` — falharam: ${bad.map((t) => t.name).join(', ')}` : ''}.`, bad.length ? 'warn' : 'info');
            rec('gold', g.name, null, 'ok', { rowsAffected: r.rowsAffected, tests: { total: r.tests.length, failed: bad.map((t) => t.name) } });
          } else {
            hooks.setState([g.nodeId], 'error');
            hooks.log(`${g.name}: ${r?.error || 'falha ao construir'}`, 'error');
            failed.add(g.nodeId);
            rec('gold', g.name, null, 'error', { error: r?.error || 'Falha ao construir.' });
          }
        }
      } catch (err) {
        hooks.setState(buildable.map((g) => g.nodeId), 'error');
        hooks.log(err instanceof Error ? err.message : 'Falha ao construir o Gold.', 'error');
        for (const g of buildable) { failed.add(g.nodeId); rec('gold', g.name, null, 'error', { error: err instanceof Error ? err.message : 'Falha ao construir o Gold.' }); }
      }
    }
  }

  return { ok: !cancelled && failed.size === 0, cancelled };
}

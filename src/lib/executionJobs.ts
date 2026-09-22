import type { LineageIndex } from './lineage';
import { runPlan, type ExecPlan, type ExecScope, type RunHooks, type RunState } from './lineageExecution';
import { ExecutionRecorder, MISSING_TABLE_HINT, isMissingExecutionsTable, type ExecItemLayer } from './studioExecutions';

// -----------------------------------------------------------------------------
// Gerenciador das execuções do Studio Visual ETL Gold em SEGUNDO PLANO. A execução
// não pertence mais à tela do Studio (que é desmontada quando o usuário troca de
// menu): ela vive aqui, num store no nível do app, e continua rodando enquanto o
// usuário usa qualquer outra parte do sistema. A interface (sino de notificações,
// avisos rápidos e a janela de detalhe) só lê este estado.
//
// Sem React de propósito — é uma classe com subscribe/getSnapshot (compatível com
// useSyncExternalStore) e testável isolada.
// -----------------------------------------------------------------------------

export interface RunLogEntry {
  id: number;
  level: 'info' | 'warn' | 'error';
  message: string;
  at: string;
}

export type JobPhase = 'running' | 'done';

export interface ExecJob {
  id: string;
  scope: ExecScope;
  /** "Executar tabela X" / "Executar fluxo até X" — o mesmo título da janela de detalhe. */
  title: string;
  targetId: string;
  targetName: string;
  targetLayer: ExecItemLayer;
  plan: ExecPlan;
  /** A sincronização do Airbyte entrou nesta execução. */
  withSync: boolean;
  startedAt: number;
  finishedAt: number | null;
  phase: JobPhase;
  log: RunLogEntry[];
  result: { ok: boolean; cancelled: boolean } | null;
  cancelling: boolean;
  /** Estado de cada nó do grafo (rodando/sucesso/erro/pulado) — o grafo do Studio o pinta. */
  runStates: Map<string, RunState>;
  /** O usuário já abriu o detalhe depois que terminou (some do contador do sino). */
  seen: boolean;
}

export type ToastKind = 'started' | 'success' | 'failed' | 'cancelled';

export interface ExecToast {
  id: number;
  jobId: string;
  kind: ToastKind;
  title: string;
  text: string;
}

export interface JobsState {
  /** Mais recente primeiro. */
  jobs: ExecJob[];
  toasts: ExecToast[];
}

export interface StartJobArgs {
  plan: ExecPlan;
  index: LineageIndex;
  idEmpresa: number | null;
  userName: string | null;
  /** Já resolvido por quem chama: só vale para o escopo 'fluxo' e se alguma integração tem conexão real. */
  includeSync: boolean;
}

/** Quantas execuções ficam na lista do sino (as concluídas mais antigas saem primeiro). */
export const MAX_JOBS = 30;
const TOAST_MS: Record<ToastKind, number> = { started: 5000, success: 8000, failed: 12000, cancelled: 6000 };

export const jobTitle = (scope: ExecScope, name: string) => (scope === 'tabela' ? `Executar tabela ${name}` : `Executar fluxo até ${name}`);

export const isRunning = (j: ExecJob) => j.phase === 'running';
/** Terminou e o usuário ainda não abriu o detalhe. */
export const isUnseen = (j: ExecJob) => j.phase === 'done' && !j.seen;

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  return m > 0 ? `${m}min ${total % 60}s` : `${total}s`;
}

export class ExecutionJobStore {
  private state: JobsState = { jobs: [], toasts: [] };
  private listeners = new Set<() => void>();
  private cancelRequested = new Set<string>();
  private seq = 0;
  private toastSeq = 0;
  private logSeq = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** Estável (mesma referência) até algo mudar — exigência do useSyncExternalStore. */
  getSnapshot = (): JobsState => this.state;

  private set(next: Partial<JobsState>) {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((l) => l());
  }

  private patch(id: string, fn: (j: ExecJob) => ExecJob) {
    this.set({ jobs: this.state.jobs.map((j) => (j.id === id ? fn(j) : j)) });
  }

  private get(id: string): ExecJob | undefined {
    return this.state.jobs.find((j) => j.id === id);
  }

  /** Execução em andamento para este alvo (evita duas construções simultâneas da mesma tabela). */
  isRunningFor(targetId: string): boolean {
    return this.state.jobs.some((j) => j.phase === 'running' && j.targetId === targetId);
  }

  /** Dispara a execução em segundo plano e devolve o id na hora (o trabalho segue sozinho). */
  start(args: StartJobArgs): string {
    const target = args.index.byId.get(args.plan.focusId);
    const targetName = target?.name ?? args.plan.focusId;
    const id = `job-${Date.now()}-${++this.seq}`;
    const job: ExecJob = {
      id,
      scope: args.plan.scope,
      title: jobTitle(args.plan.scope, targetName),
      targetId: args.plan.focusId,
      targetName,
      targetLayer: !target || target.layer === 'source' ? 'raw' : target.layer,
      plan: args.plan,
      withSync: args.includeSync,
      startedAt: Date.now(),
      finishedAt: null,
      phase: 'running',
      log: [],
      result: null,
      cancelling: false,
      runStates: new Map(),
      seen: false,
    };
    this.set({ jobs: this.trim([job, ...this.state.jobs]) });
    this.toast(job, 'started');
    void this.run(job, args);
    return id;
  }

  private trim(jobs: ExecJob[]): ExecJob[] {
    let out = jobs;
    while (out.length > MAX_JOBS) {
      // Remove a concluída mais antiga; nunca uma em andamento.
      let idx = -1;
      for (let i = out.length - 1; i >= 0; i--) if (out[i].phase === 'done') { idx = i; break; }
      if (idx < 0) break;
      out = out.filter((_, i) => i !== idx);
    }
    return out;
  }

  private async run(job: ExecJob, args: StartJobArgs): Promise<void> {
    const id = job.id;
    const recorder = new ExecutionRecorder(args.idEmpresa, {
      escopo: job.scope,
      alvoNome: job.targetName,
      alvoCamada: job.targetLayer,
      comSincronizacao: job.withSync,
      executadoPor: args.userName,
    });
    const hooks: RunHooks = {
      log: (message, level = 'info') => this.patch(id, (j) => ({
        ...j, log: [...j.log, { id: ++this.logSeq, level, message, at: new Date().toLocaleTimeString('pt-BR') }],
      })),
      setState: (ids, state) => this.patch(id, (j) => {
        const m = new Map(j.runStates);
        ids.forEach((i) => m.set(i, state));
        return { ...j, runStates: m };
      }),
      isCancelled: () => this.cancelRequested.has(id),
      record: (item) => recorder.record(item),
    };

    let outcome: { ok: boolean; cancelled: boolean };
    try {
      await recorder.start();
      outcome = await runPlan(args.plan, { includeSync: args.includeSync, idEmpresa: args.idEmpresa, index: args.index }, hooks);
    } catch (err) {
      hooks.log(err instanceof Error ? err.message : 'Falha inesperada na execução.', 'error');
      outcome = { ok: false, cancelled: false };
    }

    await recorder.finish(outcome.cancelled ? 'cancelled' : outcome.ok ? 'success' : 'failed');
    if (recorder.lastError) {
      const reason = recorder.lastError instanceof Error ? recorder.lastError.message : (recorder.lastError as { message?: string })?.message ?? 'erro desconhecido';
      hooks.log(isMissingExecutionsTable(recorder.lastError) ? MISSING_TABLE_HINT : `Não consegui registrar esta execução na tela Execuções: ${reason}`, 'warn');
    }

    this.cancelRequested.delete(id);
    this.patch(id, (j) => ({ ...j, phase: 'done', result: outcome, finishedAt: Date.now(), cancelling: false }));
    const done = this.get(id);
    if (done) this.toast(done, outcome.cancelled ? 'cancelled' : outcome.ok ? 'success' : 'failed');
  }

  /** Pede o cancelamento: a execução para depois do passo atual. */
  cancel(id: string) {
    const j = this.get(id);
    if (!j || j.phase !== 'running') return;
    this.cancelRequested.add(id);
    this.patch(id, (x) => ({ ...x, cancelling: true }));
  }

  markSeen(id: string) {
    const j = this.get(id);
    if (!j || j.seen) return;
    this.patch(id, (x) => ({ ...x, seen: true }));
  }

  /** Remove da lista as execuções já concluídas (as em andamento ficam). */
  clearFinished() {
    this.set({ jobs: this.state.jobs.filter((j) => j.phase === 'running') });
  }

  dismissToast(toastId: number) {
    if (!this.state.toasts.some((t) => t.id === toastId)) return;
    this.set({ toasts: this.state.toasts.filter((t) => t.id !== toastId) });
  }

  private toast(job: ExecJob, kind: ToastKind) {
    const text: Record<ToastKind, string> = {
      started: 'Execução iniciada em segundo plano — acompanhe pelo sino.',
      success: 'Concluída com sucesso.',
      failed: 'Terminou com falhas — clique para ver o detalhe.',
      cancelled: 'Execução cancelada.',
    };
    const toast: ExecToast = { id: ++this.toastSeq, jobId: job.id, kind, title: job.title, text: text[kind] };
    // Uma execução que termina substitui o aviso de "iniciada" dela.
    this.set({ toasts: [...this.state.toasts.filter((t) => !(t.jobId === job.id && t.kind === 'started')), toast] });
    setTimeout(() => this.dismissToast(toast.id), TOAST_MS[kind]);
  }
}

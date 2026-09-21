import { Router } from 'express';
import { agentModel, describeAgentError, runAgent, type AgentEvent, type ChatTurn } from '../agent/agent';
import { loadTenantContext } from '../agent/catalog';
import { GoldSaveError, previewGold, saveGoldModel } from '../agent/goldModels';
import { canSaveGoldModels, getDataCoreUser } from '../userSession';

// -----------------------------------------------------------------------------
// "Converse com os dados": chat com o agente (SSE) + salvar modelo Gold.
// Montada em index.ts atrás de requireGatewayApiKey + requireUserSession — o
// idEmpresa vem SEMPRE do usuário autenticado no servidor, nunca do corpo.
// -----------------------------------------------------------------------------

export const agentRouter = Router();

const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 20_000;
const MAX_TOTAL_CHARS = 120_000;
const HEARTBEAT_MS = 15_000;

// Limites por usuário (memória do processo — o gateway roda com max-instances=1).
// Cada mensagem custa tokens de um modelo pago; isto evita loop/abuso, não é cobrança.
const RATE_WINDOW_MS = 60 * 60 * 1000;
const rateLimitPerHour = () => Number(process.env.AGENT_MAX_MESSAGES_PER_HOUR) || 60;
const MAX_CONCURRENT_PER_USER = 2;
const hits = new Map<string, number[]>();
const active = new Map<string, number>();

function takeRateSlot(userId: string): string | null {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= rateLimitPerHour()) {
    hits.set(userId, recent);
    return `Limite de ${rateLimitPerHour()} mensagens por hora atingido. Tente novamente mais tarde.`;
  }
  if ((active.get(userId) ?? 0) >= MAX_CONCURRENT_PER_USER) return 'Você já tem conversas em andamento — aguarde terminar.';
  recent.push(now);
  hits.set(userId, recent);
  active.set(userId, (active.get(userId) ?? 0) + 1);
  return null;
}

function parseHistory(body: unknown): { history: ChatTurn[] } | { error: string } {
  const messages = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return { error: 'Campo "messages" (lista não vazia) é obrigatório.' };
  if (messages.length > MAX_MESSAGES) return { error: `Conversa longa demais (máx. ${MAX_MESSAGES} mensagens). Comece uma nova conversa.` };

  const history: ChatTurn[] = [];
  let total = 0;
  for (const m of messages as Array<{ role?: unknown; content?: unknown }>) {
    if ((m?.role !== 'user' && m?.role !== 'assistant') || typeof m.content !== 'string' || !m.content.trim()) {
      return { error: 'Cada mensagem precisa de "role" (user|assistant) e "content" (texto não vazio).' };
    }
    if (m.content.length > MAX_MESSAGE_CHARS) return { error: `Mensagem excede ${MAX_MESSAGE_CHARS} caracteres.` };
    total += m.content.length;
    history.push({ role: m.role, content: m.content });
  }
  if (total > MAX_TOTAL_CHARS) return { error: 'Conversa longa demais. Comece uma nova conversa.' };
  if (history[0].role !== 'user' || history[history.length - 1].role !== 'user') return { error: 'A conversa deve começar e terminar com uma mensagem do usuário.' };
  return { history };
}

agentRouter.post('/chat', async (req, res) => {
  const user = getDataCoreUser(res);

  const parsed = parseHistory(req.body);
  if ('error' in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const limited = takeRateSlot(user.authUserId);
  if (limited) {
    res.status(429).json({ error: limited });
    return;
  }

  const release = () => active.set(user.authUserId, Math.max(0, (active.get(user.authUserId) ?? 1) - 1));

  let tenant;
  try {
    tenant = await loadTenantContext(user.idEmpresa);
  } catch (err) {
    release();
    res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao carregar o catálogo da empresa.' });
    return;
  }

  // A partir daqui a resposta é um stream SSE (uma linha `data: <json>` por evento).
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event: AgentEvent) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const controller = new AbortController();
  let finished = false;
  res.on('close', () => {
    if (!finished) controller.abort(); // usuário fechou a aba / clicou em Parar
  });
  const heartbeat = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, HEARTBEAT_MS);

  try {
    await runAgent({ tenant, user, history: parsed.history, emit: send, signal: controller.signal });
  } catch (err) {
    if (!controller.signal.aborted) {
      console.error('[agent] falha na conversa:', err);
      send({ type: 'error', message: describeAgentError(err) });
    }
  } finally {
    finished = true;
    clearInterval(heartbeat);
    release();
    if (!res.writableEnded) res.end();
  }
});

/** Informações leves para a tela (modelo em uso e empresa). */
agentRouter.get('/info', async (_req, res) => {
  const user = getDataCoreUser(res);
  try {
    const tenant = await loadTenantContext(user.idEmpresa);
    res.json({
      model: agentModel(),
      empresa: tenant.empresaNome,
      goldPrefix: `gold_${tenant.empresaSlug}_`,
      models: tenant.models.size,
      datasets: tenant.datasets,
      saveMode: (process.env.DBT_CODEGEN_GIT || 'off').toLowerCase(),
      canSaveGold: canSaveGoldModels(user.papel),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao carregar o catálogo.' });
  }
});

function handleGoldError(err: unknown, res: import('express').Response) {
  if (err instanceof GoldSaveError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao processar o modelo Gold.' });
}

// Checa (sem gravar) nome, escopo, YAML e dry run — alimenta o modal de confirmação.
agentRouter.post('/gold-models/preview', async (req, res) => {
  try {
    const user = getDataCoreUser(res);
    const { name, sql, yaml } = req.body as { name?: string; sql?: string; yaml?: string };
    const tenant = await loadTenantContext(user.idEmpresa);
    res.json(await previewGold(tenant, { name: name || '', sql: sql || '', yaml: yaml || undefined }));
  } catch (err) {
    handleGoldError(err, res);
  }
});

agentRouter.post('/gold-models', async (req, res) => {
  try {
    const user = getDataCoreUser(res);
    if (!canSaveGoldModels(user.papel)) {
      res.status(403).json({ error: 'Seu perfil não pode salvar modelos Gold (requer administrador ou engenheiro de dados).' });
      return;
    }
    const body = req.body as { name?: string; sql?: string; yaml?: string; overwrite?: boolean; acceptInvalid?: boolean };
    const tenant = await loadTenantContext(user.idEmpresa);
    const result = await saveGoldModel(tenant, user, {
      name: body.name || '',
      sql: body.sql || '',
      yaml: body.yaml || undefined,
      overwrite: body.overwrite === true,
      acceptInvalid: body.acceptInvalid === true,
    });
    res.status(201).json(result);
  } catch (err) {
    handleGoldError(err, res);
  }
});

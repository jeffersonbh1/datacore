import { gatewayConfig } from './airbyteGateway';
import { supabase } from './supabase';

// -----------------------------------------------------------------------------
// Cliente do agente "Converse com os dados" (gateway /api/agent/*). Além da
// chave do gateway, toda chamada leva o JWT da sessão real do Supabase em
// X-User-Token: é dele que o servidor tira a identidade e a empresa do usuário
// (o navegador nunca diz "qual empresa" — só o servidor decide).
// -----------------------------------------------------------------------------

export type AgentEvent =
  | { type: 'turn_start'; turn: number }
  | { type: 'turn_reset' }
  | { type: 'text'; delta: string }
  | { type: 'tool_start'; id: string; name: string; label: string }
  | { type: 'tool_end'; id: string; name: string; ok: boolean; summary: string }
  | { type: 'notice'; message: string }
  | { type: 'done'; usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; model: string } }
  | { type: 'error'; message: string };

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentInfo {
  model: string;
  empresa: string;
  goldPrefix: string;
  models: number;
  datasets: { bronze: string[]; silver: string[]; gold: string[] };
  /** off | commit | push — o que acontece no repositório dbt ao salvar um Gold. */
  saveMode: string;
  canSaveGold: boolean;
}

export interface SqlColumn { name: string; type: string }

export interface SqlValidation {
  ok: boolean | null;
  errors: string[];
  warnings: string[];
  outputColumns: SqlColumn[];
  referencedTables: string[];
  bytesEstimate: number | null;
  note?: string;
}

export interface GoldPreview {
  name: string;
  exists: boolean;
  validation: SqlValidation;
}

export interface GoldSaveResult {
  name: string;
  files: string[];
  overwritten: boolean;
  validation: SqlValidation;
  git: 'skipped' | 'committed' | 'pushed' | 'failed';
  gitDetail?: string;
}

/** Erro HTTP do gateway preservando status e `details` (o modal de Gold precisa deles). */
export class AgentHttpError extends Error {
  constructor(message: string, readonly status: number, readonly details?: unknown) {
    super(message);
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const { url, apiKey } = gatewayConfig();
  if (!url) throw new Error('VITE_AIRBYTE_GATEWAY_URL não configurada.');
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
  const token = data.session?.access_token;
  if (!token) throw new AgentHttpError('Sessão expirada — faça login novamente.', 401);
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, 'X-User-Token': token };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { url } = gatewayConfig();
  const res = await fetch(`${url}${path}`, { cache: 'no-store', ...init, headers: { ...(await authHeaders()), ...(init.headers || {}) } });
  const text = await res.text();
  let json: { error?: string; details?: unknown } | null = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* corpo não-JSON */ }
  if (!res.ok) throw new AgentHttpError(json?.error || res.statusText || `HTTP ${res.status}`, res.status, json?.details);
  return json as T;
}

export const fetchAgentInfo = () => request<AgentInfo>('/api/agent/info');

export const previewGoldModel = (body: { name: string; sql: string; yaml?: string }) =>
  request<GoldPreview>('/api/agent/gold-models/preview', { method: 'POST', body: JSON.stringify(body) });

export const saveGoldModel = (body: { name: string; sql: string; yaml?: string; overwrite?: boolean; acceptInvalid?: boolean }) =>
  request<GoldSaveResult>('/api/agent/gold-models', { method: 'POST', body: JSON.stringify(body) });

/**
 * Conversa com o agente. O servidor responde em SSE (`data: <json>` por evento);
 * fetch + ReadableStream em vez de EventSource porque EventSource não envia
 * cabeçalhos (precisamos da chave do gateway e do token do usuário).
 */
export async function streamDataChat(messages: ChatTurn[], onEvent: (e: AgentEvent) => void, signal: AbortSignal): Promise<void> {
  const { url } = gatewayConfig();
  const res = await fetch(`${url}/api/agent/chat`, {
    method: 'POST',
    cache: 'no-store',
    signal,
    headers: await authHeaders(),
    body: JSON.stringify({ messages }),
  });

  if (!res.ok || !res.body) {
    let message = res.statusText || `HTTP ${res.status}`;
    try { message = (await res.json()).error || message; } catch { /* corpo não-JSON */ }
    throw new AgentHttpError(message, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Eventos SSE são separados por linha em branco; linhas ": ping" são heartbeat.
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (!data) continue;
      try { onEvent(JSON.parse(data) as AgentEvent); } catch { /* frame parcial/ilegível: ignora */ }
    }
  }
}

/** Extrai o modelo final (1º bloco ```sql) e o YAML (1º bloco ```yaml) de uma resposta. */
export function extractGoldArtifacts(markdown: string): { sql: string; yaml?: string; suggestedName?: string } | null {
  const block = (lang: string) => new RegExp('```' + lang + '[^\\n]*\\n([\\s\\S]*?)```', 'i').exec(markdown)?.[1]?.trim();
  const sql = block('sql');
  if (!sql || !/\bselect\b/i.test(sql)) return null;
  const yaml = block('ya?ml');
  const suggestedName = yaml ? /^\s*-\s*name:\s*([A-Za-z0-9_]+)/m.exec(yaml)?.[1] : undefined;
  return { sql, yaml, suggestedName };
}

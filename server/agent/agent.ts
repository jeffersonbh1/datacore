import Anthropic from '@anthropic-ai/sdk';
import type { DataCoreUser } from '../userSession';
import type { TenantContext } from './catalog';
import { buildTenantBlock, SYSTEM_PROMPT } from './systemPrompt';
import { AGENT_TOOLS, executeTool, toolLabel } from './tools';

// -----------------------------------------------------------------------------
// Loop do agente "Converse com os dados": Claude + ferramentas somente-leitura,
// com streaming de texto para a tela via eventos. O histórico vem do navegador
// (só texto de user/assistant); o resultado das ferramentas de turnos passados
// não é reenviado — o agente refaz a consulta se precisar, o que mantém o
// contexto pequeno e o servidor sem estado.
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

export interface ChatTurn { role: 'user' | 'assistant'; content: string }

const MAX_TURNS = 12;
const MAX_JSON_RETRIES = 2;
const BETAS: Anthropic.Beta.AnthropicBeta[] = ['server-side-fallback-2026-07-01'];

let client: Anthropic | null = null;
function getClient(): Anthropic {
  // Chave vem do ambiente do gateway (Secret Manager) — nunca do navegador.
  return (client ??= new Anthropic());
}

export const agentModel = () => process.env.ANTHROPIC_MODEL || 'claude-opus-5';

/** Mensagem amigável (pt-BR) para erros do SDK/API. */
export function describeAgentError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError || (err instanceof Error && /authentication method|api[_ ]?key/i.test(err.message) && !(err instanceof Anthropic.APIError))) {
    return 'O gateway não tem uma credencial válida da Anthropic (ANTHROPIC_API_KEY). Peça a um administrador para configurá-la.';
  }
  if (err instanceof Anthropic.PermissionDeniedError) return 'A credencial da Anthropic configurada no gateway não tem permissão para este modelo.';
  if (err instanceof Anthropic.RateLimitError) return 'O limite de uso do modelo foi atingido. Tente novamente em instantes.';
  if (err instanceof Anthropic.APIConnectionError) return 'Não foi possível conectar à API do modelo. Tente novamente.';
  if (err instanceof Anthropic.APIError) return `Erro da API do modelo (${err.status ?? '?'}): ${err.message}`;
  return err instanceof Error ? err.message : 'Falha inesperada no agente.';
}

export async function runAgent(params: {
  tenant: TenantContext;
  user: DataCoreUser;
  history: ChatTurn[];
  emit: (event: AgentEvent) => void;
  signal: AbortSignal;
}): Promise<void> {
  const { tenant, user, history, emit, signal } = params;
  const model = agentModel();
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((t) => ({ role: t.role, content: t.content }));
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, model };
  let jsonRetries = 0;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (signal.aborted) return;
    emit({ type: 'turn_start', turn });

    const stream = getClient().beta.messages.stream(
      {
        model,
        max_tokens: 32_000,
        betas: BETAS,
        // Se o classificador de segurança recusar, a API refaz a chamada num
        // modelo alternativo (roteado por categoria) em vez de devolver a recusa.
        fallbacks: 'default',
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: buildTenantBlock(tenant, user) },
        ],
        tools: AGENT_TOOLS,
        messages,
      },
      { signal },
    );
    stream.on('text', (delta) => emit({ type: 'text', delta }));

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      // Com eager_input_streaming a API não valida o JSON dos tool_use: só esse
      // caso é reemitido (limitado). Erros da API e cancelamentos sobem.
      if (signal.aborted || err instanceof Anthropic.APIError || jsonRetries++ >= MAX_JSON_RETRIES) throw err;
      emit({ type: 'turn_reset' });
      turn--;
      continue;
    }

    usage.inputTokens += message.usage.input_tokens;
    usage.outputTokens += message.usage.output_tokens;
    usage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;

    if (message.stop_reason === 'refusal') {
      emit({ type: 'notice', message: 'O modelo recusou responder a esta solicitação. Reformule o pedido ou fale com um administrador.' });
      break;
    }

    const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');

    if (message.stop_reason === 'max_tokens') {
      // Um tool_use cortado pode passar como objeto parcial: nunca executar.
      emit({ type: 'notice', message: toolUses.length > 0 ? 'A resposta foi interrompida por tamanho no meio de uma consulta. Tente um pedido mais específico.' : 'A resposta foi cortada por tamanho. Peça para continuar.' });
      break;
    }

    if (message.stop_reason !== 'tool_use' || toolUses.length === 0) break;

    messages.push({ role: 'assistant', content: message.content as Anthropic.Beta.BetaContentBlockParam[] });

    for (const tu of toolUses) {
      emit({ type: 'tool_start', id: tu.id, name: tu.name, label: toolLabel(tu.name, (tu.input ?? {}) as Record<string, unknown>) });
    }
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = await Promise.all(
      toolUses.map(async (tu) => {
        const input = tu.input && typeof tu.input === 'object' && !Array.isArray(tu.input) ? (tu.input as Record<string, unknown>) : null;
        const outcome = input
          ? await executeTool(tenant, tu.name, input)
          : { content: 'Entrada da ferramenta inválida (esperado um objeto JSON).', isError: true, summary: 'entrada inválida' };
        emit({ type: 'tool_end', id: tu.id, name: tu.name, ok: !outcome.isError, summary: outcome.summary });
        return { type: 'tool_result' as const, tool_use_id: tu.id, content: outcome.content, ...(outcome.isError ? { is_error: true } : {}) };
      }),
    );
    // Todos os resultados numa ÚNICA mensagem do usuário (chamadas em paralelo).
    messages.push({ role: 'user', content: results });

    if (turn === MAX_TURNS - 1) {
      emit({ type: 'notice', message: 'O agente atingiu o limite de passos desta resposta. Peça para continuar de onde parou.' });
    }
  }

  emit({ type: 'done', usage });
}

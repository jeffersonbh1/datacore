import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, BookOpen, Check, Database, Loader2, MessagesSquare, RotateCcw, Save, Send, Sparkles, Square, X,
} from 'lucide-react';
import {
  extractGoldArtifacts,
  fetchAgentInfo,
  streamDataChat,
  type AgentEvent,
  type AgentInfo,
  type ChatTurn,
} from '../../lib/dataChat';
import { ChatMarkdown } from './ChatMarkdown';
import { KnowledgePanel } from './KnowledgePanel';
import { SaveGoldModal } from './SaveGoldModal';

interface DataChatViewProps {
  idEmpresa: number | null;
  /** Perfis que podem salvar modelos Gold e editar a base de conhecimento. */
  canEditModels: boolean;
}

interface ToolActivity {
  id: string;
  label: string;
  status: 'running' | 'ok' | 'error';
  summary?: string;
}

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  tools: ToolActivity[];
  notices: string[];
  error?: string;
  done: boolean;
  stopped?: boolean;
}

const SUGGESTIONS = [
  'Quais modelos existem no catálogo e o que cada um contém?',
  'Quero criar um modelo Gold de faturamento mensal por cliente.',
  'Quais regras de negócio e métricas estão cadastradas?',
  'Faça um resumo dos dados da Silver, com números reais.',
];

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const storageKey = (idEmpresa: number | null) => `datacore.dataChat.v1.${idEmpresa ?? 'sem-empresa'}`;

function loadStored(idEmpresa: number | null): ChatMsg[] {
  try {
    const raw = sessionStorage.getItem(storageKey(idEmpresa));
    if (!raw) return [];
    // Uma resposta que estava em andamento ao sair da tela foi abortada — fecha ela.
    return (JSON.parse(raw) as ChatMsg[]).map((m) => (m.done ? m : { ...m, done: true, stopped: true }));
  } catch {
    return [];
  }
}

function toTurns(messages: ChatMsg[]): ChatTurn[] {
  return messages.filter((m) => m.text.trim()).map((m) => ({ role: m.role, content: m.text }));
}

const ToolLine: React.FC<{ t: ToolActivity }> = ({ t }) => (
  <div className="flex items-center gap-2 text-[11px] text-slate-500">
    {t.status === 'running' && <Loader2 className="w-3 h-3 animate-spin text-indigo-500 shrink-0" />}
    {t.status === 'ok' && <Check className="w-3 h-3 text-emerald-500 shrink-0" />}
    {t.status === 'error' && <X className="w-3 h-3 text-red-500 shrink-0" />}
    <span className="truncate">{t.label}</span>
    {t.summary && <span className={`shrink-0 ${t.status === 'error' ? 'text-red-500' : 'text-slate-400'}`}>· {t.summary}</span>}
  </div>
);

const AssistantMessage = React.memo(function AssistantMessage({
  msg, canSave, onSaveGold,
}: {
  msg: ChatMsg;
  canSave: boolean;
  onSaveGold: (a: { sql: string; yaml?: string; suggestedName?: string }) => void; // precisa ter identidade estável (memo)
}) {
  const artifacts = useMemo(() => (msg.done && !msg.error ? extractGoldArtifacts(msg.text) : null), [msg.done, msg.error, msg.text]);
  const waiting = !msg.done && !msg.text;

  return (
    <div className="flex gap-3 max-w-full">
      <div className="w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0 mt-0.5"><Sparkles className="w-3.5 h-3.5" /></div>
      <div className="min-w-0 flex-1 space-y-2">
        {msg.tools.length > 0 && (
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 space-y-1">
            {msg.tools.map((t) => <ToolLine key={t.id} t={t} />)}
          </div>
        )}
        {waiting && msg.tools.length === 0 && <p className="text-xs text-slate-400 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Pensando…</p>}
        {msg.text && <div className="min-w-0"><ChatMarkdown text={msg.text} /></div>}
        {!msg.done && msg.text && <span className="inline-block w-1.5 h-4 bg-indigo-400 animate-pulse align-middle" />}
        {msg.notices.map((n, i) => (
          <div key={i} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{n}</div>
        ))}
        {msg.error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 break-words">{msg.error}</div>}
        {msg.stopped && !msg.error && <p className="text-[11px] text-slate-400 italic">Resposta interrompida.</p>}

        {artifacts && (
          <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-xs text-indigo-900">
              <p className="font-semibold">Modelo Gold proposto</p>
              <p className="text-indigo-700/80">Revise o SQL acima antes de salvar. Nada foi salvo nem executado ainda.</p>
            </div>
            {canSave ? (
              <button type="button" onClick={() => onSaveGold(artifacts)} className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold cursor-pointer transition">
                <Save className="w-3.5 h-3.5" /> Salvar como modelo Gold
              </button>
            ) : (
              <span className="text-[11px] text-slate-500">Seu perfil não pode salvar modelos.</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export const DataChatView: React.FC<DataChatViewProps> = ({ idEmpresa, canEditModels }) => {
  const [messages, setMessages] = useState<ChatMsg[]>(() => loadStored(idEmpresa));
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [info, setInfo] = useState<AgentInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [showKnowledge, setShowKnowledge] = useState(false);
  const [goldModal, setGoldModal] = useState<{ sql: string; yaml?: string; suggestedName?: string } | null>(null);

  const messagesRef = useRef<ChatMsg[]>(messages);
  messagesRef.current = messages;
  const abortRef = useRef<AbortController | null>(null);
  const draftRef = useRef<ChatMsg | null>(null);
  const rafRef = useRef<number | null>(null);
  const turnStartLen = useRef(0);
  const turnHasText = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAgentInfo()
      .then((i) => { if (!cancelled) { setInfo(i); setInfoError(null); } })
      .catch((err) => { if (!cancelled) setInfoError(err instanceof Error ? err.message : 'Falha ao conectar ao agente.'); });
    return () => { cancelled = true; };
  }, []);

  // Sair da tela cancela a resposta em andamento (o servidor aborta a chamada ao modelo)
  // e guarda a conversa como está — loadStored fecha a resposta pela metade como "interrompida".
  useEffect(() => () => {
    abortRef.current?.abort();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    try { sessionStorage.setItem(storageKey(idEmpresa), JSON.stringify(messagesRef.current)); } catch { /* storage indisponível */ }
  }, [idEmpresa]);

  // A conversa sobrevive à troca de aba (a tela é desmontada); some ao fechar a aba do navegador.
  useEffect(() => {
    if (streaming) return;
    try { sessionStorage.setItem(storageKey(idEmpresa), JSON.stringify(messages)); } catch { /* storage indisponível */ }
  }, [messages, streaming, idEmpresa]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const flushDraft = useCallback(() => {
    rafRef.current = null;
    const draft = draftRef.current;
    if (!draft) return;
    setMessages((prev) => (prev.length && prev[prev.length - 1].id === draft.id ? [...prev.slice(0, -1), { ...draft, tools: [...draft.tools], notices: [...draft.notices] }] : prev));
  }, []);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(flushDraft);
  }, [flushDraft]);

  const applyEvent = useCallback((e: AgentEvent) => {
    const d = draftRef.current;
    if (!d) return;
    switch (e.type) {
      case 'turn_start': turnStartLen.current = d.text.length; turnHasText.current = false; break;
      case 'turn_reset': d.text = d.text.slice(0, turnStartLen.current); turnHasText.current = false; break;
      case 'text':
        // Texto de turnos diferentes (antes/depois de uma consulta) ganha um respiro entre parágrafos.
        if (!turnHasText.current && d.text.length > 0) d.text += '\n\n';
        turnHasText.current = true;
        d.text += e.delta;
        break;
      case 'tool_start': d.tools.push({ id: e.id, label: e.label, status: 'running' }); break;
      case 'tool_end': {
        const t = d.tools.find((x) => x.id === e.id);
        if (t) { t.status = e.ok ? 'ok' : 'error'; t.summary = e.summary; }
        break;
      }
      case 'notice': d.notices.push(e.message); break;
      case 'error': d.error = e.message; break;
      case 'done': break;
    }
    scheduleFlush();
  }, [scheduleFlush]);

  const send = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || streaming || !idEmpresa) return;

    const userMsg: ChatMsg = { id: newId(), role: 'user', text, tools: [], notices: [], done: true };
    const assistant: ChatMsg = { id: newId(), role: 'assistant', text: '', tools: [], notices: [], done: false };
    const history = [...messages, userMsg];

    draftRef.current = assistant;
    turnStartLen.current = 0;
    turnHasText.current = false;
    stickToBottom.current = true;
    setMessages([...history, assistant]);
    setInput('');
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamDataChat(toTurns(history), applyEvent, controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) assistant.error = err instanceof Error ? err.message : 'Falha ao falar com o agente.';
    } finally {
      assistant.done = true;
      assistant.stopped = controller.signal.aborted;
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      flushDraft();
      draftRef.current = null;
      abortRef.current = null;
      setStreaming(false);
      inputRef.current?.focus();
    }
  }, [applyEvent, flushDraft, idEmpresa, messages, streaming]);

  const resetChat = () => {
    if (streaming) abortRef.current?.abort();
    setMessages([]);
    try { sessionStorage.removeItem(storageKey(idEmpresa)); } catch { /* storage indisponível */ }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  };

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const canSave = canEditModels && !!info?.canSaveGold;

  return (
    <div className="flex gap-4 h-[calc(100vh-9rem)] min-h-[520px]">
      <section className={`flex-1 min-w-0 bg-white border border-slate-200 rounded-xl shadow-sm flex-col overflow-hidden ${showKnowledge ? 'hidden lg:flex' : 'flex'}`}>
        <header className="flex items-start justify-between gap-3 px-5 py-3.5 border-b border-slate-100 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2"><MessagesSquare className="w-4.5 h-4.5 text-indigo-600" /> Converse com os dados</h2>
            <p className="text-xs text-slate-500 mt-0.5">Pergunte em linguagem natural, gere insights e transforme regras de negócio em modelos Gold dbt.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {info && (
              <span className="hidden sm:flex items-center gap-1.5 text-[10px] text-slate-500 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1" title={`Datasets: ${[...info.datasets.bronze, ...info.datasets.silver, ...info.datasets.gold].join(', ')}`}>
                <Database className="w-3 h-3" /> {info.models} modelos no catálogo · <span className="font-mono">{info.model}</span>
              </span>
            )}
            <button type="button" onClick={() => setShowKnowledge((v) => !v)} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer ${showKnowledge ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
              <BookOpen className="w-3.5 h-3.5" /> Base de conhecimento
            </button>
            <button type="button" onClick={resetChat} disabled={messages.length === 0} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer">
              <RotateCcw className="w-3.5 h-3.5" /> Nova conversa
            </button>
          </div>
        </header>

        {infoError && (
          <div className="mx-5 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> Não foi possível conectar ao agente: {infoError}
          </div>
        )}

        <div
          ref={scrollRef}
          onScroll={(e) => { const el = e.currentTarget; stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
          className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5"
        >
          {!idEmpresa ? (
            <div className="h-full flex items-center justify-center text-center text-sm text-slate-500 px-6">
              Seu usuário não está vinculado a uma empresa — o agente precisa de uma empresa para isolar os dados.
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-5 py-6">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center"><Sparkles className="w-6 h-6" /></div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Como posso ajudar com os seus dados?</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-md">Consulto o catálogo e as regras de negócio da sua empresa e só uso dados da Bronze, Silver e Gold — dados pessoais nunca aparecem.</p>
              </div>
              <div className="grid sm:grid-cols-2 gap-2 w-full max-w-2xl">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => send(s)} className="text-left text-xs text-slate-700 border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 rounded-xl px-3.5 py-3 transition cursor-pointer">{s}</button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] bg-indigo-600 text-white rounded-2xl rounded-br-md px-4 py-2.5 text-sm whitespace-pre-wrap break-words">{m.text}</div>
                </div>
              ) : (
                <AssistantMessage key={m.id} msg={m} canSave={canSave} onSaveGold={setGoldModal} />
              ),
            )
          )}
        </div>

        <div className="border-t border-slate-100 px-4 py-3 space-y-2">
          <div className="flex items-end gap-2 rounded-xl border border-slate-300 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-100 bg-white px-3 py-2">
            <textarea
              ref={inputRef}
              value={input}
              rows={1}
              disabled={!idEmpresa}
              onChange={(e) => { setInput(e.target.value); autoGrow(e.target); }}
              onKeyDown={onKeyDown}
              placeholder="Pergunte sobre os dados ou descreva o modelo Gold que você precisa…"
              className="flex-1 resize-none outline-none text-sm bg-transparent max-h-40 py-1 disabled:opacity-50"
            />
            {streaming ? (
              <button type="button" onClick={() => abortRef.current?.abort()} className="p-2 rounded-lg bg-slate-800 hover:bg-slate-900 text-white cursor-pointer transition" title="Parar resposta" aria-label="Parar resposta"><Square className="w-3.5 h-3.5" /></button>
            ) : (
              <button type="button" onClick={() => send(input)} disabled={!input.trim() || !idEmpresa} className="p-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white cursor-pointer transition" title="Enviar (Enter)" aria-label="Enviar"><Send className="w-3.5 h-3.5" /></button>
            )}
          </div>
          <p className="text-[10px] text-slate-400 text-center">Respostas de IA podem conter erros — revise o SQL e as regras antes de usar. Enter envia · Shift+Enter quebra a linha.</p>
        </div>
      </section>

      {showKnowledge && <KnowledgePanel idEmpresa={idEmpresa} canEdit={canEditModels} onClose={() => setShowKnowledge(false)} />}

      {goldModal && info && (
        <SaveGoldModal
          sql={goldModal.sql}
          yaml={goldModal.yaml}
          suggestedName={goldModal.suggestedName}
          goldPrefix={info.goldPrefix}
          saveMode={info.saveMode}
          onClose={() => setGoldModal(null)}
        />
      )}
    </div>
  );
};

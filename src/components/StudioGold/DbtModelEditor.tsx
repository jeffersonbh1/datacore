import React, { useEffect, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import { indentLess, insertTab } from '@codemirror/commands';
import { Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import {
  AlertCircle, Check, CheckCircle2, Copy, Download, FileCode, Loader2,
  Play, RefreshCw, RotateCcw, Sliders, Terminal, X,
} from 'lucide-react';
import {
  LAYER_LABEL, compileModel, fetchModelProperties, fetchModelSql, saveModelSql,
  type LineageNode, type ModelSql,
} from '../../lib/lineage';

// -----------------------------------------------------------------------------
// Editor dbt do Studio Visual ETL Gold: mesma ideia do editor da tela "Studio
// Visual ETL" (DbtSqlEditorModal) — ver, editar, executar, compilar e checar a
// documentação — mas em cima do que é REAL (o .sql do modelo já gerado, o
// _properties.yml de verdade, um `dbt compile` de verdade), nunca um template
// de demonstração, e ocupando a tela inteira: enquanto o usuário está aqui,
// não há outra atividade a fazer na tela por baixo.
// -----------------------------------------------------------------------------

const LAYER_THEME: Record<'bronze' | 'silver' | 'gold', { badge: string; accent: string; label: string }> = {
  bronze: { badge: 'bg-orange-100 text-orange-800 border-orange-300', accent: 'text-orange-400', label: 'Camada Bronze' },
  silver: { badge: 'bg-blue-100 text-blue-800 border-blue-300', accent: 'text-blue-400', label: 'Camada Silver' },
  gold: { badge: 'bg-amber-100 text-amber-800 border-amber-300', accent: 'text-amber-400', label: 'Camada Gold' },
};

const MATERIALIZATION_RE = /materialized\s*=\s*'([^']+)'/;

// O binding pronto `indentWithTab` do @codemirror/commands usa `indentMore` mesmo sem
// seleção — que reindenta o INÍCIO da linha inteira, não insere no cursor (por isso a
// palavra "pulava" mesmo com o cursor depois dela: a linha toda deslocava). `insertTab`
// é o comando certo: insere no cursor quando não há seleção, e só cai para indentMore
// quando várias linhas estão selecionadas (mesmo comportamento de editores de código).
// Prec.highest: garante que este binding sempre vence, mesmo se outro keymap também
// escutar Tab (ex.: aceitar sugestão do autocomplete).
const editorExtensions = [sql(), Prec.highest(keymap.of([{ key: 'Tab', run: insertTab, shift: indentLess }]))];

interface DbtModelEditorProps {
  node: LineageNode;
  /** Perfil pode editar/salvar/executar/compilar (mesmo critério de "Executar esta tabela"). */
  canEdit: boolean;
  editHint?: string;
  /** Já existe um job em segundo plano rodando pra ESTE nó especificamente. */
  isExecuting: boolean;
  /** Reusa o mesmo fluxo de execução de tabela única já existente na tela (abre a confirmação). */
  onExecute: (id: string) => void;
  /** Mesmo fluxo, mas com --full-refresh (equivalente ao "Do zero" do Studio Visual ETL). */
  onExecuteFullRefresh: (id: string) => void;
  onClose: () => void;
}

export const DbtModelEditor: React.FC<DbtModelEditorProps> = ({ node, canEdit, editHint, isExecuting, onExecute, onExecuteFullRefresh, onClose }) => {
  const [model, setModel] = useState<ModelSql | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  const [activeTab, setActiveTab] = useState<'editor' | 'compiled' | 'schema'>('editor');

  // Aba "SQL Compilado" — dbt compile de verdade, sob demanda (nunca automático:
  // spawna um processo real, pode levar de segundos a mais de um minuto na 1ª vez).
  const [compiledSql, setCompiledSql] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);

  // Aba "schema.yml" — _properties.yml real da entrada deste modelo, carregado uma vez.
  const [propsYaml, setPropsYaml] = useState<string | null>(null);
  const [propsLoaded, setPropsLoaded] = useState(false);
  const [propsLoading, setPropsLoading] = useState(false);
  const [propsError, setPropsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetchModelSql(node.name)
      .then((m) => {
        if (cancelled) return;
        setModel(m);
        setCode(m.sql ?? '');
        setIsDirty(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Falha ao carregar o modelo dbt.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [node.name]);

  useEffect(() => {
    if (activeTab !== 'schema' || propsLoaded) return;
    let cancelled = false;
    setPropsLoading(true);
    setPropsError(null);
    fetchModelProperties(node.name)
      .then(({ yaml }) => { if (!cancelled) { setPropsYaml(yaml); setPropsLoaded(true); } })
      .catch((err) => { if (!cancelled) setPropsError(err instanceof Error ? err.message : 'Falha ao carregar a documentação do modelo.'); })
      .finally(() => { if (!cancelled) setPropsLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab, propsLoaded, node.name]);

  const handleClose = () => {
    if (isDirty) { setShowCloseConfirm(true); return; }
    onClose();
  };

  const handleSave = async (): Promise<boolean> => {
    setSaving(true);
    setSaveError(null);
    try {
      await saveModelSql(node.name, code);
      setIsDirty(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
      return true;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Falha ao salvar o modelo dbt.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleCompile = async () => {
    // dbt compile lê o .sql do DISCO — sem salvar antes, compilaria a versão
    // antiga, não o que está na tela. Silencioso porque é a mesma ação de
    // "Salvar" que o usuário já vê logo abaixo, só encadeada.
    if (isDirty) {
      const saved = await handleSave();
      if (!saved) return;
    }
    setActiveTab('compiled');
    setCompiling(true);
    setCompileError(null);
    try {
      const { sql: compiled } = await compileModel(node.name);
      setCompiledSql(compiled);
    } catch (err) {
      setCompileError(err instanceof Error ? err.message : 'Falha ao compilar o modelo.');
    } finally {
      setCompiling(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard indisponível — não é fatal.
    }
  };

  const handleDownload = () => {
    const blob = new Blob([code], { type: 'text/sql;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${node.name}.sql`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const layer = (node.layer === 'bronze' || node.layer === 'silver' || node.layer === 'gold' ? node.layer : 'bronze') as 'bronze' | 'silver' | 'gold';
  const theme = LAYER_THEME[layer];
  const canShowEditor = !loading && !loadError && model?.sql !== null;
  const materialization = code.match(MATERIALIZATION_RE)?.[1] ?? null;

  const handleMaterializationChange = (newMat: string) => {
    setCode((prev) => prev.replace(MATERIALIZATION_RE, `materialized = '${newMat}'`));
    setIsDirty(true);
  };

  return (
    <div id="dbt-model-editor-overlay" className="fixed inset-0 z-50 bg-slate-950 flex flex-col text-slate-100">
      {/* Header */}
      <div className="border-b border-slate-800 px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[#FF694B] text-white flex items-center justify-center font-bold text-xs tracking-tight shadow-md shrink-0">
            dbt
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">dbt SQL Model Editor</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${theme.badge}`}>{theme.label}</span>
              {isDirty && (
                <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-mono animate-pulse">
                  Modificado
                </span>
              )}
            </div>
            <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2 truncate">
              <span className="text-slate-400 font-mono text-xs">models/medallion/{layer}/</span>
              <span className={`font-mono ${theme.accent}`}>{node.name}.sql</span>
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            id="btn-dbt-editor-execute"
            onClick={() => onExecute(node.id)}
            disabled={!canEdit || isExecuting}
            title={isExecuting ? 'Execução em andamento — acompanhe pelo sino no canto superior direito.' : canEdit ? 'Executa só esta tabela — não sincroniza nem reconstrói o que a alimenta' : (editHint || 'Seu perfil não pode executar pipelines.')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-700 bg-emerald-900/40 hover:bg-emerald-900/70 disabled:opacity-50 disabled:cursor-not-allowed text-emerald-300 text-xs font-semibold transition cursor-pointer"
          >
            {isExecuting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{isExecuting ? 'Em execução...' : 'Executar esta tabela'}</span>
          </button>
          <button
            type="button"
            id="btn-dbt-editor-execute-full-refresh"
            onClick={() => onExecuteFullRefresh(node.id)}
            disabled={!canEdit || isExecuting}
            title={isExecuting ? 'Execução em andamento — acompanhe pelo sino no canto superior direito.' : canEdit ? 'Reconstrói esta tabela do zero (--full-refresh) — use quando o schema mudou ou na 1ª construção' : (editHint || 'Seu perfil não pode executar pipelines.')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-700 bg-amber-900/30 hover:bg-amber-900/60 disabled:opacity-50 disabled:cursor-not-allowed text-amber-300 text-xs font-semibold transition cursor-pointer"
          >
            {isExecuting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
            <span className="hidden md:inline">{isExecuting ? 'Em execução...' : 'Executar full-refresh'}</span>
          </button>
          <button
            type="button"
            id="btn-dbt-editor-copy"
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-medium transition cursor-pointer"
            title="Copiar código SQL"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
            <span className="hidden sm:inline">{copied ? 'Copiado' : 'Copiar'}</span>
          </button>
          <button
            type="button"
            id="btn-dbt-editor-download"
            onClick={handleDownload}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs transition cursor-pointer"
            title="Baixar arquivo .sql"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            id="btn-dbt-editor-close"
            onClick={handleClose}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 border border-slate-700 transition cursor-pointer ml-1"
            title="Fechar Editor"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Subheader: materialização + tabs */}
      <div className="bg-slate-900/90 border-b border-slate-800 px-5 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          {materialization && (
            <div className="flex items-center gap-2 bg-slate-800/80 border border-slate-700 px-2.5 py-1 rounded-lg">
              <span className="text-slate-400 font-medium">Materialização:</span>
              <select
                disabled={!canEdit}
                value={materialization}
                onChange={(e) => handleMaterializationChange(e.target.value)}
                className="bg-transparent text-emerald-400 font-mono font-semibold focus:outline-none cursor-pointer"
              >
                <option value="incremental" className="bg-slate-900 text-slate-100">incremental (Micro-batch)</option>
                <option value="table" className="bg-slate-900 text-slate-100">table (Tabela Física)</option>
                <option value="view" className="bg-slate-900 text-slate-100">view (Visão Lógica)</option>
                <option value="ephemeral" className="bg-slate-900 text-slate-100">ephemeral (CTE Temporária)</option>
              </select>
            </div>
          )}
          {model?.dataset && (
            <div className="hidden lg:flex items-center gap-1.5 text-slate-400 bg-slate-800/50 border border-slate-700/60 px-2.5 py-1 rounded-lg text-[11px]">
              <span>Dataset:</span>
              <code className="text-cyan-300 font-mono font-bold">{model.dataset}</code>
            </div>
          )}
        </div>

        <div className="flex items-center bg-slate-800/80 border border-slate-700 p-0.5 rounded-lg">
          <button
            type="button"
            id="tab-dbt-editor-editor"
            onClick={() => setActiveTab('editor')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition cursor-pointer ${
              activeTab === 'editor' ? 'bg-[#FF694B] text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>Editor SQL (.sql)</span>
          </button>
          <button
            type="button"
            id="tab-dbt-editor-compiled"
            onClick={handleCompile}
            disabled={compiling}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
              activeTab === 'compiled' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Roda dbt compile de verdade (renderiza o Jinja contra o dataset real, sem gravar nada)"
          >
            {compiling ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Terminal className="w-3.5 h-3.5" />}
            <span>SQL Compilado</span>
          </button>
          <button
            type="button"
            id="tab-dbt-editor-schema"
            onClick={() => setActiveTab('schema')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition cursor-pointer ${
              activeTab === 'schema' ? 'bg-teal-600 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>schema.yml</span>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {activeTab === 'editor' && (
          loading ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
              <RefreshCw className="w-6 h-6 text-slate-400 animate-spin" />
              <div className="text-sm text-slate-400">Carregando models/medallion/{layer}/{node.name}.sql…</div>
            </div>
          ) : loadError ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
              <AlertCircle className="w-8 h-8 text-rose-400" />
              <div className="text-sm text-rose-300 font-medium">Não foi possível carregar o arquivo .sql</div>
              <div className="text-xs text-slate-400 max-w-md">{loadError}</div>
            </div>
          ) : model?.sql === null ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-6">
              <AlertCircle className="w-8 h-8 text-slate-500" />
              <div className="text-sm text-slate-300">O arquivo .sql deste modelo não está disponível no gateway.</div>
            </div>
          ) : canShowEditor && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-hidden">
                <CodeMirror
                  value={code}
                  height="100%"
                  theme="dark"
                  editable={canEdit}
                  extensions={editorExtensions}
                  onChange={(value) => { setCode(value); setIsDirty(true); }}
                  // autocompletion desligado: o atalho de Tab do autocomplete ("aceitar sugestão")
                  // tem prioridade sobre o indentWithTab (extensions acima), então Tab completava
                  // a palavra em vez de indentar — mesmo com o cursor já depois dela.
                  basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true, autocompletion: false, completionKeymap: false }}
                  style={{ height: '100%', fontSize: '13px' }}
                />
              </div>
              <div className="bg-slate-900 border-t border-slate-800 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 select-none shrink-0">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    dbt Dialect: ANSI SQL / Jinja
                  </span>
                  <span>{code.split('\n').length} linhas</span>
                  <span>{code.length} caracteres</span>
                </div>
                <span className="text-slate-500">{LAYER_LABEL[node.layer]} · {node.name}</span>
              </div>
            </div>
          )
        )}

        {activeTab === 'compiled' && (
          <div className="flex-1 flex flex-col bg-slate-950 p-5 overflow-y-auto">
            <div className="mb-3 p-3 rounded-lg bg-indigo-950/50 border border-indigo-800 text-indigo-200 text-xs flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-indigo-400" />
                <span>dbt compile real (renderiza o Jinja contra {model?.dataset || 'o dataset'} — não grava nada no BigQuery):</span>
              </div>
              <button
                type="button"
                id="btn-dbt-editor-recompile"
                onClick={handleCompile}
                disabled={compiling}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-900/60 hover:bg-indigo-900 border border-indigo-700 text-indigo-200 text-[11px] font-medium transition cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {compiling ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                {compiling ? 'Compilando…' : 'Recompilar'}
              </button>
            </div>

            {compiling && !compiledSql && !compileError && (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin" />
                <span className="text-xs">Rodando dbt compile — a 1ª vez pode levar mais tempo (instala dependências).</span>
              </div>
            )}
            {compileError && (
              <div className="flex items-start gap-1.5 bg-rose-950/60 border border-rose-800 rounded-lg p-3 text-rose-300 text-xs whitespace-pre-wrap">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{compileError}</span>
              </div>
            )}
            {!compiling && !compileError && compiledSql && (
              <pre className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-cyan-300 font-mono text-xs leading-relaxed overflow-x-auto select-all flex-1">
                {compiledSql}
              </pre>
            )}
            {!compiling && !compileError && !compiledSql && (
              <div className="flex-1 flex items-center justify-center text-xs text-slate-500">
                Clique em &quot;Recompilar&quot; pra rodar o dbt compile.
              </div>
            )}
          </div>
        )}

        {activeTab === 'schema' && (
          <div className="flex-1 flex flex-col bg-slate-950 p-5 overflow-y-auto">
            <div className="mb-3 p-3 rounded-lg bg-teal-950/50 border border-teal-800 text-teal-200 text-xs flex items-center gap-2">
              <Sliders className="w-4 h-4 text-teal-400" />
              <span>_properties.yml real deste modelo (documentação e testes já cadastrados):</span>
            </div>
            {propsLoading ? (
              <div className="flex-1 flex items-center justify-center gap-2 text-slate-400 text-xs">
                <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
              </div>
            ) : propsError ? (
              <div className="flex items-start gap-1.5 bg-rose-950/60 border border-rose-800 rounded-lg p-3 text-rose-300 text-xs">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{propsError}</span>
              </div>
            ) : propsYaml ? (
              <pre className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-amber-300 font-mono text-xs leading-relaxed overflow-x-auto select-all flex-1">
                {propsYaml}
              </pre>
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs text-slate-500">
                Este modelo ainda não tem entrada no _properties.yml do sistema.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="bg-slate-900 border-t border-slate-800 px-5 py-3 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="hidden sm:inline">
            Salvar grava direto no arquivo .sql do projeto dbt — a próxima execução desta tabela usa este conteúdo.
          </span>
          {saveError && <span className="text-rose-400">{saveError}</span>}
          {saveSuccess && <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Salvo no arquivo dbt.</span>}
          {!canEdit && <span className="text-amber-400">{editHint || 'Seu perfil só pode visualizar — não pode editar.'}</span>}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <button
            type="button"
            id="btn-dbt-editor-cancel"
            onClick={handleClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition cursor-pointer"
          >
            Fechar
          </button>
          <button
            type="button"
            id="btn-dbt-editor-save"
            onClick={handleSave}
            disabled={!canEdit || !canShowEditor || !isDirty || saving}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-bold transition shadow-md cursor-pointer ${
              canEdit && canShowEditor && isDirty && !saving
                ? 'bg-gradient-to-r from-[#FF694B] to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white shadow-orange-950'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            <span>{saving ? 'Salvando...' : 'Salvar Modelo dbt'}</span>
          </button>
        </div>
      </div>

      {showCloseConfirm && (
        <div className="fixed inset-0 z-[70] bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-5 space-y-4">
            <div className="flex items-center gap-2 text-amber-300">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <h3 className="text-sm font-bold text-white">Alterações não salvas</h3>
            </div>
            <p className="text-xs text-slate-400">Você tem alterações não salvas neste modelo dbt. Fechar agora vai descartá-las.</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                id="btn-dbt-editor-close-confirm-cancel"
                onClick={() => setShowCloseConfirm(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                id="btn-dbt-editor-close-confirm-discard"
                onClick={() => { setShowCloseConfirm(false); onClose(); }}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold transition cursor-pointer"
              >
                Fechar mesmo assim
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

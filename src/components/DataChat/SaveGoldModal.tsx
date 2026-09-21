import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, GitBranch, Loader2, Save, X } from 'lucide-react';
import {
  AgentHttpError,
  previewGoldModel,
  saveGoldModel,
  type GoldPreview,
  type GoldSaveResult,
  type SqlValidation,
} from '../../lib/dataChat';

interface SaveGoldModalProps {
  sql: string;
  yaml?: string;
  suggestedName?: string;
  goldPrefix: string;
  saveMode: string;
  onClose: () => void;
}

const GIT_NOTICE: Record<string, string> = {
  push: 'Ao salvar, o gateway grava os arquivos no projeto dbt e faz commit + push automático no repositório (branch principal).',
  commit: 'Ao salvar, o gateway grava os arquivos no projeto dbt e faz um commit local no servidor (sem push).',
  off: 'Ao salvar, o gateway grava os arquivos no projeto dbt do servidor, sem commit.',
};

const GIT_RESULT: Record<GoldSaveResult['git'], string> = {
  pushed: 'Commit e push feitos no repositório.',
  committed: 'Commit feito no servidor (sem push).',
  skipped: 'Arquivos gravados (sem commit — DBT_CODEGEN_GIT desligado).',
  failed: 'Arquivos gravados, mas o commit/push falhou.',
};

function initialSuffix(prefix: string, suggested?: string): string {
  const raw = (suggested || '').toLowerCase();
  if (raw.startsWith(prefix)) return raw.slice(prefix.length);
  return raw.replace(/^gold_/, '');
}

function ValidationBox({ v }: { v: SqlValidation }) {
  if (v.ok === true) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 space-y-1">
        <p className="font-semibold flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> SQL válido no BigQuery (dry run)</p>
        <p>
          {v.outputColumns.length} coluna(s) de saída
          {v.bytesEstimate !== null && ` · ~${(v.bytesEstimate / 1e6).toFixed(1)} MB processados`}
          {v.referencedTables.length > 0 && ` · lê ${v.referencedTables.join(', ')}`}
        </p>
        {v.outputColumns.length > 0 && (
          <p className="font-mono text-[11px] text-emerald-900/80 break-words">
            {v.outputColumns.slice(0, 14).map((c) => `${c.name}:${c.type}`).join(' · ')}{v.outputColumns.length > 14 ? ' …' : ''}
          </p>
        )}
      </div>
    );
  }
  if (v.ok === null) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        <p className="font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Validação parcial</p>
        <p className="mt-1">{v.note}</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 space-y-1">
      <p className="font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> O SQL não passou na validação</p>
      {v.errors.map((e, i) => <p key={i} className="font-mono text-[11px] break-words">{e}</p>)}
    </div>
  );
}

export const SaveGoldModal: React.FC<SaveGoldModalProps> = ({ sql, yaml, suggestedName, goldPrefix, saveMode, onClose }) => {
  const [suffix, setSuffix] = useState(() => initialSuffix(goldPrefix, suggestedName));
  const [preview, setPreview] = useState<GoldPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [acceptInvalid, setAcceptInvalid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<GoldSaveResult | null>(null);
  const reqId = useRef(0);

  const fullName = `${goldPrefix}${suffix}`;
  const suffixValid = /^[a-z0-9_]{1,60}$/.test(suffix);

  // Checa nome/escopo/YAML/dry run ao abrir e (com debounce) a cada mudança do nome.
  useEffect(() => {
    if (!suffixValid) { setPreview(null); return; }
    const id = ++reqId.current;
    setChecking(true);
    setPreviewError(null);
    const t = setTimeout(async () => {
      try {
        const p = await previewGoldModel({ name: fullName, sql, yaml });
        if (id === reqId.current) setPreview(p);
      } catch (err) {
        if (id === reqId.current) { setPreview(null); setPreviewError(err instanceof Error ? err.message : 'Falha ao verificar o modelo.'); }
      } finally {
        if (id === reqId.current) setChecking(false);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [fullName, suffixValid, sql, yaml]);

  const validation = preview?.validation;
  const needsAcceptInvalid = validation?.ok === false;
  const canSave = !!preview && suffixValid && !checking && !saving && (!preview.exists || overwrite) && (!needsAcceptInvalid || acceptInvalid);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      setSaved(await saveGoldModel({ name: fullName, sql, yaml, overwrite, acceptInvalid }));
    } catch (err) {
      setSaveError(err instanceof AgentHttpError || err instanceof Error ? err.message : 'Falha ao salvar o modelo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true" aria-label="Salvar como modelo Gold">
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl border border-slate-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2"><Save className="w-4 h-4 text-indigo-600" /> Salvar como modelo Gold</h3>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer" aria-label="Fechar"><X className="w-4 h-4" /></button>
        </div>

        {saved ? (
          <div className="p-5 space-y-3">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 space-y-2">
              <p className="font-semibold flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> Modelo {saved.overwritten ? 'atualizado' : 'salvo'}: <span className="font-mono">{saved.name}</span></p>
              <ul className="text-xs font-mono space-y-0.5">{saved.files.map((f) => <li key={f}>dbt/models/medallion/gold/{f}</li>)}</ul>
              <p className="text-xs flex items-center gap-1.5"><GitBranch className="w-3.5 h-3.5" /> {GIT_RESULT[saved.git]}{saved.gitDetail ? ` (${saved.gitDetail})` : ''}</p>
            </div>
            <p className="text-xs text-slate-500">
              O modelo ainda não foi construído no BigQuery — rode o dbt para materializá-lo. Em produção, lembre que a imagem do gateway leva o projeto dbt junto: um novo deploy do gateway publica os modelos commitados.
            </p>
            <div className="flex justify-end"><button type="button" onClick={onClose} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold cursor-pointer">Fechar</button></div>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Nome do modelo</label>
              <div className="flex items-stretch rounded-lg border border-slate-300 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-100 overflow-hidden">
                <span className="px-3 flex items-center bg-slate-50 text-slate-500 font-mono text-xs border-r border-slate-200 whitespace-nowrap">{goldPrefix}</span>
                <input
                  value={suffix}
                  onChange={(e) => { setSuffix(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_')); setOverwrite(false); }}
                  placeholder="faturamento_mensal_cliente"
                  className="flex-1 min-w-0 px-3 py-2 font-mono text-xs outline-none"
                  maxLength={60}
                />
              </div>
              {!suffixValid && <p className="text-[11px] text-red-600 mt-1">Use letras minúsculas, números e _ (1 a 60 caracteres).</p>}
            </div>

            {checking && <p className="text-xs text-slate-500 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Verificando o modelo no BigQuery…</p>}
            {previewError && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 break-words">{previewError}</div>}
            {validation && !checking && <ValidationBox v={validation} />}

            {preview?.exists && !checking && (
              <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 cursor-pointer">
                <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} className="mt-0.5" />
                <span>Já existe um modelo com este nome. Marque para <strong>sobrescrever</strong> o SQL e a documentação dele.</span>
              </label>
            )}
            {needsAcceptInvalid && !checking && (
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 cursor-pointer">
                <input type="checkbox" checked={acceptInvalid} onChange={(e) => setAcceptInvalid(e.target.checked)} className="mt-0.5" />
                <span>Salvar mesmo assim (por exemplo, se depende de outro modelo Gold que ainda não foi construído).</span>
              </label>
            )}

            <p className="text-xs text-slate-500 flex items-start gap-1.5"><GitBranch className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {GIT_NOTICE[saveMode] ?? GIT_NOTICE.off}</p>
            {yaml ? null : <p className="text-[11px] text-slate-400">A resposta não trouxe YAML de testes/documentação: só o .sql será salvo.</p>}
            {saveError && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 break-words">{saveError}</div>}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer">Cancelar</button>
              <button
                type="button"
                disabled={!canSave}
                onClick={handleSave}
                className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-lg text-xs font-semibold cursor-pointer transition"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Confirmar e salvar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

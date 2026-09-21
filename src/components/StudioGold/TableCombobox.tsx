import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import type { LineageNode } from '../../lib/lineage';

// -----------------------------------------------------------------------------
// Combobox pesquisável das tabelas de uma camada (Studio Visual ETL Gold). Digitar
// filtra a lista na hora, por qualquer parte do nome — sem acento, sem diferenciar
// maiúsculas e tratando "_" como espaço ("vendas bar" acha "..._vendas_bar"). Várias
// palavras = todas precisam aparecer (em qualquer ordem). Teclado: ↑ ↓ Enter Esc.
// -----------------------------------------------------------------------------

/** Minúsculas, sem acento e com `_`/`-` viradas espaço (1 para 1, o que preserva os índices para o destaque). */
export function normalizeSearch(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_-]/g, ' ');
}

/** Filtra por partes do texto: todas as palavras digitadas precisam estar no nome. Busca vazia = tudo. */
export function filterTables<T extends { name: string }>(items: T[], query: string): T[] {
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return items;
  return items.filter((it) => {
    const hay = normalizeSearch(it.name);
    return terms.every((t) => hay.includes(t));
  });
}

/** Parte do nome que casa com a primeira palavra da busca, para destacar (índices no nome original). */
function matchRange(name: string, query: string): [number, number] | null {
  const term = normalizeSearch(query).split(/\s+/).filter(Boolean)[0];
  if (!term) return null;
  // Só destaca quando a normalização manteve o tamanho (nome sem acento — o caso dos modelos dbt).
  const hay = normalizeSearch(name);
  if (hay.length !== name.length) return null;
  const at = hay.indexOf(term);
  return at < 0 ? null : [at, at + term.length];
}

const MAX_RENDERED = 300;

interface TableComboboxProps {
  label: string;
  options: LineageNode[];
  /** id do nó selecionado nesta camada (ou null). */
  value: string | null;
  onChange: (id: string) => void;
  placeholder: string;
  disabled?: boolean;
}

export const TableCombobox: React.FC<TableComboboxProps> = ({ label, options, value, onChange, placeholder, disabled = false }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const uid = useId();
  const listId = `${uid}-list`;

  const selected = useMemo(() => options.find((o) => o.id === value) ?? null, [options, value]);
  const filtered = useMemo(() => filterTables(options, query), [options, query]);
  const shown = filtered.slice(0, MAX_RENDERED);

  // Agrupa por integração mantendo a ordem em que aparecem (a ordem plana é a do teclado).
  const groups = useMemo(() => {
    const map = new Map<string, LineageNode[]>();
    for (const n of shown) map.set(n.integrationName || '', [...(map.get(n.integrationName || '') ?? []), n]);
    return [...map.entries()];
  }, [shown]);
  const flat = useMemo(() => groups.flatMap(([, nodes]) => nodes), [groups]);

  const close = () => { setOpen(false); setQuery(''); };
  const choose = (id: string) => { onChange(id); close(); inputRef.current?.blur(); };

  // Fechar ao clicar fora.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) close(); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // A busca mudou: volta o destaque para o primeiro resultado.
  useEffect(() => { setActiveIdx(0); }, [query, open]);

  // Mantém o item destacado visível ao navegar pelo teclado.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) setOpen(true); else setActiveIdx((i) => Math.min(flat.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (!open) setOpen(true); else setActiveIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { if (open && flat[activeIdx]) { e.preventDefault(); choose(flat[activeIdx].id); } }
    else if (e.key === 'Escape') { if (open) { e.preventDefault(); close(); } }
    else if (e.key === 'Tab') { close(); }
  };

  const isEmpty = options.length === 0;

  return (
    <div className="flex flex-col gap-1 min-w-0" ref={rootRef}>
      <label htmlFor={`${uid}-input`} className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label} ({options.length})</label>
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          ref={inputRef}
          id={`${uid}-input`}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && flat[activeIdx] ? `${uid}-opt-${activeIdx}` : undefined}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled || isEmpty}
          value={open ? query : (selected?.name ?? '')}
          placeholder={isEmpty ? `Nenhuma tabela ${label.replace(/^Tabela /, '')}` : (open && selected ? selected.name : placeholder)}
          onFocus={() => { if (!open) { setQuery(''); setOpen(true); } }}
          onClick={() => { if (!open) { setQuery(''); setOpen(true); } }}
          onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); }}
          onKeyDown={onKeyDown}
          className={`w-full text-xs border rounded-lg pl-8 pr-14 py-2 bg-white outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-400 truncate ${selected ? 'border-indigo-400 font-semibold' : 'border-slate-300'}`}
        />
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {selected && !disabled && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(''); close(); }} className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer" aria-label={`Limpar ${label}`} title="Limpar seleção">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <ChevronDown className={`w-3.5 h-3.5 text-slate-400 pointer-events-none transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>

        {open && (
          <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden min-w-[16rem]">
            <ul ref={listRef} id={listId} role="listbox" aria-label={label} className="max-h-64 overflow-y-auto py-1">
              {flat.length === 0 ? (
                <li className="px-3 py-2 text-xs text-slate-500" role="presentation">Nenhuma tabela encontrada para “{query}”.</li>
              ) : (() => {
                let idx = -1;
                return groups.map(([group, nodes]) => (
                  <React.Fragment key={group || '_'}>
                    {group && <li role="presentation" className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 truncate">{group}</li>}
                    {nodes.map((n) => {
                      idx += 1;
                      const i = idx;
                      const range = matchRange(n.name, query);
                      const isActive = i === activeIdx;
                      return (
                        <li
                          key={n.id}
                          id={`${uid}-opt-${i}`}
                          data-idx={i}
                          role="option"
                          aria-selected={n.id === value}
                          onMouseEnter={() => setActiveIdx(i)}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => choose(n.id)}
                          title={n.name}
                          className={`px-3 py-1.5 text-xs cursor-pointer break-all ${isActive ? 'bg-indigo-50 text-indigo-900' : 'text-slate-800'} ${n.id === value ? 'font-semibold' : ''}`}
                        >
                          {range
                            ? <>{n.name.slice(0, range[0])}<mark className="bg-amber-200 text-inherit rounded-sm">{n.name.slice(range[0], range[1])}</mark>{n.name.slice(range[1])}</>
                            : n.name}
                        </li>
                      );
                    })}
                  </React.Fragment>
                ));
              })()}
            </ul>
            <div className="px-3 py-1 border-t border-slate-100 text-[10px] text-slate-400 flex justify-between gap-2">
              <span>{query ? `${filtered.length} de ${options.length}` : `${options.length} tabela(s)`}{filtered.length > MAX_RENDERED ? ` — mostrando as ${MAX_RENDERED} primeiras` : ''}</span>
              <span className="hidden sm:inline">↑↓ navegar · Enter escolher · Esc fechar</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

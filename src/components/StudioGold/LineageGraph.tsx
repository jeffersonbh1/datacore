import React from 'react';
import { CheckCircle2, FilePenLine, Loader2, MinusCircle, XCircle } from 'lucide-react';
import {
  LAYER_LABEL, NODE_H, NODE_W,
  type Focus, type GraphLayout, type LineageEdge, type LineageIndex, type LineageLayer, type LineageNode,
} from '../../lib/lineage';
import type { RunState } from '../../lib/lineageExecution';

export const LAYER_STYLE: Record<LineageLayer, { card: string; badge: string }> = {
  source: { card: 'border-sky-300 bg-sky-50', badge: 'bg-sky-100 text-sky-700' },
  raw: { card: 'border-slate-300 bg-slate-50', badge: 'bg-slate-200 text-slate-700' },
  bronze: { card: 'border-orange-300 bg-orange-50', badge: 'bg-orange-100 text-orange-700' },
  silver: { card: 'border-blue-300 bg-blue-50', badge: 'bg-blue-100 text-blue-700' },
  gold: { card: 'border-amber-300 bg-amber-50', badge: 'bg-amber-100 text-amber-800' },
};

const UP_COLOR = '#6366f1'; // de onde o dado vem
const DOWN_COLOR = '#10b981'; // para onde o dado vai

export const formatRows = (n: number | null) => (n === null ? null : n.toLocaleString('pt-BR'));
export const formatWhen = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : null;

const RunIcon: React.FC<{ state: RunState }> = ({ state }) => {
  if (state === 'running') return <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" aria-label="Executando" />;
  if (state === 'success') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" aria-label="Concluído" />;
  if (state === 'error') return <XCircle className="w-3.5 h-3.5 text-red-600" aria-label="Erro" />;
  return <MinusCircle className="w-3.5 h-3.5 text-slate-400" aria-label="Pulado" />;
};

interface LineageGraphProps {
  index: LineageIndex;
  edges: LineageEdge[];
  focus: Focus;
  layout: GraphLayout;
  activeId: string | null;
  runStates: Map<string, RunState>;
  zoom: number;
  onSelectNode: (id: string) => void;
  /** Abre o editor dbt do modelo direto do nó (Bronze, Silver e Gold). */
  onOpenEditor?: (node: LineageNode) => void;
}

/** Camadas que têm modelo dbt — Origem e Raw vêm do Airbyte, sem SQL para editar. */
const isDbtModel = (layer: LineageLayer) => layer === 'bronze' || layer === 'silver' || layer === 'gold';

export const LineageGraph: React.FC<LineageGraphProps> = ({ index, edges, focus, layout, activeId, runStates, zoom, onSelectNode, onOpenEditor }) => {
  const upSet = new Set([...focus.upstream, focus.id]);
  const downSet = new Set([focus.id, ...focus.downstream]);

  return (
    <div style={{ width: layout.width * zoom, height: layout.height * zoom }} className="relative">
      <div style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})`, transformOrigin: '0 0' }} className="absolute left-0 top-0">
        {layout.columns.map((c) => (
          <div key={c.rank} style={{ left: c.x, top: 16, width: NODE_W }} className="absolute text-[11px] font-bold uppercase tracking-wider text-slate-400 text-center">
            {c.label}
          </div>
        ))}

        <svg width={layout.width} height={layout.height} className="absolute inset-0 pointer-events-none">
          <defs>
            {[['up', UP_COLOR], ['down', DOWN_COLOR]].map(([k, color]) => (
              <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
              </marker>
            ))}
          </defs>
          {edges.map((e) => {
            const s = layout.positions.get(e.source);
            const t = layout.positions.get(e.target);
            if (!s || !t) return null;
            const isUp = upSet.has(e.target) && upSet.has(e.source);
            const color = isUp ? UP_COLOR : DOWN_COLOR;
            const x1 = s.x + NODE_W, y1 = s.y + NODE_H / 2, x2 = t.x, y2 = t.y + NODE_H / 2;
            const dx = Math.max(24, (x2 - x1) * 0.5);
            return (
              <path
                key={e.id}
                d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
                fill="none" stroke={color} strokeWidth={2} strokeOpacity={0.75}
                markerEnd={`url(#arrow-${isUp ? 'up' : 'down'})`}
                data-edge={e.id} data-direction={isUp ? 'up' : downSet.has(e.source) ? 'down' : 'other'}
              />
            );
          })}
        </svg>

        {[...focus.ids].map((id) => {
          const n = index.byId.get(id)!;
          const pos = layout.positions.get(id);
          if (!pos) return null;
          const style = LAYER_STYLE[n.layer];
          const run = runStates.get(id);
          const rows = formatRows(n.rows);
          const when = formatWhen(n.lastModified);
          const isFocus = id === focus.id;
          const canOpenEditor = !!onOpenEditor && isDbtModel(n.layer);
          return (
            // Contêiner: o card e o botão de editar são irmãos (botão dentro de botão não é HTML válido).
            <div key={id} style={{ left: pos.x, top: pos.y, width: NODE_W, height: NODE_H }} className="absolute">
            <button
              type="button"
              data-node={id}
              onClick={() => onSelectNode(id)}
              className={`w-full h-full text-left rounded-xl border-2 px-3 py-2 shadow-sm transition cursor-pointer hover:shadow-md ${style.card} ${isFocus ? 'ring-4 ring-indigo-300' : ''} ${activeId === id ? 'outline outline-2 outline-slate-900' : ''}`}
              title={`${LAYER_LABEL[n.layer]} • ${n.dataset ? `${n.dataset}.` : ''}${n.name}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${style.badge}`}>{LAYER_LABEL[n.layer]}</span>
                {run ? <RunIcon state={run} /> : n.layer !== 'source' && (
                  <span className={`text-[10px] flex items-center gap-1 ${n.built ? 'text-emerald-700' : 'text-slate-400'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${n.built ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                    {n.built ? 'construída' : n.built === false || n.layer === 'gold' ? 'não construída' : '—'}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs font-semibold text-slate-900 truncate">{n.name}</p>
              <p className={`text-[10px] font-mono text-slate-500 truncate ${canOpenEditor ? 'pr-7' : ''}`}>{n.dataset || n.integrationName || ''}</p>
              <p className={`text-[10px] text-slate-500 truncate ${canOpenEditor ? 'pr-7' : ''}`}>
                {n.built && rows !== null ? `${rows} linhas` : ''}{n.built && rows !== null && when ? ' · ' : ''}{n.built && when ? when : ''}
              </p>
            </button>
            {canOpenEditor && (
              <button
                type="button"
                data-node-edit={id}
                onClick={() => onOpenEditor!(n)}
                title="Editar no dbt"
                aria-label={`Editar ${n.name} no dbt`}
                className="absolute bottom-2 right-2 p-1 rounded-md bg-white/90 border border-slate-200 text-slate-600 hover:text-indigo-700 hover:border-indigo-300 hover:bg-white shadow-xs transition cursor-pointer"
              >
                <FilePenLine className="w-3.5 h-3.5" />
              </button>
            )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

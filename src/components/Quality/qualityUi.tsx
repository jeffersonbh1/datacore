import React from 'react';
import type { QualityExecution } from '../../lib/quality';

const STATUS_STYLE: Record<QualityExecution['status'], { label: string; cls: string }> = {
  ok: { label: 'OK', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  rejeicoes: { label: 'Com quarentena', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  teste_falhou: { label: 'Teste reprovado', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  erro: { label: 'Erro', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
};

export const ExecutionStatusBadge: React.FC<{ status: QualityExecution['status'] }> = ({ status }) => {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.erro;
  return <span className={`inline-block text-[11px] px-2 py-0.5 rounded-md border font-medium ${s.cls}`}>{s.label}</span>;
};

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function formatPct(pct: number | null): string {
  if (pct === null) return '—';
  if (pct === 100) return '100%';
  return `${pct.toFixed(pct >= 99 ? 2 : 1)}%`;
}

export function formatCount(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : n.toLocaleString('pt-BR');
}

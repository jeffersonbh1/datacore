import React, { useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { StudioExecutionsSection } from './StudioExecutionsSection';
import { IngestionAlertsSection } from './IngestionAlertsSection';

/**
 * Tela Execuções: só o histórico do Studio Visual ETL Gold (tabela
 * studio_executions) — o fluxo inteiro ou uma tabela isolada, em qualquer
 * camada. O antigo histórico por pipeline (pipeline_runs) saiu daqui junto com
 * o Studio Visual ETL.
 */
export const ExecutionsView: React.FC<{ userName: string | null; canResolveAlerts: boolean }> = ({ userName, canResolveAlerts }) => {
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(() => new Date());

  return (
    <div id="executions-view-container" className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <Activity className="w-4.5 h-4.5 text-indigo-600" />
            Execuções
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Tudo que foi executado no Studio Visual ETL Gold (inclusive tabelas isoladas e Gold) — sobrevive à
            navegação entre telas, ao contrário do progresso mostrado no Studio.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400">
            Atualizado às {lastRefreshedAt.toLocaleTimeString('pt-BR')}
          </span>
          <button
            id="btn-refresh-executions"
            onClick={() => setLastRefreshedAt(new Date())}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-medium transition cursor-pointer shadow-2xs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Atualizar
          </button>
        </div>
      </div>

      <IngestionAlertsSection refreshKey={lastRefreshedAt.getTime()} userName={userName} canResolve={canResolveAlerts} />

      <StudioExecutionsSection refreshKey={lastRefreshedAt.getTime()} />
    </div>
  );
};

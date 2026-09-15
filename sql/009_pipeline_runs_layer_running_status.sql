-- =============================================================================
-- Fase 7 (continuação): adiciona 'running' como estado válido de
-- bronze_status/silver_status, para a tela "Execuções" mostrar "Construindo..."
-- enquanto a camada está em construção — mesma simetria que já existe para a
-- Raw (status 'running' vindo do próprio Airbyte). Até aqui só existiam os
-- estados terminais ('not_applicable' | 'built' | 'failed'), então a UI não
-- tinha como diferenciar "ainda não começou" de "construindo agora".
--
-- Gravado por VisualCanvas.handleExecutePipeline no início de cada camada, via
-- updatePipelineRunLayerStatus() em src/lib/supabase.ts.
--
-- Rode este script no SQL Editor do Supabase (mesmo projeto de 001..008).
-- =============================================================================

ALTER TABLE pipeline_runs DROP CONSTRAINT IF EXISTS pipeline_runs_bronze_status_check;
ALTER TABLE pipeline_runs ADD CONSTRAINT pipeline_runs_bronze_status_check
  CHECK (bronze_status IN ('not_applicable', 'running', 'built', 'failed'));

ALTER TABLE pipeline_runs DROP CONSTRAINT IF EXISTS pipeline_runs_silver_status_check;
ALTER TABLE pipeline_runs ADD CONSTRAINT pipeline_runs_silver_status_check
  CHECK (silver_status IN ('not_applicable', 'running', 'built', 'failed'));

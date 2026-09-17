import { Router } from 'express';
import { getSupabaseAdmin } from '../supabaseAdmin';
import { buildSilverViaDbt } from './silver';

export const silverAutoSyncRouter = Router();

interface IntegracaoRow {
  id: number;
  id_empresa: number;
  airbyte_connection_id: string | null;
  tabelas_selecionadas: string[];
  // Dataset desta integração específica — ver sql/012_integracoes_dataset_override.sql.
  dataset_override: string | null;
  destinos: { tipo: string; configuracao: Record<string, unknown> } | null;
  origens: { nome: string | null } | { nome: string | null }[] | null;
  pipelines: { id: number } | { id: number }[] | null;
}

interface StepResult {
  integracaoId: number;
  action: 'skipped' | 'silver_built' | 'silver_failed';
  detail: string;
}

// Fase 7 (continuação): mesmo princípio do auto-sync da Bronze
// (bronzeAutoSync.ts), um degrau acima — em vez de consultar o Airbyte de
// novo, reage ao que já está em pipeline_runs: se o job mais recente de uma
// integração já tem a Bronze construída (bronze_status = 'built') e a Silver
// ainda não (silver_status != 'built'), constrói a Silver e grava o
// resultado. Sem isso, a Silver só avançava com alguém clicando "Executar
// Pipeline" no Studio ou "Executar" na tela Execuções — uma integração
// rodando sozinha em produção nunca tinha a Silver atualizada.
// Também acionado pelo Cloud Scheduler (ver DEPLOY.md) — não roda sozinho
// porque o Cloud Run escala a zero. Idempotente: seguro chamar de novo para
// o mesmo job (silver_status = 'built' é pulado).
silverAutoSyncRouter.post('/', async (_req, res) => {
  try {
    const supabase = getSupabaseAdmin();
    const { data: integracoes, error } = await supabase
      .from('integracoes')
      .select('id, id_empresa, airbyte_connection_id, tabelas_selecionadas, dataset_override, destinos(tipo, configuracao), origens(nome), pipelines(id)')
      .eq('status', 'active')
      .not('airbyte_connection_id', 'is', null);

    if (error) throw new Error(error.message);

    const results: StepResult[] = [];

    for (const integ of (integracoes || []) as unknown as IntegracaoRow[]) {
      const destino = integ.destinos;
      const pipelineRow = Array.isArray(integ.pipelines) ? integ.pipelines[0] : integ.pipelines;

      if (!destino || destino.tipo !== 'bigquery' || !pipelineRow) {
        continue; // não-BigQuery, ou pipeline ainda não persistido — nada a fazer.
      }

      const cfg = destino.configuracao as { accountOrProject?: string; databaseOrDataset?: string; warehouseOrCluster?: string };
      const rawDataset = integ.dataset_override || cfg.databaseOrDataset;
      const projectId = cfg.accountOrProject;
      if (!rawDataset || !projectId || !rawDataset.startsWith('raw_')) {
        results.push({ integracaoId: integ.id, action: 'skipped', detail: 'destino BigQuery sem dataset raw_ configurado' });
        continue;
      }
      const bronzeDataset = rawDataset.replace(/^raw_/, 'bronze_');
      const silverDataset = rawDataset.replace(/^raw_/, 'silver_');

      // Job mais recente desta integração — mesma noção de "latest" que o
      // auto-sync da Bronze usa, só que lido direto de pipeline_runs (já
      // mantido pelo auto-sync da Bronze ou por uma execução manual) em vez
      // de bater no Airbyte de novo.
      const { data: runRow } = await supabase
        .from('pipeline_runs')
        .select('airbyte_job_id, status, bronze_status, silver_status')
        .eq('pipeline_id', pipelineRow.id)
        .order('iniciado_em', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!runRow) {
        results.push({ integracaoId: integ.id, action: 'skipped', detail: 'sem execução registrada ainda' });
        continue;
      }
      if (runRow.status !== 'succeeded') {
        results.push({ integracaoId: integ.id, action: 'skipped', detail: `último job com status "${runRow.status}"` });
        continue;
      }
      if (runRow.bronze_status !== 'built') {
        results.push({ integracaoId: integ.id, action: 'skipped', detail: `Bronze ainda não construída (bronze_status="${runRow.bronze_status}")` });
        continue;
      }
      if (runRow.silver_status === 'built') {
        results.push({ integracaoId: integ.id, action: 'skipped', detail: 'Silver já construída para este job' });
        continue;
      }

      const tables = integ.tabelas_selecionadas || [];
      if (tables.length === 0) {
        results.push({ integracaoId: integ.id, action: 'skipped', detail: 'integração sem tabelas selecionadas' });
        continue;
      }

      const origem = Array.isArray(integ.origens) ? integ.origens[0] : integ.origens;
      const sistema = origem?.nome || 'sistema';

      const { results: tableResults } = await buildSilverViaDbt({
        projectId,
        rawDataset,
        bronzeDataset,
        silverDataset,
        tables,
        sistema,
        location: cfg.warehouseOrCluster || undefined,
      });
      // Normaliza para o formato TableBuildResult (src/lib/pipelineBuilder.ts)
      // que a tela Execuções espera em silver_tables — TableResult
      // (server/routes/silver.ts) usa campos opcionais (undefined), o front
      // usa `| null`. Mesmo ajuste feito no auto-sync da Bronze.
      const silverTables = tableResults.map(r => ({
        table: r.table,
        status: r.status,
        rowsAffected: r.rowsAffected ?? null,
        error: r.error ?? null,
      }));
      const failed = silverTables.filter(r => r.status === 'error');
      const hasFailure = failed.length > 0;

      await supabase
        .from('pipeline_runs')
        .update({
          silver_status: hasFailure ? 'failed' : 'built',
          silver_built_em: new Date().toISOString(),
          silver_error: hasFailure ? failed.map(t => `${t.table}: ${t.error}`).join(' | ') : null,
          silver_tables: silverTables,
        })
        .eq('pipeline_id', pipelineRow.id)
        .eq('airbyte_job_id', runRow.airbyte_job_id);

      results.push({
        integracaoId: integ.id,
        action: hasFailure ? 'silver_failed' : 'silver_built',
        detail: `${silverTables.length} tabela(s), job ${runRow.airbyte_job_id}`,
      });
    }

    res.json({ processed: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Erro no auto-sync da camada Silver.' });
  }
});

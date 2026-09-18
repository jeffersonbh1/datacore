import { Router } from 'express';
import { getBigQueryClient } from '../bigqueryClient';
import { getGcpAccessToken } from '../gcpAuth';
import { getGcpPricing } from '../gcpPricing';

export const costsRouter = Router();

// -----------------------------------------------------------------------------
// Custos & FinOps com dados reais: inventário real de recursos GCP (Compute
// Engine, Cloud Run, BigQuery, Artifact Registry, Secret Manager) + uso real
// medido (Cloud Monitoring / BigQuery INFORMATION_SCHEMA) × preço público de
// lista ao vivo (gcpPricing.ts). NÃO é a fatura oficial do Cloud Billing —
// não há billing export configurado neste projeto — mas é honesto: recurso
// real, uso real, preço real de lista.
// -----------------------------------------------------------------------------

export interface GcpResourceCost {
  id: string;
  category: 'compute' | 'cloud_run' | 'bigquery' | 'artifact_registry' | 'secret_manager' | 'other';
  label: string;
  detail: string;
  monthlyCostUsd: number;
  basis: string;
}

export interface CostRecommendation {
  id: string;
  title: string;
  description: string;
  potentialSavingsUsd: number;
  effort: 'baixo' | 'medio' | 'alto';
  suggestedCommand?: string;
}

export interface GcpCostReport {
  generatedAt: string;
  projectId: string;
  region: string;
  resources: GcpResourceCost[];
  dailyTrend: { date: string; computeUsd: number; cloudRunUsd: number; bigqueryUsd: number }[];
  recommendations: CostRecommendation[];
  totalMonthlyCostUsd: number;
  notes: string[];
}

const HOURS_PER_MONTH = 730; // média GCP (365*24/12) — mesma convenção usada no console de preços.

async function gcpGet<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`GET ${url} -> HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

// --- Compute Engine ----------------------------------------------------------

interface ComputeInstance {
  id: string;
  name: string;
  status: string;
  machineType: string; // URL completa
  zone: string; // URL completa
  disks?: Array<{ diskSizeGb?: string; source?: string; type?: string }>;
}

interface MachineTypeInfo { guestCpus: number; memoryMb: number }

async function listComputeInstances(token: string, projectId: string): Promise<ComputeInstance[]> {
  const data = await gcpGet<{ items?: Record<string, { instances?: ComputeInstance[] }> }>(
    `https://compute.googleapis.com/compute/v1/projects/${projectId}/aggregated/instances`,
    token,
  );
  const out: ComputeInstance[] = [];
  for (const scope of Object.values(data.items || {})) {
    out.push(...(scope.instances || []));
  }
  return out;
}

async function getMachineTypeInfo(token: string, machineTypeUrl: string): Promise<MachineTypeInfo> {
  // machineTypeUrl: .../projects/{p}/zones/{z}/machineTypes/{name}
  const data = await gcpGet<{ guestCpus: number; memoryMb: number }>(machineTypeUrl, token);
  return { guestCpus: data.guestCpus, memoryMb: data.memoryMb };
}

interface ExternalAddress { name: string; address: string; status: string; addressType: string }

async function listExternalAddresses(token: string, projectId: string): Promise<ExternalAddress[]> {
  const data = await gcpGet<{ items?: Record<string, { addresses?: ExternalAddress[] }> }>(
    `https://compute.googleapis.com/compute/v1/projects/${projectId}/aggregated/addresses`,
    token,
  );
  const out: ExternalAddress[] = [];
  for (const scope of Object.values(data.items || {})) {
    out.push(...(scope.addresses || []).filter((a) => a.addressType === 'EXTERNAL'));
  }
  return out;
}

// --- Cloud Run (API v1 / Knative-compatível — mesmo shape que `gcloud run services describe` usa) --

interface CloudRunService {
  metadata: { name: string };
  spec: { template: { spec: { containers: Array<{ resources?: { limits?: { cpu?: string; memory?: string } } }> } } };
  status?: unknown;
}

async function listCloudRunServices(token: string, projectId: string, region: string): Promise<Array<{
  name: string; cpu: number; memoryGiB: number; cpuThrottling: boolean;
}>> {
  const data = await gcpGet<{ items?: Array<CloudRunService & {
    spec: CloudRunService['spec'] & { template: { metadata?: { annotations?: Record<string, string> } } & CloudRunService['spec']['template'] };
  }> }>(
    `https://${region}-run.googleapis.com/apis/serving.knative.dev/v1/namespaces/${projectId}/services`,
    token,
  );
  return (data.items || []).map((svc) => {
    const limits = svc.spec.template.spec.containers[0]?.resources?.limits || {};
    const annotations = (svc.spec.template as unknown as { metadata?: { annotations?: Record<string, string> } }).metadata?.annotations || {};
    const cpu = Number((limits.cpu || '1').replace('m', '')) / (String(limits.cpu || '1').includes('m') ? 1000 : 1);
    const memRaw = limits.memory || '256Mi';
    const memoryGiB = memRaw.endsWith('Gi') ? Number(memRaw.replace('Gi', ''))
      : memRaw.endsWith('Mi') ? Number(memRaw.replace('Mi', '')) / 1024
      : Number(memRaw) / (1024 ** 3);
    return {
      name: svc.metadata.name,
      cpu,
      memoryGiB,
      cpuThrottling: annotations['run.googleapis.com/cpu-throttling'] !== 'false',
    };
  });
}

// --- Cloud Monitoring ---------------------------------------------------------

function fmtTs(d: Date): string {
  return d.toISOString().replace(/\.\d+Z$/, 'Z');
}

/** Soma de uma métrica DELTA num intervalo (ex.: billable_instance_time em segundos). */
async function monitoringSum(token: string, projectId: string, filter: string, days: number): Promise<number> {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400_000);
  const url = new URL(`https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries`);
  url.searchParams.set('filter', filter);
  url.searchParams.set('interval.startTime', fmtTs(start));
  url.searchParams.set('interval.endTime', fmtTs(end));
  url.searchParams.set('aggregation.alignmentPeriod', `${days * 86400}s`);
  url.searchParams.set('aggregation.perSeriesAligner', 'ALIGN_SUM');
  const data = await gcpGet<{ timeSeries?: Array<{ points: Array<{ value: { doubleValue?: number; int64Value?: string } }> }> }>(url.toString(), token);
  const pts = data.timeSeries?.[0]?.points || [];
  return pts.reduce((sum, p) => sum + (p.value.doubleValue ?? Number(p.value.int64Value || 0)), 0);
}

/** Série diária de uma métrica DELTA, últimos N dias (0 pros dias sem dado). */
async function monitoringDailySeries(token: string, projectId: string, filter: string, days: number): Promise<Map<string, number>> {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400_000);
  const url = new URL(`https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries`);
  url.searchParams.set('filter', filter);
  url.searchParams.set('interval.startTime', fmtTs(start));
  url.searchParams.set('interval.endTime', fmtTs(end));
  url.searchParams.set('aggregation.alignmentPeriod', '86400s');
  url.searchParams.set('aggregation.perSeriesAligner', 'ALIGN_SUM');
  const data = await gcpGet<{ timeSeries?: Array<{ points: Array<{ interval: { endTime: string }; value: { doubleValue?: number; int64Value?: string } }> }> }>(url.toString(), token);
  const out = new Map<string, number>();
  for (const p of data.timeSeries?.[0]?.points || []) {
    const date = p.interval.endTime.slice(0, 10);
    out.set(date, (p.value.doubleValue ?? Number(p.value.int64Value || 0)));
  }
  return out;
}

async function monitoringAvgMax(token: string, projectId: string, filter: string, days: number): Promise<{ avg: number; max: number }> {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400_000);
  const url = new URL(`https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries`);
  url.searchParams.set('filter', filter);
  url.searchParams.set('interval.startTime', fmtTs(start));
  url.searchParams.set('interval.endTime', fmtTs(end));
  url.searchParams.set('aggregation.alignmentPeriod', '3600s');
  url.searchParams.set('aggregation.perSeriesAligner', 'ALIGN_MEAN');
  const data = await gcpGet<{ timeSeries?: Array<{ points: Array<{ value: { doubleValue?: number } }> }> }>(url.toString(), token);
  const vals = (data.timeSeries?.[0]?.points || []).map((p) => p.value.doubleValue || 0);
  if (vals.length === 0) return { avg: 0, max: 0 };
  return { avg: vals.reduce((a, b) => a + b, 0) / vals.length, max: Math.max(...vals) };
}

// --- Artifact Registry / Secret Manager ---------------------------------------

async function getArtifactRegistryStorageBytes(token: string, projectId: string, region: string): Promise<number> {
  const data = await gcpGet<{ repositories?: Array<{ sizeBytes?: string }> }>(
    `https://artifactregistry.googleapis.com/v1/projects/${projectId}/locations/${region}/repositories`,
    token,
  );
  return (data.repositories || []).reduce((sum, r) => sum + Number(r.sizeBytes || 0), 0);
}

async function getSecretVersionCount(token: string, projectId: string): Promise<number> {
  const data = await gcpGet<{ secrets?: Array<{ name: string }> }>(
    `https://secretmanager.googleapis.com/v1/projects/${projectId}/secrets`,
    token,
  );
  const secrets = data.secrets || [];
  const counts = await Promise.all(secrets.map(async (s) => {
    const v = await gcpGet<{ versions?: Array<{ state: string }> }>(`https://secretmanager.googleapis.com/v1/${s.name}/versions`, token);
    return (v.versions || []).filter((ver) => ver.state === 'ENABLED').length;
  }));
  return counts.reduce((a, b) => a + b, 0);
}

// --- BigQuery ------------------------------------------------------------------

/**
 * Uso real do BigQuery via a service account dedicada (server/bigqueryClient.ts
 * — BIGQUERY_CREDENTIALS_JSON). Precisa de roles/bigquery.resourceViewer no
 * projeto (concedido nesta sessão) além do papel de dado que ela já tinha —
 * sem isso, JOBS_BY_PROJECT/JOBS_BY_USER/JOBS todos negam com 403
 * (confirmado em produção: nem a identity de runtime do Cloud Run, com
 * roles/editor, tinha "bigquery.jobs.listAll" — não é papel incluso no
 * Editor legado).
 */
async function getBigQueryUsage(region: string): Promise<{
  bytesBilled30d: number; dailyBytesBilled: Map<string, number>; storageBytes: number;
}> {
  const bq = getBigQueryClient();

  const [jobRows] = await bq.query({
    query: `
      SELECT DATE(creation_time) AS d, SUM(total_bytes_billed) AS bytes_billed
      FROM \`region-${region}\`.INFORMATION_SCHEMA.JOBS_BY_PROJECT
      WHERE creation_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
      GROUP BY d
    `,
  });
  const dailyBytesBilled = new Map<string, number>();
  let bytesBilled30d = 0;
  for (const r of jobRows as Array<{ d: { value: string }; bytes_billed: string | number }>) {
    const bytes = Number(r.bytes_billed || 0);
    dailyBytesBilled.set(r.d.value, bytes);
    bytesBilled30d += bytes;
  }

  const [datasets] = await bq.getDatasets();
  let storageBytes = 0;
  await Promise.all(datasets.map(async (ds) => {
    try {
      const [rows] = await bq.query({
        query: `SELECT SUM(size_bytes) AS bytes FROM \`${ds.id}\`.__TABLES__`,
      });
      storageBytes += Number((rows[0] as { bytes: number | null } | undefined)?.bytes || 0);
    } catch {
      // Dataset vazio ou sem tabelas: __TABLES__ pode falhar/retornar vazio — não é fatal pro total.
    }
  }));

  return { bytesBilled30d, dailyBytesBilled, storageBytes };
}

// --- Rota principal --------------------------------------------------------------

interface CachedReport { value: GcpCostReport; expiresAt: number }
let cache: CachedReport | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h — inventário/uso não muda minuto a minuto; evita ~20 chamadas GCP a cada carregamento de tela.

const DAYS_TREND = 7;

costsRouter.get('/gcp', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === '1';
    if (!forceRefresh && cache && cache.expiresAt > Date.now()) {
      res.json(cache.value);
      return;
    }

    const projectId = process.env.DBT_GCP_PROJECT;
    const region = process.env.DBT_GCP_LOCATION || 'southamerica-east1';
    if (!projectId) {
      res.status(503).json({ error: 'DBT_GCP_PROJECT não configurado no servidor — necessário para descobrir os recursos GCP.' });
      return;
    }

    const token = await getGcpAccessToken();
    const [pricing, instances, addresses, runServices, bqUsage, arBytes, secretVersions] = await Promise.all([
      getGcpPricing(region),
      listComputeInstances(token, projectId),
      listExternalAddresses(token, projectId),
      listCloudRunServices(token, projectId, region),
      getBigQueryUsage(region),
      getArtifactRegistryStorageBytes(token, projectId, region),
      getSecretVersionCount(token, projectId),
    ]);

    const resources: GcpResourceCost[] = [];
    const notes: string[] = [
      'Estimativa por uso real medido (Cloud Monitoring / BigQuery INFORMATION_SCHEMA) × preço público de lista do GCP (Cloud Billing Catalog) — não é a fatura oficial do Cloud Billing (este projeto não tem billing export configurado).',
    ];

    // --- Compute Engine (VM + disco) ---
    let computeMonthlyTotal = 0;
    const vmRecommendations: CostRecommendation[] = [];
    for (const inst of instances) {
      const zoneName = inst.zone.split('/').pop() || '';
      const machineTypeName = inst.machineType.split('/').pop() || '';
      let cpuMonthly = 0;
      let ramMonthly = 0;
      let vcpus = 0;
      let cpuAvgPct = 0;
      let cpuMaxPct = 0;
      if (inst.status === 'RUNNING') {
        const mt = await getMachineTypeInfo(token, inst.machineType);
        vcpus = mt.guestCpus;
        cpuMonthly = mt.guestCpus * pricing.computeE2CorePerHour * HOURS_PER_MONTH;
        ramMonthly = (mt.memoryMb / 1024) * pricing.computeE2RamPerGiBHour * HOURS_PER_MONTH;
        try {
          const util = await monitoringAvgMax(
            token, projectId,
            `metric.type="compute.googleapis.com/instance/cpu/utilization" resource.type="gce_instance" resource.labels.instance_id="${inst.id}"`,
            DAYS_TREND,
          );
          cpuAvgPct = util.avg * 100;
          cpuMaxPct = util.max * 100;
        } catch {
          // Métrica pode não estar disponível ainda para instâncias muito novas — segue sem recomendação de rightsizing.
        }
      } else {
        notes.push(`"${inst.name}" está parada agora (status ${inst.status}) — sem cobrança de compute enquanto assim, e sem dado de CPU pra sugerir redimensionamento até ela rodar de novo.`);
      }
      const diskGb = (inst.disks || []).reduce((sum, d) => sum + Number(d.diskSizeGb || 0), 0);
      const diskMonthly = diskGb * pricing.computePdBalancedPerGiBMonth;
      const total = cpuMonthly + ramMonthly + diskMonthly;
      computeMonthlyTotal += total;

      resources.push({
        id: `compute-${inst.name}`,
        category: 'compute',
        label: `Compute Engine — ${inst.name}`,
        detail: inst.status === 'RUNNING'
          ? `${machineTypeName} (${vcpus} vCPU) em ${zoneName}, disco ${diskGb}GB — CPU real: ${cpuAvgPct.toFixed(1)}% média / ${cpuMaxPct.toFixed(1)}% pico (${DAYS_TREND}d)`
          : `${machineTypeName} em ${zoneName} — status ${inst.status} (sem cobrança de compute enquanto parada, disco ${diskGb}GB continua cobrando)`,
        monthlyCostUsd: total,
        basis: 'preço de lista E2 on-demand × 730h/mês (instância rodando) + disco',
      });

      // Recomendação real: CPU média abaixo de 30% em instância com 4+ vCPUs -> vale redimensionar.
      if (inst.status === 'RUNNING' && vcpus >= 4 && cpuAvgPct > 0 && cpuAvgPct < 30) {
        const targetVcpus = Math.max(2, Math.ceil(vcpus / 4));
        const family = machineTypeName.split('-')[0] || 'e2';
        const targetType = `${family}-standard-${targetVcpus}`;
        const targetRamGb = targetVcpus * 4;
        const targetMonthly = targetVcpus * pricing.computeE2CorePerHour * HOURS_PER_MONTH
          + targetRamGb * pricing.computeE2RamPerGiBHour * HOURS_PER_MONTH
          + diskGb * pricing.computePdBalancedPerGiBMonth;
        vmRecommendations.push({
          id: `rec-rightsize-${inst.name}`,
          title: `Redimensionar ${inst.name} (${machineTypeName} → ${targetType})`,
          description: `CPU real dos últimos ${DAYS_TREND} dias: ${cpuAvgPct.toFixed(1)}% média, ${cpuMaxPct.toFixed(1)}% de pico em ${vcpus} vCPUs — ainda sobraria folga com ${targetVcpus} vCPUs.`,
          potentialSavingsUsd: Math.max(0, total - targetMonthly),
          effort: 'medio',
          suggestedCommand: `gcloud compute instances stop ${inst.name} --zone=${zoneName} && gcloud compute instances set-machine-type ${inst.name} --zone=${zoneName} --machine-type=${targetType} && gcloud compute instances start ${inst.name} --zone=${zoneName}`,
        });
      }
    }

    // --- IP estático externo ---
    for (const addr of addresses) {
      const billable = addr.status !== 'IN_USE';
      const monthly = billable ? pricing.computeStaticIpPerHour * HOURS_PER_MONTH : 0;
      resources.push({
        id: `ip-${addr.name}`,
        category: 'compute',
        label: `IP estático — ${addr.name}`,
        detail: billable
          ? `${addr.address} reservado sem uso — cobra mesmo parado`
          : `${addr.address} atrelado a um recurso em execução — sem cobrança`,
        monthlyCostUsd: monthly,
        basis: 'GCP só cobra IP externo estático quando reservado e SEM uso',
      });
      if (billable) {
        notes.push(`IP estático "${addr.name}" está reservado mas sem uso — considere liberá-lo se não for mais necessário.`);
      }
    }

    // --- Cloud Run ---
    const cloudRunDaily = new Map<string, number>();
    for (const svc of runServices) {
      const filter = `metric.type="run.googleapis.com/container/billable_instance_time" resource.type="cloud_run_revision" resource.labels.service_name="${svc.name}"`;
      const [seconds30d, daily] = await Promise.all([
        monitoringSum(token, projectId, filter, 30),
        monitoringDailySeries(token, projectId, filter, DAYS_TREND),
      ]);
      const monthly = seconds30d * (svc.cpu * pricing.cloudRunInstanceCpuPerSecond + svc.memoryGiB * pricing.cloudRunInstanceMemPerGiBSecond);
      for (const [date, secs] of daily) {
        const usd = secs * (svc.cpu * pricing.cloudRunInstanceCpuPerSecond + svc.memoryGiB * pricing.cloudRunInstanceMemPerGiBSecond);
        cloudRunDaily.set(date, (cloudRunDaily.get(date) || 0) + usd);
      }
      resources.push({
        id: `run-${svc.name}`,
        category: 'cloud_run',
        label: `Cloud Run — ${svc.name}`,
        detail: `${svc.cpu} vCPU / ${svc.memoryGiB.toFixed(2)}GiB, ${svc.cpuThrottling ? 'billing por request' : 'CPU sempre alocada'} — ${(seconds30d / 3600).toFixed(2)}h de instância real em 30d`,
        monthlyCostUsd: monthly,
        basis: 'segundos de instância reais (Cloud Monitoring) × preço de lista instance-based',
      });
    }

    // --- BigQuery ---
    const bqAnalysisMonthly = (bqUsage.bytesBilled30d / (1024 ** 4)) * pricing.bigQueryAnalysisPerTiB;
    const storageGiB = bqUsage.storageBytes / (1024 ** 3);
    const bqStorageMonthly = Math.max(0, storageGiB - 10) * pricing.bigQueryActiveStoragePerGiBMonth; // 10GB free tier
    resources.push({
      id: 'bigquery',
      category: 'bigquery',
      label: 'BigQuery',
      detail: `${(bqUsage.bytesBilled30d / (1024 ** 3)).toFixed(2)}GiB processados em queries (30d), ${storageGiB.toFixed(4)}GiB armazenados`,
      monthlyCostUsd: bqAnalysisMonthly + bqStorageMonthly,
      basis: 'bytes processados reais (INFORMATION_SCHEMA.JOBS) × preço on-demand + storage acima do free tier de 10GB',
    });
    const bqDaily = new Map<string, number>();
    for (const [date, bytes] of bqUsage.dailyBytesBilled) {
      bqDaily.set(date, (bytes / (1024 ** 4)) * pricing.bigQueryAnalysisPerTiB);
    }

    // --- Artifact Registry ---
    const arGiB = arBytes / (1024 ** 3);
    const arMonthly = Math.max(0, arGiB - 0.5) * pricing.artifactRegistryStoragePerGiBMonth; // 0.5GB free tier
    resources.push({
      id: 'artifact-registry',
      category: 'artifact_registry',
      label: 'Artifact Registry',
      detail: `${arGiB.toFixed(2)}GiB de imagens Docker armazenadas (sem política de retenção)`,
      monthlyCostUsd: arMonthly,
      basis: 'storage real × preço de lista, acima do free tier de 0.5GB',
    });
    if (arGiB > 2) {
      vmRecommendations.push({
        id: 'rec-ar-cleanup',
        title: 'Política de retenção de imagens no Artifact Registry',
        description: `${arGiB.toFixed(2)}GiB acumulados em versões antigas de imagem (cada deploy empilha uma nova) — cresce a cada redeploy sem limpeza automática.`,
        potentialSavingsUsd: arMonthly,
        effort: 'baixo',
        suggestedCommand: `gcloud artifacts repositories set-cleanup-policies cloud-run-source-deploy --location=${region} --policy=cleanup-policy.json`,
      });
    }

    // --- Secret Manager ---
    const smMonthly = Math.max(0, secretVersions - 6) * pricing.secretManagerVersionPerMonth; // 6 versões free tier
    resources.push({
      id: 'secret-manager',
      category: 'secret_manager',
      label: 'Secret Manager',
      detail: `${secretVersions} versões de secret ativas`,
      monthlyCostUsd: smMonthly,
      basis: 'versões ativas acima do free tier de 6',
    });

    // --- Supabase (confirmado manualmente: plano Free, ver conversa) ---
    resources.push({
      id: 'supabase',
      category: 'other',
      label: 'Supabase',
      detail: 'Plano Free (Auth + Postgres/RLS)',
      monthlyCostUsd: 0,
      basis: 'informado manualmente — não é uma API do GCP',
    });

    const totalMonthlyCostUsd = resources.reduce((sum, r) => sum + r.monthlyCostUsd, 0);

    // --- Daily trend (7d): compute é praticamente fixo (VM roda 24/7), Cloud Run/BigQuery variam de verdade ---
    const dailyTrend: GcpCostReport['dailyTrend'] = [];
    const computeDailyUsd = computeMonthlyTotal / 30;
    for (let i = DAYS_TREND - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400_000);
      const key = d.toISOString().slice(0, 10);
      dailyTrend.push({
        date: key,
        computeUsd: computeDailyUsd,
        cloudRunUsd: cloudRunDaily.get(key) || 0,
        bigqueryUsd: bqDaily.get(key) || 0,
      });
    }

    const report: GcpCostReport = {
      generatedAt: new Date().toISOString(),
      projectId,
      region,
      resources,
      dailyTrend,
      recommendations: vmRecommendations,
      totalMonthlyCostUsd,
      notes,
    };

    cache = { value: report, expiresAt: Date.now() + CACHE_TTL_MS };
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao consultar custos GCP.' });
  }
});

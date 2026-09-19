import { Router } from 'express';
import { getBigQueryClient } from '../bigqueryClient';
import { getGcpAccessToken } from '../gcpAuth';
import { GcpPricing, getGcpPricing } from '../gcpPricing';

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

// América/Sao_Paulo é UTC-3 fixo (sem horário de verão desde 2019) — dá pra
// tratar como offset constante em vez de precisar de uma lib de timezone.
// Sem isso, os buckets "diários" da Monitoring API alinham em janelas de 24h
// contadas de trás pra frente a partir de "agora" (não em dias de calendário
// de verdade) e a query do BigQuery agrupava em UTC — nenhum dos dois batia
// com o dia que aparece no Console pro usuário (fuso São Paulo).
const SP_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Início (instante UTC real) do dia de calendário em São Paulo que termina `daysAgo` dias atrás. */
function spMidnightUtc(daysAgo: number): Date {
  const spNow = new Date(Date.now() - SP_OFFSET_MS);
  const y = spNow.getUTCFullYear(), m = spNow.getUTCMonth(), d = spNow.getUTCDate();
  return new Date(Date.UTC(y, m, d - daysAgo) + SP_OFFSET_MS);
}

/** Início (instante UTC real) do mês de calendário atual em São Paulo — pro
 *  "gasto real desde o dia 1", mesmo período que o relatório padrão do
 *  Console de Billing ("Mês atual") usa. */
function spMonthStartUtc(): Date {
  const spNow = new Date(Date.now() - SP_OFFSET_MS);
  return new Date(Date.UTC(spNow.getUTCFullYear(), spNow.getUTCMonth(), 1) + SP_OFFSET_MS);
}

/** Quantos dias tem o mês de calendário atual em São Paulo (28-31). */
function spDaysInCurrentMonth(): number {
  const spNow = new Date(Date.now() - SP_OFFSET_MS);
  return new Date(Date.UTC(spNow.getUTCFullYear(), spNow.getUTCMonth() + 1, 0)).getUTCDate();
}

/**
 * Soma de uma métrica DELTA numa janela [start, end) — SEMPRE exatamente 1
 * bucket (alignmentPeriod = a janela inteira). Importante: quando se pede
 * VÁRIOS buckets numa query só (alignmentPeriod menor que o intervalo todo),
 * a Monitoring API ancora o alinhamento em `interval.endTime` (que aqui
 * normalmente é "agora", um alvo móvel), NÃO em `interval.startTime` como o
 * nome sugere — confirmado testando manualmente (os buckets devolvidos batiam
 * no horário de "agora", não em meia-noite). Isso faz qualquer tentativa de
 * alinhar buckets a dias de calendário numa query multi-bucket falhar sem
 * aviso. Pedir 1 bucket por vez, com a janela exata desejada, contorna isso
 * por completo — mesmo truque que este arquivo já usava pro total de 30d.
 */
async function monitoringSumWindow(token: string, projectId: string, filter: string, start: Date, end: Date): Promise<number> {
  const periodSec = Math.max(1, Math.round((end.getTime() - start.getTime()) / 1000));
  const url = new URL(`https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries`);
  url.searchParams.set('filter', filter);
  url.searchParams.set('interval.startTime', fmtTs(start));
  url.searchParams.set('interval.endTime', fmtTs(end));
  url.searchParams.set('aggregation.alignmentPeriod', `${periodSec}s`);
  url.searchParams.set('aggregation.perSeriesAligner', 'ALIGN_SUM');
  const data = await gcpGet<{ timeSeries?: Array<{ points: Array<{ value: { doubleValue?: number; int64Value?: string } }> }> }>(url.toString(), token);
  const pts = data.timeSeries?.[0]?.points || [];
  return pts.reduce((sum, p) => sum + (p.value.doubleValue ?? Number(p.value.int64Value || 0)), 0);
}

/** Soma de uma métrica DELTA nos últimos `days` dias corridos (não precisa de alinhamento de dia — usado só pra totais). */
async function monitoringSum(token: string, projectId: string, filter: string, days: number): Promise<number> {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400_000);
  return monitoringSumWindow(token, projectId, filter, start, end);
}

/** [{ label, start, end }] pros últimos `days` dias de calendário em São
 *  Paulo (mais antigo primeiro) — hoje vai até AGORA, não até a meia-noite
 *  de amanhã (ainda não terminou). */
function spDayWindows(days: number): Array<{ label: string; start: Date; end: Date }> {
  const now = new Date();
  return Array.from({ length: days }, (_, k) => {
    const i = days - 1 - k;
    const start = spMidnightUtc(i);
    const end = i === 0 ? now : spMidnightUtc(i - 1);
    return { label: start.toISOString().slice(0, 10), start, end };
  });
}

/** Série diária (dias de calendário em São Paulo) de uma métrica DELTA, últimos N dias — 1 query por dia (ver monitoringSumWindow). */
async function monitoringDailySeries(token: string, projectId: string, filter: string, days: number): Promise<Map<string, number>> {
  const windows = spDayWindows(days);
  const sums = await Promise.all(windows.map((w) => monitoringSumWindow(token, projectId, filter, w.start, w.end)));
  const out = new Map<string, number>();
  windows.forEach((w, idx) => out.set(w.label, sums[idx]));
  return out;
}

/**
 * Custo real de compute por dia de calendário (São Paulo): soma o uptime real
 * da instância (compute.googleapis.com/instance/uptime) por dia × preço
 * atual do tipo de máquina — em vez de assumir o status de AGORA constante
 * pros últimos N dias, o que é falso pra uma VM que liga/desliga várias
 * vezes ao dia (ver conversa — foi isso que causava o "17/09: $0,28" quando
 * o Console mostrava um valor real bem maior).
 */
async function getVmDailyUptimeCost(
  token: string, projectId: string, instanceId: string,
  vcpus: number, memoryMb: number, pricing: GcpPricing, days: number,
): Promise<Map<string, number>> {
  const filter = `metric.type="compute.googleapis.com/instance/uptime" resource.type="gce_instance" resource.labels.instance_id="${instanceId}"`;
  const secondsPerDay = await monitoringDailySeries(token, projectId, filter, days);
  const hourlyRate = vcpus * pricing.computeE2CorePerHour + (memoryMb / 1024) * pricing.computeE2RamPerGiBHour;
  const out = new Map<string, number>();
  for (const [date, secs] of secondsPerDay) out.set(date, (secs / 3600) * hourlyRate);
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

/** Soma dos bytes billable (já deduplicados/incrementais, conforme a própria API) de todos os snapshots do projeto. */
async function getSnapshotStorageBytes(token: string, projectId: string): Promise<number> {
  const data = await gcpGet<{ items?: Array<{ storageBytes?: string }> }>(
    `https://compute.googleapis.com/compute/v1/projects/${projectId}/global/snapshots`,
    token,
  );
  return (data.items || []).reduce((sum, s) => sum + Number(s.storageBytes || 0), 0);
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
    // DATE(creation_time) sem timezone usa UTC por padrão — explícito em
    // America/Sao_Paulo pra bater com o dia de calendário que o usuário vê
    // (mesmo motivo do spMidnightUtc acima, pro lado do Monitoring).
    query: `
      SELECT DATE(creation_time, "America/Sao_Paulo") AS d, SUM(total_bytes_billed) AS bytes_billed
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
    const [pricing, instances, addresses, runServices, bqUsage, arBytes, secretVersions, snapshotBytes] = await Promise.all([
      getGcpPricing(region),
      listComputeInstances(token, projectId),
      listExternalAddresses(token, projectId),
      listCloudRunServices(token, projectId, region),
      getBigQueryUsage(region),
      getArtifactRegistryStorageBytes(token, projectId, region),
      getSecretVersionCount(token, projectId),
      getSnapshotStorageBytes(token, projectId),
    ]);

    const resources: GcpResourceCost[] = [];
    const notes: string[] = [
      'Estimativa por uso real medido (Cloud Monitoring / BigQuery INFORMATION_SCHEMA) × preço público de lista do GCP (Cloud Billing Catalog) — não é a fatura oficial do Cloud Billing (este projeto não tem billing export configurado).',
      'Todos os valores em USD. Se você comparar com o relatório do Console do GCP, confira a moeda mostrada lá (R$ e US$ têm números bem diferentes).',
      'Os dias do gráfico diário seguem o fuso de São Paulo (UTC-3), igual o Console — a Compute Engine usa o uptime real medido de cada dia, não um valor fixo repetido.',
      'O custo da Compute Engine (recurso e total) é o gasto REAL acumulado desde o dia 1 deste mês (mesmo período do relatório "Mês atual" do Console) — não uma projeção do status de agora. Cloud Run e BigQuery usam uma janela móvel de 30 dias corridos.',
    ];

    // --- Compute Engine (VM + disco) ---
    // "monthlyCostUsd" aqui = gasto REAL desde o dia 1 deste mês (fuso São
    // Paulo) até agora — não uma projeção "se o status de agora continuasse".
    // É o que faz bater com o relatório "Mês atual" do Console: uma VM que
    // liga/desliga várias vezes ao dia tem gasto acumulado bem diferente do
    // que "status atual × 730h" sugeriria (confirmado comparando com o
    // Console: 63.96h de uptime real desde 1/set bateu com os R$140,38 reais
    // de Compute Engine, contra frações de centavo que a projeção por status
    // atual dava com a VM parada).
    const monthStart = spMonthStartUtc();
    const now = new Date();
    const daysInMonth = spDaysInCurrentMonth();
    const daysElapsedInMonth = (now.getTime() - monthStart.getTime()) / 86400_000;

    let diskMonthToDateTotal = 0;
    let diskFullMonthlyTotal = 0;
    // Custo de compute por dia real (uptime real × preço) — soma de todas as
    // instâncias, alimenta o gráfico diário (ver getVmDailyUptimeCost acima).
    // Disco e snapshot (abaixo, fora do loop) entram à parte, como uma fatia
    // fixa por dia — ao contrário da CPU/RAM, eles cobram o mesmo todo santo
    // dia, ligada ou não.
    const computeDaily = new Map<string, number>();
    const vmRecommendations: CostRecommendation[] = [];
    for (const inst of instances) {
      const zoneName = inst.zone.split('/').pop() || '';
      const machineTypeName = inst.machineType.split('/').pop() || '';
      let cpuAvgPct = 0;
      let cpuMaxPct = 0;

      // Sempre busca o tipo de máquina, mesmo com a instância parada agora —
      // não houve troca de machine type (confirmado via operations list), e o
      // custo REAL precisa disso mesmo quando o status atual não é RUNNING
      // (ela pode ter rodado boa parte do mês e estar parada só agora).
      const mt = await getMachineTypeInfo(token, inst.machineType);
      const vcpus = mt.guestCpus;
      const hourlyRate = vcpus * pricing.computeE2CorePerHour + (mt.memoryMb / 1024) * pricing.computeE2RamPerGiBHour;

      if (inst.status === 'RUNNING') {
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

      // Uptime real desde o início do mês (São Paulo) — vira o custo de
      // CPU/RAM mostrado no card do recurso (gasto real, não projeção).
      let cpuRamMonthToDate = 0;
      try {
        const monthToDateSeconds = await monitoringSumWindow(
          token, projectId,
          `metric.type="compute.googleapis.com/instance/uptime" resource.type="gce_instance" resource.labels.instance_id="${inst.id}"`,
          monthStart, now,
        );
        cpuRamMonthToDate = (monthToDateSeconds / 3600) * hourlyRate;
      } catch {
        // Sem dado de uptime (instância muito nova) — fica só com disco/snapshot.
      }

      try {
        const daily = await getVmDailyUptimeCost(token, projectId, inst.id, vcpus, mt.memoryMb, pricing, DAYS_TREND);
        for (const [date, usd] of daily) computeDaily.set(date, (computeDaily.get(date) || 0) + usd);
      } catch {
        // Sem dado de uptime (instância muito nova) — o dia fica só com disco/snapshot no gráfico.
      }

      const diskGb = (inst.disks || []).reduce((sum, d) => sum + Number(d.diskSizeGb || 0), 0);
      // Disco cobra o mesmo valor todo santo dia (não depende do uptime) — a
      // fatia "até agora" é proporcional aos dias já passados deste mês;
      // diskFullMonthlyTotal (taxa cheia, sem prorata) alimenta o gráfico
      // diário abaixo, onde cada dia mostra a taxa diária real de disco, não
      // uma fração "até agora".
      const diskMonthToDate = diskGb * pricing.computePdBalancedPerGiBMonth * (daysElapsedInMonth / daysInMonth);
      const diskFullMonthly = diskGb * pricing.computePdBalancedPerGiBMonth;
      const monthToDateTotal = cpuRamMonthToDate + diskMonthToDate;
      diskMonthToDateTotal += diskMonthToDate;
      diskFullMonthlyTotal += diskFullMonthly;

      resources.push({
        id: `compute-${inst.name}`,
        category: 'compute',
        label: `Compute Engine — ${inst.name}`,
        detail: inst.status === 'RUNNING'
          ? `${machineTypeName} (${vcpus} vCPU) em ${zoneName}, disco ${diskGb}GB — CPU real: ${cpuAvgPct.toFixed(1)}% média / ${cpuMaxPct.toFixed(1)}% pico (${DAYS_TREND}d)`
          : `${machineTypeName} em ${zoneName} — status ${inst.status} agora (gasto real inclui o tempo rodando mais cedo neste mês), disco ${diskGb}GB`,
        monthlyCostUsd: monthToDateTotal,
        basis: `uptime real desde 1/${monthStart.getUTCMonth() + 1} (fuso São Paulo) × preço de lista E2 on-demand + disco`,
      });

      // Recomendação real: CPU média abaixo de 30% em instância com 4+ vCPUs -> vale
      // redimensionar. A economia aqui é uma PROJEÇÃO (se o padrão de uso dos
      // últimos dias continuar por um mês inteiro rodando), diferente do
      // "monthlyCostUsd" acima (que é o gasto real já ocorrido) — são
      // perguntas diferentes: uma é "quanto já gastei", a outra é "quanto eu
      // pouparia se mudasse o tipo de máquina daqui pra frente".
      if (inst.status === 'RUNNING' && vcpus >= 4 && cpuAvgPct > 0 && cpuAvgPct < 30) {
        const targetVcpus = Math.max(2, Math.ceil(vcpus / 4));
        const family = machineTypeName.split('-')[0] || 'e2';
        const targetType = `${family}-standard-${targetVcpus}`;
        const targetRamGb = targetVcpus * 4;
        const projectedFullMonthUsd = hourlyRate * HOURS_PER_MONTH + diskGb * pricing.computePdBalancedPerGiBMonth;
        const targetProjectedFullMonthUsd = targetVcpus * pricing.computeE2CorePerHour * HOURS_PER_MONTH
          + targetRamGb * pricing.computeE2RamPerGiBHour * HOURS_PER_MONTH
          + diskGb * pricing.computePdBalancedPerGiBMonth;
        vmRecommendations.push({
          id: `rec-rightsize-${inst.name}`,
          title: `Redimensionar ${inst.name} (${machineTypeName} → ${targetType})`,
          description: `CPU real dos últimos ${DAYS_TREND} dias: ${cpuAvgPct.toFixed(1)}% média, ${cpuMaxPct.toFixed(1)}% de pico em ${vcpus} vCPUs — ainda sobraria folga com ${targetVcpus} vCPUs.`,
          potentialSavingsUsd: Math.max(0, projectedFullMonthUsd - targetProjectedFullMonthUsd),
          effort: 'medio',
          suggestedCommand: `gcloud compute instances stop ${inst.name} --zone=${zoneName} && gcloud compute instances set-machine-type ${inst.name} --zone=${zoneName} --machine-type=${targetType} && gcloud compute instances start ${inst.name} --zone=${zoneName}`,
        });
      }
    }

    // --- Snapshots de disco (política de agendamento automático) ---
    // Mesmo raciocínio do disco acima: taxa cheia pro gráfico diário,
    // prorata (dias já passados / dias do mês) pro card "gasto até agora".
    // O volume de snapshot também cresce dia a dia (cada snapshot novo é
    // incremental) — usar o volume ATUAL prorateado subestima um pouco o
    // gasto real do começo do mês (quando havia menos GiB acumulado), mas é
    // a aproximação mais simples sem guardar histórico de tamanho por dia.
    const snapshotGiB = snapshotBytes / (1024 ** 3);
    const snapshotFullMonthlyUsd = snapshotGiB * pricing.computePdSnapshotPerGiBMonth;
    const snapshotMonthToDateUsd = snapshotFullMonthlyUsd * (daysElapsedInMonth / daysInMonth);
    if (snapshotBytes > 0) {
      resources.push({
        id: 'compute-snapshots',
        category: 'compute',
        label: 'Compute Engine — Snapshots',
        detail: `${snapshotGiB.toFixed(2)}GiB em snapshots automáticos de disco (política de agendamento) — volume atual, prorateado pelos dias do mês`,
        monthlyCostUsd: snapshotMonthToDateUsd,
        basis: 'storage real dos snapshots (bytes já deduplicados pela própria API) × preço de lista, proporcional aos dias já passados no mês',
      });
    }
    // Disco + snapshot cobram o mesmo valor todo dia (não dependem do uptime da VM)
    // — soma como fatia fixa diária no gráfico (taxa cheia, não prorateada —
    // cada dia individual mostra a taxa diária real), ao lado do custo real de CPU/RAM.
    const computeDailyFixedUsd = (diskFullMonthlyTotal + snapshotFullMonthlyUsd) / 30;

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

    // --- Daily trend (7d, dias de calendário em São Paulo) ---
    // computeUsd = uptime real da VM naquele dia × preço (computeDaily) +
    // fatia fixa de disco/snapshot (computeDailyFixedUsd) — não mais um valor
    // plano repetido em todos os dias baseado no status de AGORA.
    const dailyTrend: GcpCostReport['dailyTrend'] = [];
    for (let i = DAYS_TREND - 1; i >= 0; i--) {
      const key = spMidnightUtc(i).toISOString().slice(0, 10);
      dailyTrend.push({
        date: key,
        computeUsd: (computeDaily.get(key) || 0) + computeDailyFixedUsd,
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

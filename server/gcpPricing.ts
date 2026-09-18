import { getGcpAccessToken } from './gcpAuth';

// -----------------------------------------------------------------------------
// Preço público de lista (on-demand, sem desconto de compromisso) dos SKUs do
// GCP realmente usados pelo DataCore, buscado ao vivo no Cloud Billing Catalog
// API (cloudbilling.googleapis.com) — API pública, não exige billing export
// nem papel especial de billing, só um token autenticado (ver gcpAuth.ts).
//
// Os service IDs e as descrições de SKU abaixo foram levantados manualmente
// contra o projeto real (data-plataform-dev, southamerica-east1) — descrição
// de SKU é o identificador mais estável disponível (o SKU numérico rotaciona).
// -----------------------------------------------------------------------------

const SERVICE_IDS = {
  computeEngine: '6F81-5844-456A',
  cloudRun: '152E-C115-5142',
  artifactRegistry: '149C-F9EC-3994',
  secretManager: 'EE82-7A5E-871C',
  bigQuery: '24E6-581D-38E5',
} as const;

export interface GcpPricing {
  /** USD por vCPU-hora, VM E2 on-demand na região configurada. */
  computeE2CorePerHour: number;
  /** USD por GiB-hora de RAM, VM E2 on-demand. */
  computeE2RamPerGiBHour: number;
  /** USD por GiB-mês, disco persistente Balanced. */
  computePdBalancedPerGiBMonth: number;
  /** USD por hora, IP externo estático reservado (não cobra se atrelado a instância rodando). */
  computeStaticIpPerHour: number;
  /** USD por vCPU-segundo, Cloud Run "Instance-based billing" (CPU sempre alocada). */
  cloudRunInstanceCpuPerSecond: number;
  /** USD por GiB-segundo, Cloud Run "Instance-based billing". */
  cloudRunInstanceMemPerGiBSecond: number;
  /** USD por GiB-mês de storage no Artifact Registry (global). */
  artifactRegistryStoragePerGiBMonth: number;
  /** USD por versão de secret ativa/mês, acima do free tier (6 versões). */
  secretManagerVersionPerMonth: number;
  /** USD por TiB processado, BigQuery on-demand analysis. */
  bigQueryAnalysisPerTiB: number;
  /** USD por GiB-mês, BigQuery active logical storage, acima do free tier (10GB). */
  bigQueryActiveStoragePerGiBMonth: number;
  fetchedAt: string;
}

interface Sku {
  description: string;
  serviceRegions?: string[];
  pricingInfo: Array<{
    pricingExpression: {
      usageUnit?: string;
      tieredRates: Array<{ unitPrice: { units?: string; nanos?: number } }>;
    };
  }>;
}

function priceOf(sku: Sku): number {
  const rates = sku.pricingInfo[0]?.pricingExpression?.tieredRates || [];
  const rate = rates[rates.length - 1];
  if (!rate) return 0;
  const units = Number(rate.unitPrice.units || 0);
  const nanos = (rate.unitPrice.nanos || 0) / 1e9;
  return units + nanos;
}

async function fetchAllSkus(serviceId: string, token: string): Promise<Sku[]> {
  const skus: Sku[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`https://cloudbilling.googleapis.com/v1/services/${serviceId}/skus`);
    url.searchParams.set('currencyCode', 'USD');
    url.searchParams.set('pageSize', '5000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Error(`Falha ao buscar SKUs de ${serviceId}: HTTP ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { skus?: Sku[]; nextPageToken?: string };
    skus.push(...(data.skus || []));
    pageToken = data.nextPageToken || undefined;
  } while (pageToken);
  return skus;
}

/** Primeiro SKU cujas serviceRegions incluam `region` (ou sejam globais) e cuja
 *  descrição contenha TODOS os `needles` (case-sensitive — a API já é consistente). */
function findSku(skus: Sku[], region: string, needles: string[]): Sku | undefined {
  return skus.find((s) => {
    const regions = s.serviceRegions || [];
    const regionOk = regions.length === 0 || regions.includes(region) || regions.includes('global');
    return regionOk && needles.every((n) => s.description.includes(n));
  });
}

interface CachedPricing {
  value: GcpPricing;
  expiresAt: number;
}
let cache: CachedPricing | null = null;
const TTL_MS = 6 * 60 * 60 * 1000; // preço de lista muda raramente — 6h é generoso o bastante sem bater na API toda hora.

/** Nome da região como aparece nas descrições de SKU em português coloquial do billing
 *  (ex.: "southamerica-east1" -> "Sao Paulo"). Só temos essa região mapeada hoje. */
const REGION_CITY: Record<string, string> = {
  'southamerica-east1': 'Sao Paulo',
};

export async function getGcpPricing(region: string): Promise<GcpPricing> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;

  const token = await getGcpAccessToken();
  const city = REGION_CITY[region];
  if (!city) {
    throw new Error(`Região "${region}" sem cidade mapeada para casar com as descrições de SKU (ver REGION_CITY em gcpPricing.ts).`);
  }

  const [computeSkus, cloudRunSkus, arSkus, smSkus, bqSkus] = await Promise.all([
    fetchAllSkus(SERVICE_IDS.computeEngine, token),
    fetchAllSkus(SERVICE_IDS.cloudRun, token),
    fetchAllSkus(SERVICE_IDS.artifactRegistry, token),
    fetchAllSkus(SERVICE_IDS.secretManager, token),
    fetchAllSkus(SERVICE_IDS.bigQuery, token),
  ]);

  const need = (sku: Sku | undefined, label: string): Sku => {
    if (!sku) throw new Error(`SKU não encontrado no Billing Catalog: ${label}`);
    return sku;
  };

  const value: GcpPricing = {
    computeE2CorePerHour: priceOf(need(
      findSku(computeSkus, region, ['E2 Instance Core running in', city]), 'E2 Instance Core',
    )),
    computeE2RamPerGiBHour: priceOf(need(
      findSku(computeSkus, region, ['E2 Instance Ram running in', city]), 'E2 Instance Ram',
    )),
    computePdBalancedPerGiBMonth: priceOf(need(
      findSku(computeSkus, region, ['Balanced PD Capacity in', city]), 'Balanced PD Capacity',
    )),
    computeStaticIpPerHour: priceOf(need(
      findSku(computeSkus, region, ['Static Ip Charge in', city]), 'Static Ip Charge',
    )),
    cloudRunInstanceCpuPerSecond: priceOf(need(
      findSku(cloudRunSkus, region, ['Services CPU (Instance-based billing) in', region]), 'Cloud Run Instance CPU',
    )),
    cloudRunInstanceMemPerGiBSecond: priceOf(need(
      findSku(cloudRunSkus, region, ['Services Memory (Instance-based billing) in', region]), 'Cloud Run Instance Memory',
    )),
    artifactRegistryStoragePerGiBMonth: priceOf(need(
      findSku(arSkus, region, ['Artifact Registry Storage']), 'Artifact Registry Storage',
    )),
    secretManagerVersionPerMonth: priceOf(need(
      findSku(smSkus, region, ['Secret version replica storage']), 'Secret version replica storage',
    )),
    bigQueryAnalysisPerTiB: priceOf(need(
      findSku(bqSkus, region, ['Analysis (', region]), 'BigQuery Analysis',
    )),
    bigQueryActiveStoragePerGiBMonth: priceOf(need(
      findSku(bqSkus, region, ['Active Logical Storage (', region]), 'BigQuery Active Logical Storage',
    )),
    fetchedAt: new Date().toISOString(),
  };

  cache = { value, expiresAt: Date.now() + TTL_MS };
  return value;
}

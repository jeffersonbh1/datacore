import { GoogleAuth } from 'google-auth-library';

// -----------------------------------------------------------------------------
// Application Default Credentials para as APIs "de infraestrutura" do GCP
// (Compute Engine, Cloud Run, Cloud Monitoring, Artifact Registry, Secret
// Manager, Cloud Billing Catalog) — usadas pela tela Custos & FinOps
// (server/routes/costs.ts) pra descobrir recursos reais e seu custo.
//
// Deliberadamente NÃO reaproveita a service account dedicada do BigQuery
// (server/bigqueryClient.ts, BIGQUERY_CREDENTIALS_JSON) — aquela é escopada
// só pra BigQuery. Em vez disso, usa a identity de runtime do próprio Cloud
// Run (489189813509-compute@developer.gserviceaccount.com, roles/editor),
// resolvida automaticamente via ADC — sem segredo novo, sem mudança de IAM.
// Em dev local, ADC cai pro `gcloud auth application-default login` da
// máquina, se existir.
// -----------------------------------------------------------------------------

let auth: GoogleAuth | null = null;

function getAuth(): GoogleAuth {
  if (!auth) {
    auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  }
  return auth;
}

export class GcpAuthUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GcpAuthUnavailableError';
  }
}

/** Token de acesso válido para chamar APIs REST do GCP autenticadas via ADC. */
export async function getGcpAccessToken(): Promise<string> {
  try {
    const client = await getAuth().getClient();
    const res = await client.getAccessToken();
    if (!res.token) {
      throw new Error('getAccessToken() não retornou um token.');
    }
    return res.token;
  } catch (err) {
    throw new GcpAuthUnavailableError(
      `Sem Application Default Credentials disponíveis para consultar recursos GCP: ${err instanceof Error ? err.message : err}. ` +
      'Em produção (Cloud Run) isso é automático; em dev local rode "gcloud auth application-default login".'
    );
  }
}

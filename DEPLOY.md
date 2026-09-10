# DataCore — colocar no ar

## Topologia

```
Navegador
  │  (HTTPS)
  ▼
Frontend  ── Cloud Run (serve estático do dist/)         imagem: Dockerfile.frontend
  │  VITE_AIRBYTE_GATEWAY_URL  (URL do gateway, embutida no bundle em build time)
  ▼
Gateway   ── Cloud Run (Express, server/)                imagem: Dockerfile  (+ dbt)
  ├── Supabase  (Auth admin + Postgres/RLS)   HTTPS
  ├── Airbyte   VM 34.39.184.77:8000          HTTP  ← precisa de firewall/IP fixo
  └── BigQuery  (camadas Bronze/Silver/Gold)  HTTPS, via service account
```

Supabase é gerenciado (`umpltpxoqtlbnpmjwclt.supabase.co`). Só Frontend e
Gateway são deployados aqui.

---

## 0. O que precisa ser ajustado (resumo)

| # | Item | Estado hoje | Ação |
|---|------|-------------|------|
| 1 | IP do Airbyte | `.env.local` apontava para `35.198.50.155` (morto) | ✅ atualizado p/ `34.39.184.77`; ver passo 2 p/ prod |
| 2 | IP **efêmero** da VM | muda a cada stop/start | **Reservar IP estático** OU usar VPC connector + IP interno |
| 3 | Firewall da VM :8000 | provavelmente fechado p/ o Cloud Run | abrir (passo 2) |
| 4 | Deploy do gateway | não existia cloudbuild | ✅ `cloudbuild.gateway.yaml` criado |
| 5 | Segredos | em `.env.local` (texto) | mover p/ Secret Manager (passo 3) |
| 6 | `VITE_AIRBYTE_GATEWAY_URL` | `http://localhost:8080` | setar a URL do gateway no build do frontend (passo 6) |
| 7 | Migrações SQL | `sql/001..007` | aplicar no Supabase (passo 4) |
| 8 | Cloud Scheduler (auto-sync Bronze) | não configurado | criar job (passo 5) |
| 9 | dbt no gateway | imagem/CPU/timeout maiores | `--memory=1Gi --timeout=900 --max-instances=1` (já no cloudbuild) |
| 11 | Modelos dbt gerados | escritos em `dbt/models/medallion/bronze/<sistema>/bronze_<sistema>_<t>.sql` | `DBT_CODEGEN_GIT=push` + rebuild da imagem, ou redeploy manual (ver passo 5) |
| 10 | Chave da SA BigQuery | exposta em conversas/arquivo local | **rotacionar** e guardar só no Secret Manager |

---

## 1. Pré-requisitos GCP

```bash
export PROJ=data-plataform-dev
export REGION=southamerica-east1
gcloud config set project $PROJ

gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com \
  bigquery.googleapis.com cloudscheduler.googleapis.com

gcloud artifacts repositories create datacore \
  --repository-format=docker --location=$REGION
```

Service accounts de runtime (não use a default do Compute):

```bash
# Gateway
gcloud iam service-accounts create datacore-gateway-run
GATEWAY_SA=datacore-gateway-run@$PROJ.iam.gserviceaccount.com
# BigQuery: criar datasets + rodar jobs (Bronze/Silver/Gold via dbt)
gcloud projects add-iam-policy-binding $PROJ \
  --member="serviceAccount:$GATEWAY_SA" --role="roles/bigquery.dataEditor"
gcloud projects add-iam-policy-binding $PROJ \
  --member="serviceAccount:$GATEWAY_SA" --role="roles/bigquery.jobUser"
```

> O gateway usa `BIGQUERY_CREDENTIALS_JSON` (uma SA em JSON) tanto para o cliente
> `@google-cloud/bigquery` quanto para o dbt. Pode ser a **própria** `datacore-bigquery-gateway@...`
> que já existe. A SA de runtime do Cloud Run (`$GATEWAY_SA`) precisa apenas de
> acesso ao Secret Manager (passo 3). Se preferir Workload Identity puro, veja
> "Alternativa sem keyfile" no fim.

---

## 2. Airbyte VM — rede

O gateway (Cloud Run) precisa alcançar `:8000` da VM. Escolha **A** (rápido) ou **B** (produção).

### A. IP externo + firewall aberto (rápido)

```bash
# 1. Promover o IP efêmero atual a estático (para não mudar em restart)
gcloud compute addresses create airbyte-ip --region=$REGION \
  --addresses=34.39.184.77                       # falha se já não estiver livre; então:
# gcloud compute addresses create airbyte-ip --region=$REGION
# e reassociar o novo IP à instância (gcloud compute instances delete-access-config / add-access-config)

# 2. Abrir a porta. Cloud Run sem VPC connector NÃO tem faixa de IP fixa,
#    então a origem fica 0.0.0.0/0 — aceitável só porque o Airbyte exige
#    client_id/secret. Restrinja o alvo por tag.
gcloud compute firewall-rules create allow-airbyte-api \
  --direction=INGRESS --action=ALLOW --rules=tcp:8000 \
  --source-ranges=0.0.0.0/0 --target-tags=airbyte
gcloud compute instances add-tags <NOME_DA_VM> --zone=<ZONA> --tags=airbyte
```

`_AIRBYTE_BASE_URL=http://34.39.184.77:8000`

### B. VPC connector + IP interno (recomendado)

```bash
gcloud compute networks vpc-access connectors create datacore-vpc \
  --region=$REGION --network=<REDE_DA_VM> --range=10.8.0.0/28

gcloud compute firewall-rules create allow-airbyte-from-connector \
  --direction=INGRESS --action=ALLOW --rules=tcp:8000 \
  --source-ranges=10.8.0.0/28 --target-tags=airbyte
```

No deploy do gateway acrescente
`--vpc-connector=datacore-vpc --vpc-egress=private-ranges-only`
e use `_AIRBYTE_BASE_URL=http://<IP_INTERNO_DA_VM>:8000`.
(egress `private-ranges-only` mantém Supabase/BigQuery saindo pela internet normal.)

---

## 3. Secret Manager

```bash
printf '%s' 'eyJhbG...'      | gcloud secrets create SUPABASE_SERVICE_ROLE_KEY --data-file=-
printf '%s' '<client secret>' | gcloud secrets create AIRBYTE_CLIENT_SECRET     --data-file=-
printf '%s' '<gateway key>'   | gcloud secrets create GATEWAY_API_KEY           --data-file=-
gcloud secrets create BIGQUERY_CREDENTIALS_JSON --data-file=./bigquery-sa.json   # JSON íntegro

for S in SUPABASE_SERVICE_ROLE_KEY AIRBYTE_CLIENT_SECRET GATEWAY_API_KEY BIGQUERY_CREDENTIALS_JSON; do
  gcloud secrets add-iam-policy-binding $S \
    --member="serviceAccount:$GATEWAY_SA" --role="roles/secretmanager.secretAccessor"
done
```

> `GATEWAY_API_KEY` é o mesmo valor que o frontend manda em
> `VITE_AIRBYTE_GATEWAY_API_KEY` (embutido no bundle — ou seja, visível ao cliente;
> serve como chave de aplicação, não como segredo forte).

---

## 4. Supabase — migrações

Aplicar, em ordem, no SQL Editor do projeto (ou `psql` na connection string):

```
sql/001_multi_tenant_empresas.sql
sql/002_pipelines.sql
sql/003_pipeline_runs.sql
sql/004_auth_user_id.sql
sql/005_rls_policies.sql
sql/006_fix_rls_recursion.sql
sql/007_bronze_auto_sync.sql
```

`007` adiciona as colunas `bronze_status` / `bronze_built_em` / `bronze_error`
em `pipeline_runs` — sem elas o auto-sync (passo 5) quebra.

---

## 5. Gateway — deploy

```bash
export IMAGE=$REGION-docker.pkg.dev/$PROJ/datacore/gateway:$(git rev-parse --short HEAD)

gcloud builds submit --config cloudbuild.gateway.yaml --substitutions=\
_IMAGE=$IMAGE,_REGION=$REGION,_SERVICE=datacore-gateway,_RUNTIME_SA=$GATEWAY_SA,\
_SUPABASE_URL=https://umpltpxoqtlbnpmjwclt.supabase.co,\
_AIRBYTE_BASE_URL=http://34.39.184.77:8000,\
_AIRBYTE_CLIENT_ID=<client id>,_AIRBYTE_WORKSPACE_ID=<workspace id>,\
_DBT_GCP_PROJECT=$PROJ,_DBT_DISABLED=false,_DBT_CODEGEN_GIT=off
```

- Primeiro deploy pode levar ~5–8 min (a imagem instala `python3` + `dbt-bigquery`).
- `_DBT_DISABLED=true` = parada de emergência: **toda** construção de Bronze
  passa a falhar (503) — não há mais fallback fora do dbt.
- Pegue a URL: `gcloud run services describe datacore-gateway --region=$REGION --format='value(status.url)'`

**Como os modelos gerados chegam ao gateway** — a imagem "assa" `dbt/` no build.
Uma integração nova só constrói a Bronze via dbt **depois** que
`bronze_<sistema>_<tabela>.sql` está na imagem. Opções:
- `_DBT_CODEGEN_GIT=push` + um remote git com credencial no container + trigger
  de deploy no push do repo (rebuild da imagem); **ou**
- redeploy manual após criar integrações; **ou**
- (futuro) `git pull` do `dbt/` no start do container.

### Acesso frontend → gateway

O frontend chama o gateway direto do navegador com `Authorization: Bearer <GATEWAY_API_KEY>`.
Como `--no-allow-unauthenticated` bloqueia por IAM (não por header), o mais
simples é **`--allow-unauthenticated`** no gateway e confiar na `GATEWAY_API_KEY`
+ CORS. Se quiser IAM de verdade, ponha um proxy autenticado na frente.
Ajuste no `cloudbuild.gateway.yaml` conforme a escolha.

---

## 6. Cloud Scheduler — auto-sync da Bronze

`bronzeAutoSync` NÃO roda sozinho (Cloud Run escala a zero). Agende:

```bash
gcloud scheduler jobs create http datacore-bronze-autosync \
  --location=$REGION --schedule="*/10 * * * *" \
  --uri="<URL_DO_GATEWAY>/api/bigquery/bronze/auto-sync" \
  --http-method=POST \
  --headers="Authorization=Bearer <GATEWAY_API_KEY>,Content-Type=application/json" \
  --message-body='{}'
```

(Se o gateway ficar `--no-allow-unauthenticated`, adicione
`--oidc-service-account-email` com uma SA que tenha `roles/run.invoker`.)

---

## 7. Frontend — deploy

```bash
export FE_IMAGE=$REGION-docker.pkg.dev/$PROJ/datacore/frontend:$(git rev-parse --short HEAD)

gcloud builds submit --config cloudbuild.frontend.yaml --substitutions=\
_IMAGE=$FE_IMAGE,_REGION=$REGION,_SERVICE=datacore-frontend,\
_VITE_SUPABASE_URL=https://umpltpxoqtlbnpmjwclt.supabase.co,\
_VITE_SUPABASE_ANON_KEY=<anon key>,\
_VITE_AIRBYTE_GATEWAY_URL=<URL_DO_GATEWAY>,\
_VITE_AIRBYTE_GATEWAY_API_KEY=<GATEWAY_API_KEY>
```

> `cloudbuild.frontend.yaml` já builda, faz push e roda `gcloud run deploy`
> (`--allow-unauthenticated`). As `VITE_*` entram no bundle em build time; trocar
> qualquer uma exige rebuild do frontend.

Depois: adicione a URL do frontend ao Supabase Auth → *URL Configuration*
(Site URL + Redirect URLs) para o fluxo de login funcionar.

---

## 8. Fumaça pós-deploy

```bash
G=<URL_DO_GATEWAY>
curl -s $G/health                                   # {"status":"ok"}
curl -s -X POST $G/api/bigquery/bronze/auto-sync \
  -H "Authorization: Bearer <GATEWAY_API_KEY>" -H 'Content-Type: application/json' -d '{}'
# -> processed:N ; se der ECONNREFUSED/ETIMEDOUT no Airbyte => firewall/IP (passo 2)

# Codegen dos modelos de uma integração
curl -s -X POST $G/api/dbt/models \
  -H "Authorization: Bearer <GATEWAY_API_KEY>" -H 'Content-Type: application/json' \
  -d '{"slug":"conn_smoke","projectId":"data-plataform-dev","rawDataset":"raw_smoke","bronzeDataset":"bronze_smoke","applyLgpd":true,"tables":[{"name":"clientes","columns":["id_cliente","cpf"],"primaryKey":["id_cliente"],"loadType":"incremental"}]}'
# -> {"files":[...],"models":["bronze_conn_smoke__clientes"],"git":"skipped"}

# Bronze via dbt (mesmo slug; a raw_clientes precisa existir no BigQuery)
curl -s -X POST $G/api/bigquery/bronze/build \
  -H "Authorization: Bearer <GATEWAY_API_KEY>" -H 'Content-Type: application/json' \
  -d '{"slug":"conn_smoke","projectId":"data-plataform-dev","rawDataset":"raw_smoke","bronzeDataset":"bronze_smoke","tables":["clientes"],"location":"southamerica-east1"}'
# -> results[0].model == "bronze_conn_smoke__clientes" e bloco "dbt": {ok:true}
```

Abra a URL do frontend, faça login, crie uma integração ponta a ponta.

---

## Notas dbt no Cloud Run

- Imagem ~+300 MB (python + dbt-bigquery). `dbt deps` roda no build; `dbt_packages`
  vai baked na imagem.
- `dbt build` escreve `target/` em `/app/dbt` — FS em memória do Cloud Run, por
  isso `--memory=1Gi`.
- `--max-instances=1`: o lock de concorrência do `dbtRunner` é por processo;
  várias instâncias poderiam rodar `dbt`/DDL concorrentes no BigQuery.
- `--timeout=900` casa com `DBT_RUN_TIMEOUT_MS` (15 min).
- Alternativa mais limpa depois: mover o dbt para um **Cloud Run Job** dedicado e
  o gateway só dispara.

### Alternativa sem keyfile (Workload Identity)

Se `BIGQUERY_CREDENTIALS_JSON` não estiver setada e `DBT_TARGET=dev`, tanto o
`@google-cloud/bigquery` quanto o dbt (profile `dev`, `method: oauth`) usam a
credencial padrão do ambiente — ou seja, a SA de runtime do Cloud Run
(`$GATEWAY_SA`) com `bigquery.dataEditor` + `bigquery.jobUser`. Nesse caso deixe
`DBT_TARGET=dev` no `--set-env-vars` e não crie o secret da SA.

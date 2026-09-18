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
  ├── Airbyte   VM 34.39.199.115:8000          HTTP  ← IP estático (datacore-airbyte-vm-ip)
  └── BigQuery  (camadas Bronze/Silver/Gold)  HTTPS, via service account
```

Supabase é gerenciado (`umpltpxoqtlbnpmjwclt.supabase.co`). Só Frontend e
Gateway são deployados aqui.

---

## 0. O que precisa ser ajustado (resumo)

| # | Item | Estado hoje | Ação |
|---|------|-------------|------|
| 1 | IP do Airbyte | mudava a cada restart (`34.95.218.184` → `35.198.9.239` → ...) | ✅ `.env.local`/prod atualizados p/ `34.39.199.115` (IP estático, ver #2) |
| 2 | IP **efêmero** da VM | mudava a cada stop/start | ✅ reservado IP estático `datacore-airbyte-vm-ip` = `34.39.199.115` (2026-09-15) |
| 3 | Firewall da VM :8000 | provavelmente fechado p/ o Cloud Run | abrir (passo 2) |
| 4 | Deploy do gateway | não existia cloudbuild | ✅ `cloudbuild.gateway.yaml` criado |
| 5 | Segredos | ✅ todos em Secret Manager (passo 3) — ver nomes reais usados em produção | — |
| 6 | `VITE_AIRBYTE_GATEWAY_URL` | `http://localhost:8080` | setar a URL do gateway no build do frontend (passo 6) |
| 7 | Migrações SQL | `sql/001..007` | aplicar no Supabase (passo 4) |
| 8 | Cloud Scheduler (auto-sync Bronze + Silver) | não configurado | criar os dois jobs (passo 6) |
| 9 | dbt no gateway | imagem/CPU/timeout maiores | `--memory=1Gi --timeout=900 --max-instances=1` (já no cloudbuild) |
| 11 | Modelos dbt gerados | escritos em `dbt/models/medallion/bronze/<sistema>/bronze_<sistema>_<t>.sql` | `DBT_CODEGEN_GIT=push` + rebuild da imagem, ou redeploy manual (ver passo 5) |
| 10 | Chave da SA BigQuery | ✅ rotacionada em 2026-09-15 (a chave anterior tinha virado uma variável de ambiente em texto puro com JWT inválido — ver passo 3) | as duas chaves antigas foram revogadas |

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

### A. IP externo + firewall aberto (rápido) — ✅ feito em 2026-09-15

```bash
# 1. IP efêmero da VM (vm-data-plataform-dev, southamerica-east1-c) mudava a
#    cada stop/start — o IP anterior (35.198.9.239) já não estava mais
#    disponível pra reservar quando isso foi corrigido, então foi preciso um
#    IP novo (não dá pra "recuperar" um IP efêmero já liberado):
gcloud compute addresses create datacore-airbyte-vm-ip --region=$REGION
# → reservou 34.39.199.115. Depois, reassociar à instância:
gcloud compute instances delete-access-config vm-data-plataform-dev \
  --zone=southamerica-east1-c --access-config-name="External NAT"
gcloud compute instances add-access-config vm-data-plataform-dev \
  --zone=southamerica-east1-c --access-config-name="External NAT" \
  --address=34.39.199.115 --network-tier=PREMIUM

# 2. Abrir a porta. Cloud Run sem VPC connector NÃO tem faixa de IP fixa,
#    então a origem fica 0.0.0.0/0 — aceitável só porque o Airbyte exige
#    client_id/secret. Restrinja o alvo por tag.
gcloud compute firewall-rules create allow-airbyte-api \
  --direction=INGRESS --action=ALLOW --rules=tcp:8000 \
  --source-ranges=0.0.0.0/0 --target-tags=airbyte
gcloud compute instances add-tags vm-data-plataform-dev --zone=southamerica-east1-c --tags=airbyte
```

`_AIRBYTE_BASE_URL=http://34.39.199.115:8000` — atualizar em `.env.local` (local) e no
serviço `airbyte-gateway` (prod, via `gcloud run services update --update-env-vars`,
ver "Redeploy sem rebuildar a imagem" no passo 5) sempre que a VM ganhar um IP novo
(não deveria mais acontecer agora que o IP é estático).

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

> **Nomes reais em produção (2026-09-15): `kebab-case`, não `SCREAMING_SNAKE_CASE`.**
> O `cloudbuild.gateway.yaml` deste repo ainda referencia os nomes em
> `SCREAMING_SNAKE_CASE` abaixo (ex. `BIGQUERY_CREDENTIALS_JSON:latest`) — ele
> nunca chegou a rodar contra o projeto real; o deploy que está no ar hoje foi
> feito via `gcloud run deploy --source .` (passo 5). Se for usar o pipeline do
> cloudbuild, ajuste os nomes dos segredos nele para bater com os criados aqui,
> ou recrie os segredos com os nomes que o cloudbuild espera.

```bash
printf '%s' 'eyJhbG...'      | gcloud secrets create supabase-service-role-key --data-file=-
printf '%s' '<client secret>' | gcloud secrets create airbyte-client-secret    --data-file=-
printf '%s' '<client id>'     | gcloud secrets create airbyte-client-id        --data-file=-
printf '%s' '<gateway key>'   | gcloud secrets create gateway-api-key          --data-file=-
gcloud secrets create bigquery-credentials-json --data-file=./bigquery-sa.json  # JSON íntegro

for S in supabase-service-role-key airbyte-client-secret airbyte-client-id gateway-api-key bigquery-credentials-json; do
  gcloud secrets add-iam-policy-binding $S \
    --member="serviceAccount:$GATEWAY_SA" --role="roles/secretmanager.secretAccessor"
done
```

> **`$GATEWAY_SA` na prática hoje** é a service account **padrão do Compute**
> (`<PROJECT_NUMBER>-compute@developer.gserviceaccount.com`) — a SA dedicada
> `datacore-gateway-run` sugerida no passo 1 nunca foi criada. Funciona, mas é
> o oposto do que o passo 1 recomenda (evitar a SA default); considerar migrar
> para uma SA dedicada num momento de manutenção.

> `GATEWAY_API_KEY` é o mesmo valor que o frontend manda em
> `VITE_AIRBYTE_GATEWAY_API_KEY` (embutido no bundle — ou seja, visível ao cliente;
> serve como chave de aplicação, não como segredo forte).

### Ligar um segredo já existente ao Cloud Run (troca de credencial)

Quando é só trocar o *valor* de um segredo que o serviço já usa, basta subir
uma versão nova — o Cloud Run resolve `:latest` a cada revisão nova, então uma
troca de valor só chega ao serviço vivo com uma nova revisão (ver passo 5,
"Redeploy sem rebuildar a imagem"):

```bash
gcloud secrets versions add bigquery-credentials-json --data-file=./nova-chave.json
gcloud run services update airbyte-gateway --region=$REGION \
  --update-secrets="BIGQUERY_CREDENTIALS_JSON=bigquery-credentials-json:latest"
```

Se a variável **ainda não** for um segredo (caso real encontrado em produção:
`BIGQUERY_CREDENTIALS_JSON` estava configurada como variável de ambiente em
texto puro, com a chave corrompida — JWT inválido, toda construção da Bronze
falhava com `invalid_grant: Invalid JWT Signature`), o Cloud Run recusa
converter o tipo direto:

```
ERROR: Cannot update environment variable [BIGQUERY_CREDENTIALS_JSON] to the
given type because it has already been set with a different type.
```

Nesse caso, remova a variável e adicione o segredo **no mesmo comando**:

```bash
gcloud run services update airbyte-gateway --region=$REGION \
  --remove-env-vars="BIGQUERY_CREDENTIALS_JSON" \
  --update-secrets="BIGQUERY_CREDENTIALS_JSON=bigquery-credentials-json:latest"
```

### Deploy key do `DBT_CODEGEN_GIT=push` (dbt-codegen-deploy-key)

Habilitado em 2026-09-17 depois de um incidente real: uma integração criada em
produção teve seus modelos dbt gerados só no disco efêmero do gateway
(`DBT_CODEGEN_GIT=off` até então) e os perdeu no redeploy seguinte — ver
`project_gateway_deploy` (memória) e o commit da correção
(`arena_fahel_beach`). Com `push`, toda integração criada em produção já sai
commitada no `main`, sem depender de alguém lembrar de regenerar manualmente.

**Setup (já feito em produção, refazer só se a chave precisar ser rotacionada):**

```bash
ssh-keygen -t ed25519 -N "" -C "airbyte-gateway-dbt-codegen" -f ./dbt_codegen_deploy_key

gh repo deploy-key add ./dbt_codegen_deploy_key.pub \
  --repo jeffersonbh1/datacore --allow-write \
  --title "airbyte-gateway dbt-codegen (auto-push)"

gcloud secrets create dbt-codegen-deploy-key \
  --replication-policy=automatic --data-file=./dbt_codegen_deploy_key
gcloud secrets add-iam-policy-binding dbt-codegen-deploy-key \
  --member="serviceAccount:$GATEWAY_SA" --role="roles/secretmanager.secretAccessor"

rm ./dbt_codegen_deploy_key ./dbt_codegen_deploy_key.pub   # não deixar a chave privada em disco
```

Por que é uma **deploy key** (SSH, escopada a este repo) e não um PAT pessoal:
revogável sem afetar a conta do dono, e não carrega nenhum outro escopo além
de push neste repo específico.

Como funciona em runtime (ver `server/gitDeployKey.ts`, `Dockerfile`,
`server/dbtCodegen.ts::gitCommit`):
1. A secret é montada como **arquivo** (não env var) em `/secrets/dbt-codegen-deploy-key` — vem com permissão aberta, e o `ssh` recusa carregar chave privada nessas condições.
2. No boot, `prepareGitDeployKey()` copia pra `/tmp/dbt_codegen_deploy_key` com `chmod 600`.
3. `GIT_SSH_COMMAND` (env, setado no `Dockerfile`) aponta pra essa cópia.
4. Ao dar push, `gitCommit()` reescreve o remote `origin` pra `GIT_PUSH_REMOTE_URL` (SSH) antes de rodar `git push origin HEAD:<branch>`.
5. `.git` precisa estar **dentro da imagem** — `.dockerignore`/`.gcloudignore` não excluem mais `.git` (o `.gcloudignore` existe só pra impedir o default do `gcloud run deploy --source` de excluir `.git` sozinho).

Se `DBT_CODEGEN_GIT=push` e o push falhar, `writeIntegrationModels` **não lança
erro** — a integração/modelos continuam criados normalmente, só o campo `git`
da resposta vem `"failed"` com `gitDetail` explicando por quê (chave errada,
sem rede pro GitHub, branch protegida, etc.). Vale monitorar isso, não é
bloqueante para o fluxo principal.

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

O jeito documentado abaixo (`cloudbuild.gateway.yaml`, passando todo o
ambiente e os segredos de novo a cada deploy) nunca chegou a rodar contra o
projeto real. **O serviço em produção (`airbyte-gateway`) é atualizado assim:**

```bash
gcloud run deploy airbyte-gateway --source . --region=$REGION --project=$PROJ
```

Sem `--set-env-vars` / `--set-secrets` / `--service-account`, o Cloud Run
**reaproveita a configuração da revisão anterior** (variáveis, segredos, SA,
memória etc.) — só troca a imagem. É o caminho certo para uma mudança de
código (como esta): mais simples e sem risco de sobrescrever por engano um
segredo ou variável já ajustado manualmente. Reserve o comando com
`--set-secrets`/`--set-env-vars` completo (abaixo) para quando algum desses
valores realmente precisar mudar.

```bash
export IMAGE=$REGION-docker.pkg.dev/$PROJ/datacore/gateway:$(git rev-parse --short HEAD)

# _SERVICE e _RUNTIME_SA já têm como default os valores reais de produção
# (airbyte-gateway / SA padrão do Compute) — só precisa sobrescrever se for
# migrar para uma SA dedicada (ver passo 1) ou outro nome de serviço.
gcloud builds submit --config cloudbuild.gateway.yaml --substitutions=\
_IMAGE=$IMAGE,_REGION=$REGION,\
_SUPABASE_URL=https://umpltpxoqtlbnpmjwclt.supabase.co,\
_AIRBYTE_BASE_URL=http://35.198.9.239:8000,\
_AIRBYTE_CLIENT_ID=<client id>,_AIRBYTE_WORKSPACE_ID=<workspace id>,\
_DBT_GCP_PROJECT=$PROJ,_DBT_DISABLED=false,_DBT_CODEGEN_GIT=off
```

- Primeiro deploy pode levar ~5–8 min (a imagem instala `python3` + `dbt-bigquery`).
- `_DBT_DISABLED=true` = parada de emergência: **toda** construção de Bronze
  passa a falhar (503) — não há mais fallback fora do dbt.
- Pegue a URL: `gcloud run services describe airbyte-gateway --region=$REGION --format='value(status.url)'`

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

## 6. Cloud Scheduler — auto-sync da Bronze e da Silver

`bronzeAutoSync`/`silverAutoSync` NÃO rodam sozinhos (Cloud Run escala a
zero). Agende os dois — a Silver só avança depois que a Bronze do mesmo job
já estiver `built`, então rode a dela alguns minutos depois (ou apenas com
schedule igual, já que ela é idempotente e simplesmente pula o que ainda não
tem Bronze pronta):

```bash
gcloud scheduler jobs create http datacore-bronze-autosync \
  --location=$REGION --schedule="*/10 * * * *" \
  --uri="<URL_DO_GATEWAY>/api/bigquery/bronze/auto-sync" \
  --http-method=POST \
  --headers="Authorization=Bearer <GATEWAY_API_KEY>,Content-Type=application/json" \
  --message-body='{}'

gcloud scheduler jobs create http datacore-silver-autosync \
  --location=$REGION --schedule="5-55/10 * * * *" \
  --uri="<URL_DO_GATEWAY>/api/bigquery/silver/auto-sync" \
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

curl -s -X POST $G/api/bigquery/silver/auto-sync \
  -H "Authorization: Bearer <GATEWAY_API_KEY>" -H 'Content-Type: application/json' -d '{}'
# -> processed:N ; "skipped" com "Bronze ainda não construída" é normal antes do 1º ciclo da Bronze

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

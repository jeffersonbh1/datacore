# DataCore — Projeto dbt (camada Bronze)

Projeto dbt real (dbt-core + `dbt-bigquery`). A camada **Bronze é 100% dbt**.
Ao criar uma integração no Studio, o gateway **gera um modelo dbt por tabela**
em `models/medallion/bronze/bronze_<tabela>.sql` (sobrescrevendo se já existir)
e depois roda `dbt build --select bronze_<t1> bronze_<t2> ...`. Não existe mais
construção de Bronze fora do dbt (o antigo `CREATE OR REPLACE TABLE … AS
SELECT *` foi removido).

```
dbt/
├── dbt_project.yml
├── packages.yml / package-lock.yml   # dbt_utils
├── profiles.yml                      # dev/prod, 100% via env var (usado pelo gateway)
├── requirements.txt                  # dbt-bigquery ~1.12
├── _generated_sources.json           # manifesto: tabelas conhecidas (usado p/ montar a source)
├── macros/
│   ├── generate_schema_name.sql      # dataset = valor da env var (sem prefixo)
│   ├── lgpd.sql                       # mascarar_cpf / tokenizar_email / hash_sha256
│   └── cast_seguro.sql
└── models/
    ├── sources/
    │   └── _datacore_raw__sources.yml  # GERADO — source "datacore_raw", tabelas acumuladas
    ├── medallion/
    │   ├── bronze/
    │   │   ├── bronze_<tabela>.sql     # GERADO — 1 por tabela, sobrescrito na regeração
    │   │   ├── bronze_<tabela>.yml     # GERADO — testes (unique/not_null na PK)
    │   │   ├── bronze_transacoes.sql   # EXEMPLO (enabled via DBT_DEMO_ENABLED)
    │   │   └── _bronze__models.yml     # EXEMPLO
    │   ├── silver/  gold/              # EXEMPLO (transacoes) — sem codegen ainda
    └── staging/                        # EXEMPLO
```

## Como funciona

- **Um modelo por tabela, compartilhado entre integrações.** `bronze_usuarios.sql`
  serve qualquer integração cuja raw tenha `raw_usuarios` — a `source` resolve o
  dataset via `env_var('DBT_RAW_DATASET')` e a saída via `env_var('DBT_SCHEMA_BRONZE')`,
  ambos setados pelo gateway **por requisição**. Regenerar sobrescreve o arquivo.
- **`_datacore_raw__sources.yml`** é gerado a partir de `_generated_sources.json`,
  que acumula as tabelas conforme integrações são criadas (merge, não substitui).
- **`bronze_<tabela>.sql`**: renome das colunas selecionadas +
  `cast(_airbyte_extracted_at as timestamp) as dt_ingestao_lake` +
  `current_timestamp() as _dbt_loaded_at`; **LGPD Art. 46** por heurística de
  nome (`cpf|cnpj` → `mascarar_cpf`, `email` → `tokenizar_email`,
  `cartao|telefone|rg|senha` → `hash_sha256`); **dedup CDC**
  (`qualify row_number() over (partition by <PK> order by dt_ingestao_lake desc)`)
  quando há PK; **incremental `merge`** quando `loadType=incremental` + PK, senão `table`.
- **Sem staging** para os gerados (a lógica está no próprio `bronze_<t>.sql`).
- Silver/Gold: só os modelos de exemplo. Sem codegen.

### Fluxo

```
Criar integração (wizard 1→2→3) → cria a conexão Airbyte
   └─ POST /api/dbt/models   (AutoPipelineView → dbtCodegen.writeIntegrationModels)
        escreve/atualiza models/medallion/bronze/bronze_<t>.sql (+ .yml) e a source
        DBT_CODEGEN_GIT=commit|push → também versiona

Airbyte sincroniza → raw_<t> aparece

Construir Bronze (botão do canvas ou bronzeAutoSync)
   → buildBronzeViaDbt(tables) → runDbt(select: "bronze_<t1> bronze_<t2> ...")
   → dbt build --select bronze_<t1> ... --target prod
   → materializa <DBT_SCHEMA_BRONZE>.bronze_<t>
   → resultado mapeado por tabela; modelo ausente = erro (sem fallback)
```

## Rodar o exemplo (sem Airbyte)

```bash
cd dbt
python -m venv .venv && . .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
export DBT_PROFILES_DIR="$PWD"

export DBT_GCP_PROJECT="seu-projeto"
export DBT_RAW_DATASET="raw"          # dataset do seed
export DBT_TARGET="dev"               # ou prod + DBT_GCP_KEYFILE=<sa.json>
export DBT_DEMO_ENABLED="true"        # habilita os modelos *_transacoes

dbt deps
dbt seed
dbt build --select stg_transacoes bronze_transacoes silver_transacoes gold_kpis_transacoes
```

O gateway roda com `DBT_DEMO_ENABLED=false` (só os modelos gerados) e
`DBT_PACKAGES_INSTALL_PATH` fora da pasta do projeto (o symlink `integration_tests`
do `dbt_utils` trava `dbt deps` em diretório sincronizado por OneDrive).

Validado ponta a ponta em BigQuery real (dbt-core 1.12.4 / dbt-bigquery 1.12.0):
o mesmo `bronze_usuarios.sql` materializou `bronze_datacore.bronze_usuarios` e
`bronze_analytics_curated.bronze_usuarios` (datasets diferentes, mesma requisição-modelo).

## Endpoints do codegen (gateway)

| Método | Rota | Uso |
|--------|------|-----|
| `POST` | `/api/dbt/models` | spec completo no corpo — chamado na criação da integração |
| `POST` | `/api/dbt/models/from-integration` | `{ connectionId }` — reconstrói o spec do estado persistido (Supabase + PKs do Airbyte) e regera. Idempotente: retry manual, hook do Airflow |
| `GET`  | `/api/dbt/models` | lista os modelos Bronze gerados |

Na criação (`AutoPipelineView`): 3 tentativas do `POST /api/dbt/models` →
fallback para `/from-integration` → erro visível no wizard se tudo falhar.

```bash
curl -X POST http://localhost:8080/api/dbt/models \
  -H "Authorization: Bearer $GATEWAY_API_KEY" -H 'Content-Type: application/json' \
  -d '{"projectId":"data-plataform-dev","rawDataset":"raw_x","bronzeDataset":"bronze_x",
       "applyLgpd":true,
       "tables":[{"name":"usuarios","columns":["id","nome","email"],
                  "primaryKey":["id"],"loadType":"incremental"}]}'
# -> escreve dbt/models/medallion/bronze/bronze_usuarios.sql (+ .yml) e atualiza a source
```

## Variáveis (ver `../.env.example`)

| Var | Efeito |
|-----|--------|
| `DBT_DEMO_ENABLED` | `false` desliga os modelos de exemplo; o gateway força `false` |
| `DBT_CODEGEN_GIT` | `off` / `commit` / `push` — versiona os modelos gerados |
| `DBT_PACKAGES_INSTALL_PATH` | pasta dos pacotes dbt (fora do projeto no gateway/container) |
| `DBT_PROJECT_DIR` | pasta do projeto (container: `/app/dbt`) |
| `DBT_RUN_TIMEOUT_MS` | timeout por `dbt build` (default 900000) |
| `DBT_DISABLED` | `true` = toda Bronze falha (503), sem fallback |

Contexto por requisição: `projectId → DBT_GCP_PROJECT`,
`rawDataset → DBT_RAW_DATASET`, `bronzeDataset → DBT_SCHEMA_BRONZE`,
`location → DBT_GCP_LOCATION`. Credenciais: reusa `BIGQUERY_CREDENTIALS_JSON`.

## Deploy — como os modelos gerados chegam ao gateway

A imagem do gateway "assa" `dbt/` no build. Uma tabela nova só constrói via dbt
**depois** que `bronze_<tabela>.sql` está na imagem: `DBT_CODEGEN_GIT=push` +
trigger de deploy no push, ou redeploy manual, ou (futuro) `git pull` do `dbt/`
no start do container.

## Limitações conhecidas

- **Uma definição por nome de tabela.** Se duas integrações têm um `usuarios` com
  schema diferente, o último a regenerar vence (é o comportamento pedido).
- Sem cast de tipos por coluna (o discovery do Airbyte não é propagado com tipos).
- Falha de **teste** dbt marca `dbt.ok=false` (HTTP 207) mas não vira erro por
  tabela — o `bronze_status` do `pipeline_runs` continua `built`.

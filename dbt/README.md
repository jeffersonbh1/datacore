# DataCore — Projeto dbt (camada Bronze)

Projeto dbt real (dbt-core + `dbt-bigquery`). A camada **Bronze é 100% dbt**:
ao criar uma integração no Studio, o gateway **gera um modelo dbt por tabela**
em `models/generated/<slug>/` e depois roda `dbt build --select tag:<slug>`.
Não existe mais construção de Bronze fora do dbt (o antigo
`CREATE OR REPLACE TABLE … AS SELECT *` foi removido).

```
dbt/
├── dbt_project.yml            # config + convenção de datasets
├── packages.yml               # dbt_utils
├── profiles.yml               # perfis dev/prod, 100% via env var (usado pelo gateway)
├── profiles.example.yml       # cópia comentada para uso local manual
├── requirements.txt           # dbt-core + dbt-bigquery
├── macros/
│   ├── generate_schema_name.sql   # dataset verbatim (= valor da env var)
│   ├── lgpd.sql                    # mascarar_cpf / tokenizar_email / hash_sha256
│   └── cast_seguro.sql
├── models/
│   ├── generated/             # << PRODUÇÃO — escrito pelo gateway, um dir por integração
│   │   └── <slug>/
│   │       ├── _<slug>__sources.yml     # source do dataset raw_ (uma entrada por tabela)
│   │       ├── _<slug>__models.yml      # testes (unique/not_null nas PKs)
│   │       ├── stg_<slug>__<t>.sql      # ephemeral: renome + marca d'água de ingestão
│   │       └── bronze_<slug>__<t>.sql   # alias bronze_<t>: LGPD + dedup CDC + incremental
│   ├── staging/  + medallion/ # EXEMPLO (transacoes) — referência + fixture de teste local
│   └── ...
├── seeds/raw_transacoes.csv   # 12 linhas de demonstração (roda o exemplo sem Airbyte)
└── tests/assert_bronze_pii_anonimizada.sql
```

`<slug>` = `conn_<airbyteConnectionId sanitizado>` — estável e conhecido pelo
frontend (após criar a conexão), pelo `buildPipelineFromIntegration` e pelo
`bronzeAutoSync`.

## Fluxo (produção)

```
Criar integração (wizard passos 1→2→3)
  1. Source Airbyte           2. Destino BigQuery (dataset raw_<base>)
  3. Seleciona tabelas + agenda → cria a conexão Airbyte (prefix raw_)
        │
        ├─(a) POST /api/dbt/models    (AutoPipelineView → server/dbtCodegen.ts)
        │      escreve models/generated/<slug>/{sources,models,stg_*,bronze_*}
        │      metadado: colunas, primaryKey (Airbyte), loadType, cursor, applyLgpd
        │      DBT_CODEGEN_GIT=commit|push → também versiona no repo
        │
        └─ persiste integração/pipeline no Supabase

Airbyte sincroniza  →  raw_<t> aparece em raw_<base>

Construção da Bronze (não roda na criação — a raw ainda não existe):
  • Automática: Cloud Scheduler → POST /api/bigquery/bronze/auto-sync
                após o 1º job Airbyte "succeeded"
  • Manual:     botão "Construir Camada Bronze" no nó do canvas
  ambas → buildBronzeViaDbt() → runDbt(select: "tag:<slug>")
       → dbt build --select tag:<slug> --target prod
       → bronze_<slug>__<t> materializa <bronzeDataset>.bronze_<t>
       → resultado mapeado por tabela; modelo ausente = erro (sem fallback)
```

## O que o modelo Bronze gerado faz

- **staging (ephemeral)** — `select` das colunas selecionadas de
  `source('<slug>','<t>')` + `cast(_airbyte_extracted_at as timestamp) as dt_ingestao_lake`.
- **bronze** — `{{ config(alias='bronze_<t>', schema=env_var('DBT_SCHEMA_BRONZE'),
  tags=['generated','<slug>','bronze'], partition_by=dt_ingestao_lake/dia) }}`
  - **LGPD Art. 46** (quando `applyLgpd`) — heurística por nome de coluna:
    `cpf|cnpj|documento` → `mascarar_cpf` · `email` → `tokenizar_email` ·
    `cartao|card|pan|telefone|rg|cnh` → `hash_sha256` (macros em `macros/lgpd.sql`).
  - **Dedup CDC** — `qualify row_number() over (partition by <PK> order by dt_ingestao_lake desc) = 1`
    quando a tabela tem PK.
  - **Incremental** (`merge` por PK) quando `loadType = incremental` + PK; senão `table`.
- **testes** — `unique`+`not_null` na PK simples; `dbt_utils.unique_combination_of_columns` na composta.

Limitações atuais do template: sem cast de tipos por coluna (o Airbyte discovery
não é propagado com tipos); PII por **heurística de nome**, não por marcação
explícita do canvas. Ambos são incrementos futuros do codegen.

## Pré-requisitos

- Python 3.9+ ; acesso ao BigQuery (dev: `gcloud auth application-default login`; prod: service account).

## Rodar o exemplo (sem Airbyte)

```bash
cd dbt
python -m venv .venv && . .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
export DBT_PROFILES_DIR="$PWD"
cp profiles.example.yml profiles.yml

export DBT_GCP_PROJECT="seu-projeto"
export DBT_RAW_DATASET="raw"          # dataset do seed
export DBT_TARGET="dev"
export DBT_GENERATED_ENABLED="false"  # ignora models/generated (dependem de raw real)

dbt deps
dbt seed
dbt build --select models/staging models/medallion
dbt docs generate && dbt docs serve
```

## Testar o codegen (gateway rodando)

```bash
curl -X POST http://localhost:8080/api/dbt/models \
  -H "Authorization: Bearer $GATEWAY_API_KEY" -H 'Content-Type: application/json' \
  -d '{"slug":"conn_smoke","projectId":"data-plataform-dev",
       "rawDataset":"raw_smoke","bronzeDataset":"bronze_smoke","applyLgpd":true,
       "tables":[{"name":"clientes","columns":["id_cliente","cpf","email"],
                  "primaryKey":["id_cliente"],"loadType":"incremental"}]}'
# -> escreve dbt/models/generated/conn_smoke/*  (git: skipped|committed|pushed)
```

## Integração com o gateway — variáveis (ver `../.env.example`)

| Var | Efeito |
|-----|--------|
| `DBT_CODEGEN_GIT` | `off` (só escreve) · `commit` · `push` (versiona os modelos gerados) |
| `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` | autor do commit do codegen |
| `DBT_GENERATED_ENABLED` | `false` só para o `dbt build` local do exemplo; no gateway `true` |
| `DBT_PROJECT_DIR` | pasta do projeto (container: `/app/dbt`) |
| `DBT_RUN_TIMEOUT_MS` | timeout por `dbt build` (default 900000) |
| `DBT_DISABLED` | `true` = parada de emergência: toda Bronze falha (503), sem fallback |

Contexto por requisição: `projectId → DBT_GCP_PROJECT`,
`rawDataset → DBT_RAW_DATASET`, `bronzeDataset → DBT_SCHEMA_BRONZE`,
`location → DBT_GCP_LOCATION`. Credenciais: reusa `BIGQUERY_CREDENTIALS_JSON`
(o gateway grava um keyfile temporário). Execuções serializadas no processo.

## Deploy — como os modelos gerados chegam ao gateway

A imagem do gateway "assa" `dbt/` no build (`COPY dbt ./dbt`). Então:

- **Local** — `DBT_PROJECT_DIR` = `<repo>/dbt`; os arquivos gerados aparecem na hora.
- **Cloud Run** — uma integração nova só constrói a Bronze via dbt **após um
  redeploy** que inclua `models/generated/<slug>/` na imagem — ou seja:
  `DBT_CODEGEN_GIT=push` + pipeline de deploy no push, **ou** um passo de
  `git pull` do `dbt/` no start do container (não implementado).

## Limitação conhecida

Falha de **teste** dbt (ex.: `unique` violado) marca `dbt.ok = false` na
resposta HTTP (207) mas **não** vira `status: 'error'` por tabela — o
`bronze_status` do `pipeline_runs` (auto-sync) continua `built`. Falha de
**build** de modelo, sim, propaga como erro da tabela.

# DataCore — Projeto dbt (camadas Bronze / Silver / Gold)

Projeto dbt real (dbt-core + `dbt-bigquery`) que implementa a arquitetura
medalhão do DataCore Studio. Substitui a geração de SQL "de mentira" do
`DbtSqlEditorModal.tsx` por modelos versionados, testados e executáveis.

```
dbt/
├── dbt_project.yml            # config, convenção de datasets, seed
├── packages.yml               # dbt_utils
├── profiles.yml               # perfis dev/prod, 100% via env var (usado pelo gateway)
├── profiles.example.yml       # cópia comentada para uso local manual
├── requirements.txt           # dbt-core + dbt-bigquery
├── macros/
│   ├── generate_schema_name.sql   # datasets verbatim (bronze/silver/gold)
│   ├── lgpd.sql                    # mascarar_cpf / hash_sha256 / tokenizar_email
│   └── cast_seguro.sql            # cast_decimal (SAFE_CAST + round)
├── models/
│   ├── staging/
│   │   ├── _datacore__sources.yml  # zona RAW do Airbyte (raw_transacoes)
│   │   ├── _datacore__models.yml
│   │   └── stg_transacoes.sql
│   └── medallion/
│       ├── bronze/bronze_transacoes.sql   # tipagem + CDC dedup + LGPD (incremental/merge)
│       ├── silver/silver_transacoes.sql   # curadoria, faixa de ticket, flag de sucesso
│       └── gold/gold_kpis_transacoes.sql  # data mart de KPIs
├── seeds/raw_transacoes.csv    # 12 linhas de demonstração (roda sem Airbyte)
└── tests/assert_bronze_pii_anonimizada.sql
```

## Mapa camada → dataset BigQuery

| Camada  | Modelo                   | Materialização        | Dataset (env var)              |
|---------|--------------------------|-----------------------|--------------------------------|
| RAW     | `source('datacore', …)`  | (Airbyte)             | `DBT_RAW_DATASET` (ex. `raw_vendas`) |
| Staging | `stg_transacoes`         | view                  | `DBT_SCHEMA_STAGING`           |
| Bronze  | `bronze_transacoes`      | incremental (`merge`) | `DBT_SCHEMA_BRONZE`            |
| Silver  | `silver_transacoes`      | table                 | `DBT_SCHEMA_SILVER`            |
| Gold    | `gold_kpis_transacoes`   | table                 | `DBT_SCHEMA_GOLD`              |

O macro `generate_schema_name` usa os nomes **verbatim** (sem prefixo do
ambiente), casando com o padrão `raw_ → bronze_` de `server/routes/bronze.ts`.

## Pré-requisitos

- Python 3.9+
- Acesso ao BigQuery (mesmo projeto GCP do app). Dev usa
  `gcloud auth application-default login`; prod usa a service account.

## Setup

```bash
cd dbt
python -m venv .venv
. .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# perfil: aponte o dbt para esta pasta e crie o profiles.yml a partir do exemplo
export DBT_PROFILES_DIR="$PWD"
cp profiles.example.yml profiles.yml

# variáveis (ver ../.env.example, bloco "dbt")
export DBT_GCP_PROJECT="seu-projeto"
export DBT_GCP_LOCATION="southamerica-east1"
export DBT_RAW_DATASET="raw"          # dataset onde o Airbyte grava raw_*
export DBT_TARGET="dev"

dbt deps
```

## Rodar

```bash
# Sem Airbyte: carrega o seed que simula a zona RAW (cria <DBT_RAW_DATASET>.raw_transacoes)
dbt seed

# Constrói staging + bronze + silver + gold
dbt build --select staging medallion

# Só uma camada
dbt run  --select medallion.bronze
dbt test --select medallion.silver

# Documentação navegável (lineage RAW → Gold)
dbt docs generate && dbt docs serve
```

Com Airbyte real: pule o `dbt seed`, garanta que `DBT_RAW_DATASET` aponta para
o dataset `raw_*` da conexão e rode `dbt build`. A Bronze é incremental —
execuções seguintes só processam linhas com `_airbyte_extracted_at` mais novo
que o último carregamento (`dbt run --select medallion.bronze --full-refresh`
força reconstrução).

## O que a Bronze faz (equivalente real do modal)

- `SAFE_CAST` defensivo de tipos (`cast_decimal`)
- LGPD Art. 46 (`macros/lgpd.sql`):
  - **CPF** → redação parcial determinística `***.NNN.***-**`
  - **Cartão** → SHA-256 hex irreversível
  - **E-mail** → local-part hasheada, domínio preservado
- Deduplicação CDC: `qualify row_number() over (partition by id_transacao order by dt_geracao_origem desc, …)`
- Carga incremental por marca d'água, partição diária por `dt_ingestao_lake`

## Integração com o gateway (implementado)

`server/routes/bronze.ts` **não** faz mais `CREATE OR REPLACE TABLE ... AS
SELECT *`. Agora `buildBronzeViaDbt()` chama `server/dbtRunner.ts`, que executa:

```
dbt --no-use-colors build \
  --select "$DBT_BRONZE_SELECT" \
  --target prod --project-dir /app/dbt --profiles-dir /app/dbt
```

- **Credenciais:** reusa `BIGQUERY_CREDENTIALS_JSON` (o gateway grava um keyfile
  temporário e exporta `DBT_GCP_KEYFILE`). Nenhum segredo novo.
- **Contexto por requisição:** `projectId → DBT_GCP_PROJECT`,
  `rawDataset → DBT_RAW_DATASET`, `bronzeDataset → DBT_SCHEMA_BRONZE`
  (Silver/Gold/Staging derivados trocando o prefixo), `location → DBT_GCP_LOCATION`.
- **Mapeamento de resultado:** cada tabela pedida casa com o modelo
  `bronze_<tabela>`. Tabelas **sem modelo** caem no mirror 1:1 legado
  (`DBT_BRONZE_FALLBACK_CTAS=false` desliga isso e as marca como erro).
- **Concorrência:** as execuções são serializadas no processo (o botão do
  Studio e o `bronzeAutoSync` compartilham `target/`).
- Os dois chamadores (`POST /api/bigquery/bronze/build` e
  `bronzeAutoSyncRouter`) usam o mesmo caminho — `buildBronzeForTables()`
  continua com a assinatura antiga.

### Variáveis (ver `../.env.example`)

| Var | Efeito |
|-----|--------|
| `DBT_BRONZE_SELECT` | `--select` do build (default `staging medallion.bronze`) |
| `DBT_BRONZE_FALLBACK_CTAS` | `false` desativa o mirror 1:1 para tabelas sem modelo / dbt ausente |
| `DBT_DISABLED` | `true` ignora o dbt e usa só o mirror 1:1 |
| `DBT_PROJECT_DIR` | pasta do projeto (container: `/app/dbt`) |
| `DBT_RUN_TIMEOUT_MS` | timeout por invocação (default 900000) |

### Imagem

O `Dockerfile` do gateway instala `python3` + `dbt-bigquery`, copia `./dbt` e
roda `dbt deps` no build. Cloud Run escala a zero — a primeira Bronze após um
cold start paga o custo de subir o processo do dbt (~alguns segundos).

### Limitação conhecida

Falha de **teste** dbt (ex.: `unique` violado) marca `dbt.ok = false` na
resposta HTTP (status 207), mas **não** vira `status: 'error'` por tabela — logo
o `bronze_status` do `pipeline_runs` (gravado pelo auto-sync) continua `built`.
Falha de **build** de modelo, sim, propaga como erro da tabela.

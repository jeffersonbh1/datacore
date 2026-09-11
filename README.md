# DataCore

Plataforma visual para montar pipelines de dados. A pessoa usuária desenha, no
navegador, de onde os dados vêm e para onde vão — e a plataforma copia,
organiza e anonimiza (LGPD) essas tabelas dentro de um data lakehouse no
BigQuery, seguindo o padrão *medalhão* (RAW → Bronze → Silver → Gold).

**Stack:** React + Vite (frontend) · Node/Express + TypeScript (gateway) ·
Supabase/Postgres · Airbyte (conectores) · dbt + BigQuery (lakehouse).
Multi-tenant por empresa, com Row-Level Security.

## Documentação

| Documento | Assunto |
| --- | --- |
| [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) | Arquitetura: explicação não-técnica com diagramas, depois componentes, fluxos e a camada Bronze em dbt |
| [`DEPLOY.md`](DEPLOY.md) | Runbook de deploy (Cloud Build → Cloud Run, Secret Manager, VM do Airbyte) |
| [`dbt/README.md`](dbt/README.md) | Projeto dbt: camadas, macros LGPD, geração de modelos Bronze por sistema |
| [`.env.example`](.env.example) | Todas as variáveis de ambiente do gateway e do frontend |

## Rodar localmente

**Pré-requisitos:** Node.js 22+, e (para a camada Bronze) Python 3.9+ com
`dbt-bigquery`.

1. Instalar dependências:
   ```
   npm install
   ```
2. Copiar `.env.example` para `.env.local` e preencher as credenciais
   (Supabase, Airbyte, service account do BigQuery, `GATEWAY_API_KEY`).
3. Subir o gateway e o frontend em terminais separados:
   ```
   npm run server:dev   # gateway (porta 8080)
   npm run dev           # frontend (porta 3000)
   ```

O gateway é o único backend: o frontend fala com ele via `Bearer
GATEWAY_API_KEY`, e ele orquestra Airbyte, BigQuery e dbt. Detalhes em
[`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

{{ config(
    materialized = 'table'
    , alias = 'silver_salesforce_pipelines'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "salesforce", camada Silver, tabela pipelines.
-- A regeração sobrescreve este arquivo. Ponto de partida: passthrough do Bronze
-- já tipado/deduplicado/sanitizado — adicione aqui as regras de curadoria do
-- negócio (joins, métricas, renomes analíticos) conforme necessário.
-- Origem: ref('bronze_salesforce_pipelines')
-- Saída : <DBT_SCHEMA_SILVER>.silver_salesforce_pipelines

select * from {{ ref('bronze_salesforce_pipelines') }}

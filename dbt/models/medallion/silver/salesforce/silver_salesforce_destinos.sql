{{ config(
    materialized = 'table'
    , alias = 'silver_salesforce_destinos'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "salesforce", camada Silver, tabela destinos.
-- A regeração sobrescreve este arquivo. Ponto de partida: passthrough do Bronze
-- já tipado/deduplicado/sanitizado — adicione aqui as regras de curadoria do
-- negócio (joins, métricas, renomes analíticos) conforme necessário.
-- Origem: ref('bronze_salesforce_destinos')
-- Saída : <DBT_SCHEMA_SILVER>.silver_salesforce_destinos

select * from {{ ref('bronze_salesforce_destinos') }}

{{ config(
    materialized = 'table'
    , alias = 'silver_salesforce_dbt_modelos'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "salesforce", camada Silver, tabela dbt_modelos.
-- A regeração sobrescreve este arquivo. Ponto de partida: passthrough do Bronze
-- já tipado/deduplicado/sanitizado — adicione aqui as regras de curadoria do
-- negócio (joins, métricas, renomes analíticos) conforme necessário.
-- Origem: ref('bronze_salesforce_dbt_modelos')
-- Saída : <DBT_SCHEMA_SILVER>.silver_salesforce_dbt_modelos

select * from {{ ref('bronze_salesforce_dbt_modelos') }}

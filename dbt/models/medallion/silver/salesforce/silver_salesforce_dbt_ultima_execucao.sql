{{ config(
    materialized = 'table'
    , alias = 'silver_salesforce_dbt_ultima_execucao'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "salesforce", camada Silver, tabela dbt_ultima_execucao.
-- A regeração sobrescreve este arquivo. Ponto de partida: passthrough do Bronze
-- já tipado/deduplicado/sanitizado — adicione aqui as regras de curadoria do
-- negócio (joins, métricas, renomes analíticos) conforme necessário.
-- Origem: ref('bronze_salesforce_dbt_ultima_execucao')
-- Saída : <DBT_SCHEMA_SILVER>.silver_salesforce_dbt_ultima_execucao

select * from {{ ref('bronze_salesforce_dbt_ultima_execucao') }}

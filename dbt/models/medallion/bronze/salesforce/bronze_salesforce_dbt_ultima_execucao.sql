{{ config(
    materialized = 'table'
    , alias = 'bronze_salesforce_dbt_ultima_execucao'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "salesforce", camada Bronze, tabela dbt_ultima_execucao.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'dbt_ultima_execucao')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_salesforce_dbt_ultima_execucao  (renome + LGPD Art. 46 + dedup CDC)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   modelo_id -> id_modelo
--   execucao_id -> id_execucao
--   finalizado_em -> dth_finalizado
--   disparado_por -> des_disparado_por
--   sucesso -> des_sucesso
--   iniciado_em -> dth_iniciado
--   status -> des_status

with fonte as (
    select * from {{ source('datacore_raw', 'dbt_ultima_execucao') }}
),

tipado as (
    select
        modelo_id as id_modelo,
        execucao_id as id_execucao,
        finalizado_em as dth_finalizado,
        disparado_por as des_disparado_por,
        sucesso as des_sucesso,
        iniciado_em as dth_iniciado,
        status as des_status,
        cast(_airbyte_extracted_at as timestamp) as dt_ingestao_lake,
        current_timestamp() as _dbt_loaded_at
    from fonte
)

select * from tipado

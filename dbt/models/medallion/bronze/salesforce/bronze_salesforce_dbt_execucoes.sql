{{ config(
    materialized = 'table'
    , alias = 'bronze_salesforce_dbt_execucoes'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "salesforce", camada Bronze, tabela dbt_execucoes.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'dbt_execucoes')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_salesforce_dbt_execucoes  (renome + LGPD Art. 46 + dedup CDC)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   modelo_id -> id_modelo
--   criado_em -> dth_criado
--   log -> des_log
--   finalizado_em -> dth_finalizado
--   disparado_por -> des_disparado_por
--   id -> id_dbt_execucao
--   sucesso -> des_sucesso
--   iniciado_em -> dth_iniciado
--   status -> des_status

with fonte as (
    select * from {{ source('datacore_raw', 'dbt_execucoes') }}
),

tipado as (
    select
        modelo_id as id_modelo,
        criado_em as dth_criado,
        log as des_log,
        finalizado_em as dth_finalizado,
        disparado_por as des_disparado_por,
        id as id_dbt_execucao,
        sucesso as des_sucesso,
        iniciado_em as dth_iniciado,
        status as des_status,
        cast(_airbyte_extracted_at as timestamp) as dt_ingestao_lake,
        current_timestamp() as _dbt_loaded_at
    from fonte
)

, deduplicado as (
    select *
    from tipado
    qualify row_number() over (
        partition by id_dbt_execucao
        order by dt_ingestao_lake desc
    ) = 1
)

select * from deduplicado

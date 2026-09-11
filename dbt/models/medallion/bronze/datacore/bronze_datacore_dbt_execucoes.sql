{{ config(
    materialized = 'table'
    , alias = 'bronze_datacore_dbt_execucoes'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "DataCore", camada Bronze, tabela dbt_execucoes.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'dbt_execucoes')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_datacore_dbt_execucoes  (renome + LGPD Art. 46 + dedup CDC)

with fonte as (
    select * from {{ source('datacore_raw', 'dbt_execucoes') }}
),

tipado as (
    select
        modelo_id,
        criado_em,
        log,
        finalizado_em,
        disparado_por,
        id,
        sucesso,
        iniciado_em,
        status,
        cast(_airbyte_extracted_at as timestamp) as dt_ingestao_lake,
        current_timestamp() as _dbt_loaded_at
    from fonte
)

, deduplicado as (
    select *
    from tipado
    qualify row_number() over (
        partition by id
        order by dt_ingestao_lake desc
    ) = 1
)

select * from deduplicado

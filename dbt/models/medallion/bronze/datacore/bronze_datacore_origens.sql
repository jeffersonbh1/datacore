{{ config(
    materialized = 'table'
    , alias = 'bronze_datacore_origens'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "DataCore", camada Bronze, tabela origens.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'origens')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_datacore_origens  (renome + LGPD Art. 46 + dedup CDC)

with fonte as (
    select * from {{ source('datacore_raw', 'origens') }}
),

tipado as (
    select
        tipo,
        criado_em,
        configuracao,
        airbyte_source_id,
        nome,
        id_empresa,
        id,
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

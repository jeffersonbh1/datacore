{{ config(
    materialized = 'table'
    , alias = 'bronze_destinos'
) }}

-- GERADO por server/dbtCodegen.ts — camada Bronze, tabela destinos.
-- Um arquivo por tabela; a regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'destinos')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_destinos  (renome + LGPD Art. 46 + dedup CDC)

with fonte as (
    select * from {{ source('datacore_raw', 'destinos') }}
),

tipado as (
    select
        tipo,
        criado_em,
        modo_escrita,
        configuracao,
        nome,
        id_empresa,
        airbyte_destination_id,
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

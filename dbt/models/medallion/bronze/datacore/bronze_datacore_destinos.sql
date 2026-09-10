{{ config(
    materialized = 'table'
    , alias = 'bronze_datacore_destinos'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "DataCore", camada Bronze, tabela destinos.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'destinos')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_datacore_destinos  (renome + LGPD Art. 46 + dedup CDC)

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

select * from tipado

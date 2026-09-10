{{ config(
    materialized = 'table'
    , alias = 'bronze_datacore_dbt_modelos'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "DataCore", camada Bronze, tabela dbt_modelos.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'dbt_modelos')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_datacore_dbt_modelos  (renome + LGPD Art. 46 + dedup CDC)

with fonte as (
    select * from {{ source('datacore_raw', 'dbt_modelos') }}
),

tipado as (
    select
        atualizado_em,
        criado_em,
        tabela_origem,
        camada,
        nome,
        id,
        cast(_airbyte_extracted_at as timestamp) as dt_ingestao_lake,
        current_timestamp() as _dbt_loaded_at
    from fonte
)

select * from tipado

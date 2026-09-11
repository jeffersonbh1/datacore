{{ config(
    materialized = 'table'
    , alias = 'bronze_datacore_pipelines'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "DataCore", camada Bronze, tabela pipelines.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'pipelines')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_datacore_pipelines  (renome + LGPD Art. 46 + dedup CDC)

with fonte as (
    select * from {{ source('datacore_raw', 'pipelines') }}
),

tipado as (
    select
        atualizado_em,
        criado_em,
        criado_por,
        categoria,
        camadas,
        nome,
        id_empresa,
        integracao_id,
        id,
        layout_overrides,
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

{{ config(
    materialized = 'incremental'
    , alias = 'bronze_crm_pipelines'
    , unique_key = 'id'
    , incremental_strategy = 'merge'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "crm", camada Bronze, tabela pipelines.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'pipelines')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_crm_pipelines  (renome + LGPD Art. 46 + dedup CDC)

with fonte as (
    select * from {{ source('datacore_raw', 'pipelines') }}
    {% if is_incremental() %}
    where _airbyte_extracted_at > (select max(dt_ingestao_lake) from {{ this }})
    {% endif %}
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

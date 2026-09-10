{{ config(
    materialized = 'table'
    , alias = 'bronze_datacoredbt_pipeline_runs'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "DataCoreDBT", camada Bronze, tabela pipeline_runs.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'pipeline_runs')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_datacoredbt_pipeline_runs  (renome + LGPD Art. 46 + dedup CDC)

with fonte as (
    select * from {{ source('datacore_raw', 'pipeline_runs') }}
),

tipado as (
    select
        records_synced,
        bronze_built_em,
        iniciado_em,
        duration_ms,
        airbyte_job_id,
        criado_em,
        finalizado_em,
        pipeline_id,
        id_empresa,
        bronze_status,
        id,
        bronze_error,
        status,
        bytes_synced,
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

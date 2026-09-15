{{ config(
    materialized = 'table'
    , alias = 'bronze_salesforce_pipeline_runs'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "salesforce", camada Bronze, tabela pipeline_runs.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'pipeline_runs')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_salesforce_pipeline_runs  (renome + LGPD Art. 46 + dedup CDC)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   records_synced -> des_registros_sincronizacao
--   bronze_built_em -> dth_bronze_construcao
--   iniciado_em -> dth_iniciado
--   duration_ms -> des_duracao_ms
--   airbyte_job_id -> id_airbyte_job
--   criado_em -> dth_criado
--   finalizado_em -> dth_finalizado
--   pipeline_id -> id_pipeline
--   bronze_status -> des_bronze_status
--   id -> id_pipeline_run
--   bronze_error -> des_bronze_erro
--   status -> des_status
--   bytes_synced -> des_bytes_sincronizacao

with fonte as (
    select * from {{ source('datacore_raw', 'pipeline_runs') }}
),

tipado as (
    select
        records_synced as des_registros_sincronizacao,
        bronze_built_em as dth_bronze_construcao,
        iniciado_em as dth_iniciado,
        duration_ms as des_duracao_ms,
        airbyte_job_id as id_airbyte_job,
        criado_em as dth_criado,
        finalizado_em as dth_finalizado,
        pipeline_id as id_pipeline,
        id_empresa as id_empresa,
        bronze_status as des_bronze_status,
        id as id_pipeline_run,
        bronze_error as des_bronze_erro,
        status as des_status,
        bytes_synced as des_bytes_sincronizacao,
        cast(_airbyte_extracted_at as timestamp) as dt_ingestao_lake,
        current_timestamp() as _dbt_loaded_at
    from fonte
)

, deduplicado as (
    select *
    from tipado
    qualify row_number() over (
        partition by id_pipeline_run
        order by dt_ingestao_lake desc
    ) = 1
)

select * from deduplicado

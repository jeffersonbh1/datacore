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

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'pipeline_runs') }}
),

tipado AS (
    SELECT
        records_synced                            AS des_registros_sincronizacao,
        bronze_built_em                           AS dth_bronze_construcao,
        iniciado_em                               AS dth_iniciado,
        duration_ms                               AS des_duracao_ms,
        airbyte_job_id                            AS id_airbyte_job,
        criado_em                                 AS dth_criado,
        finalizado_em                             AS dth_finalizado,
        pipeline_id                               AS id_pipeline,
        id_empresa                                AS id_empresa,
        bronze_status                             AS des_bronze_status,
        id                                        AS id_pipeline_run,
        bronze_error                              AS des_bronze_erro,
        status                                    AS des_status,
        bytes_synced                              AS des_bytes_sincronizacao,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS dt_ingestao_lake,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

, deduplicado AS (
    SELECT *
    FROM tipado
    QUALIFY row_number() OVER (
        PARTITION BY id_pipeline_run
        ORDER BY dt_ingestao_lake DESC
    ) = 1
)

SELECT * FROM deduplicado

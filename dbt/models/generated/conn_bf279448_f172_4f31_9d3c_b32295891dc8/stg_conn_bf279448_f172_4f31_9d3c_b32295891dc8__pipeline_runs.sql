{{ config(
    materialized = 'ephemeral',
    enabled = env_var('DBT_ACTIVE_SLUG', 'conn_bf279448_f172_4f31_9d3c_b32295891dc8') == 'conn_bf279448_f172_4f31_9d3c_b32295891dc8',
    tags = ['generated', 'conn_bf279448_f172_4f31_9d3c_b32295891dc8', 'staging'],
) }}

-- GERADO por server/dbtCodegen.ts — integração conn_bf279448_f172_4f31_9d3c_b32295891dc8, tabela pipeline_runs.
-- Ephemeral: compilado como CTE dentro do bronze_ correspondente (sem objeto no BQ).
-- enabled: só participa do parse quando DBT_ACTIVE_SLUG é esta integração (ou
-- não está setado). Evita colisão de alias quando integrações compartilham o
-- mesmo bronze dataset.
with fonte as (
    select * from {{ source('conn_bf279448_f172_4f31_9d3c_b32295891dc8', 'pipeline_runs') }}
),

renomeado as (
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
        _airbyte_raw_id as _raw_id
    from fonte
)

select * from renomeado

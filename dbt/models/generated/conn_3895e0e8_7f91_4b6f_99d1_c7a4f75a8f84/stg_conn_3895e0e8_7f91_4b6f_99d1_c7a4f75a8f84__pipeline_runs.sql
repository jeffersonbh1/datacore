{{ config(
    materialized = 'ephemeral',
    enabled = env_var('DBT_ACTIVE_SLUG', 'conn_3895e0e8_7f91_4b6f_99d1_c7a4f75a8f84') == 'conn_3895e0e8_7f91_4b6f_99d1_c7a4f75a8f84',
    tags = ['generated', 'conn_3895e0e8_7f91_4b6f_99d1_c7a4f75a8f84', 'staging'],
) }}

-- GERADO por server/dbtCodegen.ts — integração conn_3895e0e8_7f91_4b6f_99d1_c7a4f75a8f84, tabela pipeline_runs.
-- Ephemeral: compilado como CTE dentro do bronze_ correspondente (sem objeto no BQ).
-- enabled: só participa do parse quando DBT_ACTIVE_SLUG é esta integração (ou
-- não está setado). Evita colisão de alias quando integrações compartilham o
-- mesmo bronze dataset.
with fonte as (
    select * from {{ source('conn_3895e0e8_7f91_4b6f_99d1_c7a4f75a8f84', 'pipeline_runs') }}
),

renomeado as (
    select
        duration_ms,
        airbyte_job_id,
        criado_em,
        finalizado_em,
        records_synced,
        pipeline_id,
        id_empresa,
        id,
        iniciado_em,
        status,
        bytes_synced,
        cast(_airbyte_extracted_at as timestamp) as dt_ingestao_lake,
        _airbyte_raw_id as _raw_id
    from fonte
)

select * from renomeado

{{ config(
    materialized = 'table'
    , alias = 'bronze_pipeline_runs'
    , enabled = env_var('DBT_ACTIVE_SLUG', 'conn_bf279448_f172_4f31_9d3c_b32295891dc8') == 'conn_bf279448_f172_4f31_9d3c_b32295891dc8'
    , tags = ['generated', 'conn_bf279448_f172_4f31_9d3c_b32295891dc8', 'bronze']
    , partition_by = {'field': 'dt_ingestao_lake', 'data_type': 'timestamp', 'granularity': 'day'}
) }}

-- GERADO por server/dbtCodegen.ts — integração conn_bf279448_f172_4f31_9d3c_b32295891dc8, tabela pipeline_runs.
-- Camada Bronze: renome/tipagem leve + LGPD (Art. 46) + deduplicação CDC.
-- Editar aqui é permitido; a regeração sobrescreve o diretório inteiro.

with raw_source as (
    select * from {{ ref('stg_conn_bf279448_f172_4f31_9d3c_b32295891dc8__pipeline_runs') }}
),

sanitizado as (
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
        dt_ingestao_lake,
        current_timestamp() as _dbt_loaded_at
    from raw_source
)

, deduplicado as (
    select *
    from sanitizado
    qualify row_number() over (
        partition by id
        order by dt_ingestao_lake desc
    ) = 1
)

select * from deduplicado

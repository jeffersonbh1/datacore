{{ config(
    materialized = 'table'
    , alias = 'bronze_pipeline_runs'
    , enabled = env_var('DBT_ACTIVE_SLUG', 'conn_9576aa61_6465_448e_bdaf_aa61aa53c4fe') == 'conn_9576aa61_6465_448e_bdaf_aa61aa53c4fe'
    , tags = ['generated', 'conn_9576aa61_6465_448e_bdaf_aa61aa53c4fe', 'bronze']
    , partition_by = {'field': 'dt_ingestao_lake', 'data_type': 'timestamp', 'granularity': 'day'}
) }}

-- GERADO por server/dbtCodegen.ts — integração conn_9576aa61_6465_448e_bdaf_aa61aa53c4fe, tabela pipeline_runs.
-- Camada Bronze: renome/tipagem leve + LGPD (Art. 46) + deduplicação CDC.
-- Editar aqui é permitido; a regeração sobrescreve o diretório inteiro.

with raw_source as (
    select * from {{ ref('stg_conn_9576aa61_6465_448e_bdaf_aa61aa53c4fe__pipeline_runs') }}
),

sanitizado as (
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

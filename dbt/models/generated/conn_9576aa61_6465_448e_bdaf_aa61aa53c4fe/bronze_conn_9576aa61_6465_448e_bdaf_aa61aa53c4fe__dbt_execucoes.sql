{{ config(
    materialized = 'table'
    , alias = 'bronze_dbt_execucoes'
    , enabled = env_var('DBT_ACTIVE_SLUG', 'conn_9576aa61_6465_448e_bdaf_aa61aa53c4fe') == 'conn_9576aa61_6465_448e_bdaf_aa61aa53c4fe'
    , tags = ['generated', 'conn_9576aa61_6465_448e_bdaf_aa61aa53c4fe', 'bronze']
    , partition_by = {'field': 'dt_ingestao_lake', 'data_type': 'timestamp', 'granularity': 'day'}
) }}

-- GERADO por server/dbtCodegen.ts — integração conn_9576aa61_6465_448e_bdaf_aa61aa53c4fe, tabela dbt_execucoes.
-- Camada Bronze: renome/tipagem leve + LGPD (Art. 46) + deduplicação CDC.
-- Editar aqui é permitido; a regeração sobrescreve o diretório inteiro.

with raw_source as (
    select * from {{ ref('stg_conn_9576aa61_6465_448e_bdaf_aa61aa53c4fe__dbt_execucoes') }}
),

sanitizado as (
    select
        modelo_id,
        criado_em,
        log,
        finalizado_em,
        disparado_por,
        id,
        sucesso,
        iniciado_em,
        status,
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

{{ config(
    materialized = 'table'
    , alias = 'bronze_origens'
    , enabled = env_var('DBT_ACTIVE_SLUG', 'conn_9576aa61_6465_448e_bdaf_aa61aa53c4fe') == 'conn_9576aa61_6465_448e_bdaf_aa61aa53c4fe'
    , tags = ['generated', 'conn_9576aa61_6465_448e_bdaf_aa61aa53c4fe', 'bronze']
    , partition_by = {'field': 'dt_ingestao_lake', 'data_type': 'timestamp', 'granularity': 'day'}
) }}

-- GERADO por server/dbtCodegen.ts — integração conn_9576aa61_6465_448e_bdaf_aa61aa53c4fe, tabela origens.
-- Camada Bronze: renome/tipagem leve + LGPD (Art. 46) + deduplicação CDC.
-- Editar aqui é permitido; a regeração sobrescreve o diretório inteiro.

with raw_source as (
    select * from {{ ref('stg_conn_9576aa61_6465_448e_bdaf_aa61aa53c4fe__origens') }}
),

sanitizado as (
    select
        tipo,
        criado_em,
        configuracao,
        airbyte_source_id,
        nome,
        id_empresa,
        id,
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

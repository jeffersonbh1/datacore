{{ config(
    materialized = 'table'
    , alias = 'bronze_destinos'
    , enabled = env_var('DBT_ACTIVE_SLUG', 'conn_a21e3763_753f_4f96_82a5_d0d7fb3e74b7') == 'conn_a21e3763_753f_4f96_82a5_d0d7fb3e74b7'
    , tags = ['generated', 'conn_a21e3763_753f_4f96_82a5_d0d7fb3e74b7', 'bronze']
    , partition_by = {'field': 'dt_ingestao_lake', 'data_type': 'timestamp', 'granularity': 'day'}
) }}

-- GERADO por server/dbtCodegen.ts — integração conn_a21e3763_753f_4f96_82a5_d0d7fb3e74b7, tabela destinos.
-- Camada Bronze: renome/tipagem leve + LGPD (Art. 46) + deduplicação CDC.
-- Editar aqui é permitido; a regeração sobrescreve o diretório inteiro.

with raw_source as (
    select * from {{ ref('stg_conn_a21e3763_753f_4f96_82a5_d0d7fb3e74b7__destinos') }}
),

sanitizado as (
    select
        tipo,
        criado_em,
        modo_escrita,
        configuracao,
        nome,
        id_empresa,
        airbyte_destination_id,
        id,
        status,
        dt_ingestao_lake,
        current_timestamp() as _dbt_loaded_at
    from raw_source
)

select * from sanitizado

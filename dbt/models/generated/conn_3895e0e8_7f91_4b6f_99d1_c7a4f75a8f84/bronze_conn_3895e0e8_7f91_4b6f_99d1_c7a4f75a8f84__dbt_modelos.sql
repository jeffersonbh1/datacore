{{ config(
    materialized = 'table'
    , alias = 'bronze_dbt_modelos'
    , enabled = env_var('DBT_ACTIVE_SLUG', 'conn_3895e0e8_7f91_4b6f_99d1_c7a4f75a8f84') == 'conn_3895e0e8_7f91_4b6f_99d1_c7a4f75a8f84'
    , tags = ['generated', 'conn_3895e0e8_7f91_4b6f_99d1_c7a4f75a8f84', 'bronze']
    , partition_by = {'field': 'dt_ingestao_lake', 'data_type': 'timestamp', 'granularity': 'day'}
) }}

-- GERADO por server/dbtCodegen.ts — integração conn_3895e0e8_7f91_4b6f_99d1_c7a4f75a8f84, tabela dbt_modelos.
-- Camada Bronze: renome/tipagem leve + LGPD (Art. 46) + deduplicação CDC.
-- Editar aqui é permitido; a regeração sobrescreve o diretório inteiro.

with raw_source as (
    select * from {{ ref('stg_conn_3895e0e8_7f91_4b6f_99d1_c7a4f75a8f84__dbt_modelos') }}
),

sanitizado as (
    select
        atualizado_em,
        criado_em,
        tabela_origem,
        camada,
        nome,
        id,
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

{{ config(
    materialized = 'table'
    , alias = 'bronze_dbt_ultima_execucao'
    , enabled = env_var('DBT_ACTIVE_SLUG', 'conn_3895e0e8_7f91_4b6f_99d1_c7a4f75a8f84') == 'conn_3895e0e8_7f91_4b6f_99d1_c7a4f75a8f84'
    , tags = ['generated', 'conn_3895e0e8_7f91_4b6f_99d1_c7a4f75a8f84', 'bronze']
    , partition_by = {'field': 'dt_ingestao_lake', 'data_type': 'timestamp', 'granularity': 'day'}
) }}

-- GERADO por server/dbtCodegen.ts — integração conn_3895e0e8_7f91_4b6f_99d1_c7a4f75a8f84, tabela dbt_ultima_execucao.
-- Camada Bronze: renome/tipagem leve + LGPD (Art. 46) + deduplicação CDC.
-- Editar aqui é permitido; a regeração sobrescreve o diretório inteiro.

with raw_source as (
    select * from {{ ref('stg_conn_3895e0e8_7f91_4b6f_99d1_c7a4f75a8f84__dbt_ultima_execucao') }}
),

sanitizado as (
    select
        modelo_id,
        execucao_id,
        finalizado_em,
        disparado_por,
        sucesso,
        iniciado_em,
        status,
        dt_ingestao_lake,
        current_timestamp() as _dbt_loaded_at
    from raw_source
)

select * from sanitizado

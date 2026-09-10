{{ config(
    materialized = 'table'
    , alias = 'bronze_integracoes'
    , enabled = env_var('DBT_ACTIVE_SLUG', 'conn_9576aa61_6465_448e_bdaf_aa61aa53c4fe') == 'conn_9576aa61_6465_448e_bdaf_aa61aa53c4fe'
    , tags = ['generated', 'conn_9576aa61_6465_448e_bdaf_aa61aa53c4fe', 'bronze']
    , partition_by = {'field': 'dt_ingestao_lake', 'data_type': 'timestamp', 'granularity': 'day'}
) }}

-- GERADO por server/dbtCodegen.ts — integração conn_9576aa61_6465_448e_bdaf_aa61aa53c4fe, tabela integracoes.
-- Camada Bronze: renome/tipagem leve + LGPD (Art. 46) + deduplicação CDC.
-- Editar aqui é permitido; a regeração sobrescreve o diretório inteiro.

with raw_source as (
    select * from {{ ref('stg_conn_9576aa61_6465_448e_bdaf_aa61aa53c4fe__integracoes') }}
),

sanitizado as (
    select
        frequencia_sync,
        nome,
        destino_id,
        tabelas_selecionadas,
        dia_mensal,
        data_execucao_unica,
        criado_em,
        horarios_execucao,
        resumo_agendamento,
        origem_id,
        aplicar_sanitizacao_lgpd,
        table_sync_configs,
        airbyte_connection_id,
        pipeline_id,
        id_empresa,
        id,
        dias_semana,
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

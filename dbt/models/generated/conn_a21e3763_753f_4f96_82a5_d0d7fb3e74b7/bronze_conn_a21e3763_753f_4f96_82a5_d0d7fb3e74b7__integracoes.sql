{{ config(
    materialized = 'table'
    , alias = 'bronze_integracoes'
    , enabled = env_var('DBT_ACTIVE_SLUG', 'conn_a21e3763_753f_4f96_82a5_d0d7fb3e74b7') == 'conn_a21e3763_753f_4f96_82a5_d0d7fb3e74b7'
    , tags = ['generated', 'conn_a21e3763_753f_4f96_82a5_d0d7fb3e74b7', 'bronze']
    , partition_by = {'field': 'dt_ingestao_lake', 'data_type': 'timestamp', 'granularity': 'day'}
) }}

-- GERADO por server/dbtCodegen.ts — integração conn_a21e3763_753f_4f96_82a5_d0d7fb3e74b7, tabela integracoes.
-- Camada Bronze: renome/tipagem leve + LGPD (Art. 46) + deduplicação CDC.
-- Editar aqui é permitido; a regeração sobrescreve o diretório inteiro.

with raw_source as (
    select * from {{ ref('stg_conn_a21e3763_753f_4f96_82a5_d0d7fb3e74b7__integracoes') }}
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

select * from sanitizado

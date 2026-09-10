{{ config(
    materialized = 'table'
    , alias = 'bronze_datacore_integracoes'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "DataCore", camada Bronze, tabela integracoes.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'integracoes')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_datacore_integracoes  (renome + LGPD Art. 46 + dedup CDC)

with fonte as (
    select * from {{ source('datacore_raw', 'integracoes') }}
),

tipado as (
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
        cast(_airbyte_extracted_at as timestamp) as dt_ingestao_lake,
        current_timestamp() as _dbt_loaded_at
    from fonte
)

select * from tipado

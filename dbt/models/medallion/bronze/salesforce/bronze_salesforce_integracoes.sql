{{ config(
    materialized = 'table'
    , alias = 'bronze_salesforce_integracoes'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "salesforce", camada Bronze, tabela integracoes.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'integracoes')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_salesforce_integracoes  (renome + LGPD Art. 46 + dedup CDC)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   frequencia_sync -> des_frequencia_sync
--   nome -> des_nome
--   destino_id -> id_destino
--   tabelas_selecionadas -> des_tabelas_selecionadas
--   dia_mensal -> des_dia_mensal
--   data_execucao_unica -> dat_execucao_unica
--   criado_em -> dth_criado
--   horarios_execucao -> des_horarios_execucao
--   resumo_agendamento -> des_resumo_agendamento
--   origem_id -> id_origem
--   aplicar_sanitizacao_lgpd -> des_aplicar_sanitizacao_lgpd
--   table_sync_configs -> des_table_sync_configs
--   airbyte_connection_id -> id_airbyte_connection
--   pipeline_id -> id_pipeline
--   id -> id_integracao
--   dias_semana -> des_dias_semana
--   status -> des_status

with fonte as (
    select * from {{ source('datacore_raw', 'integracoes') }}
),

tipado as (
    select
        frequencia_sync as des_frequencia_sync,
        nome as des_nome,
        destino_id as id_destino,
        tabelas_selecionadas as des_tabelas_selecionadas,
        dia_mensal as des_dia_mensal,
        data_execucao_unica as dat_execucao_unica,
        criado_em as dth_criado,
        horarios_execucao as des_horarios_execucao,
        resumo_agendamento as des_resumo_agendamento,
        origem_id as id_origem,
        aplicar_sanitizacao_lgpd as des_aplicar_sanitizacao_lgpd,
        table_sync_configs as des_table_sync_configs,
        airbyte_connection_id as id_airbyte_connection,
        pipeline_id as id_pipeline,
        id_empresa as id_empresa,
        id as id_integracao,
        dias_semana as des_dias_semana,
        status as des_status,
        cast(_airbyte_extracted_at as timestamp) as dt_ingestao_lake,
        current_timestamp() as _dbt_loaded_at
    from fonte
)

, deduplicado as (
    select *
    from tipado
    qualify row_number() over (
        partition by id_integracao
        order by dt_ingestao_lake desc
    ) = 1
)

select * from deduplicado

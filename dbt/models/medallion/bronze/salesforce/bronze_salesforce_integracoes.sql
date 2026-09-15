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

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'integracoes') }}
),

tipado AS (
    SELECT
        frequencia_sync AS des_frequencia_sync,
        nome AS des_nome,
        destino_id AS id_destino,
        tabelas_selecionadas AS des_tabelas_selecionadas,
        dia_mensal AS des_dia_mensal,
        data_execucao_unica AS dat_execucao_unica,
        criado_em AS dth_criado,
        horarios_execucao AS des_horarios_execucao,
        resumo_agendamento AS des_resumo_agendamento,
        origem_id AS id_origem,
        aplicar_sanitizacao_lgpd AS des_aplicar_sanitizacao_lgpd,
        table_sync_configs AS des_table_sync_configs,
        airbyte_connection_id AS id_airbyte_connection,
        pipeline_id AS id_pipeline,
        id_empresa AS id_empresa,
        id AS id_integracao,
        dias_semana AS des_dias_semana,
        status AS des_status,
        cast(_airbyte_extracted_at AS TIMESTAMP) AS dt_ingestao_lake,
        current_timestamp() AS _dbt_loaded_at
    FROM fonte
)

, deduplicado AS (
    SELECT *
    FROM tipado
    QUALIFY row_number() OVER (
        PARTITION BY id_integracao
        ORDER BY dt_ingestao_lake DESC
    ) = 1
)

SELECT * FROM deduplicado

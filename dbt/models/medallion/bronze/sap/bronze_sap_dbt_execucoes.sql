{{ config(
    materialized = 'table'
    , alias = 'bronze_sap_dbt_execucoes'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "SAP", camada Bronze, tabela dbt_execucoes.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'dbt_execucoes')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_sap_dbt_execucoes  (renome + LGPD Art. 46)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   modelo_id -> id_modelo
--   criado_em -> dth_criado
--   log -> des_log
--   finalizado_em -> dth_finalizado
--   disparado_por -> des_disparado_por
--   id -> id_dbt_execucao
--   sucesso -> des_sucesso
--   iniciado_em -> dth_iniciado
--   status -> des_status

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'dbt_execucoes') }}
    -- Carga full: a Raw guarda o histórico de todas as cargas; aqui entra só a última bem-sucedida.
    {{ filtro_ultima_carga_ok(source('datacore_raw', 'dbt_execucoes')) }}
),

tipado AS (
    SELECT
        modelo_id                                 AS id_modelo,
        criado_em                                 AS dth_criado,
        log                                       AS des_log,
        finalizado_em                             AS dth_finalizado,
        disparado_por                             AS des_disparado_por,
        id                                        AS id_dbt_execucao,
        sucesso                                   AS des_sucesso,
        iniciado_em                               AS dth_iniciado,
        status                                    AS des_status,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS _dat_carga,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

SELECT * FROM tipado

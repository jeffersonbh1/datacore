{{ config(
    materialized = 'table'
    , alias = 'bronze_salesforce_dbt_ultima_execucao'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "salesforce", camada Bronze, tabela dbt_ultima_execucao.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'dbt_ultima_execucao')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_salesforce_dbt_ultima_execucao  (renome + LGPD Art. 46 + dedup CDC)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   modelo_id -> id_modelo
--   execucao_id -> id_execucao
--   finalizado_em -> dth_finalizado
--   disparado_por -> des_disparado_por
--   sucesso -> des_sucesso
--   iniciado_em -> dth_iniciado
--   status -> des_status

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'dbt_ultima_execucao') }}
),

tipado AS (
    SELECT
        modelo_id                                 AS id_modelo,
        execucao_id                               AS id_execucao,
        finalizado_em                             AS dth_finalizado,
        disparado_por                             AS des_disparado_por,
        sucesso                                   AS des_sucesso,
        iniciado_em                               AS dth_iniciado,
        status                                    AS des_status,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS _dat_carga,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

SELECT * FROM tipado

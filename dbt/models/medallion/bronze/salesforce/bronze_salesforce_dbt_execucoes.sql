{{ config(
    materialized = 'table'
    , alias = 'bronze_salesforce_dbt_execucoes'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "salesforce", camada Bronze, tabela dbt_execucoes.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'dbt_execucoes')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_salesforce_dbt_execucoes  (renome + LGPD Art. 46 + dedup CDC)
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
),

tipado AS (
    SELECT
        modelo_id AS id_modelo,
        criado_em AS dth_criado,
        log AS des_log,
        finalizado_em AS dth_finalizado,
        disparado_por AS des_disparado_por,
        id AS id_dbt_execucao,
        sucesso AS des_sucesso,
        iniciado_em AS dth_iniciado,
        status AS des_status,
        cast(_airbyte_extracted_at AS TIMESTAMP) AS dt_ingestao_lake,
        current_timestamp() AS _dbt_loaded_at
    FROM fonte
)

, deduplicado AS (
    SELECT *
    FROM tipado
    QUALIFY row_number() OVER (
        PARTITION BY id_dbt_execucao
        ORDER BY dt_ingestao_lake DESC
    ) = 1
)

SELECT * FROM deduplicado

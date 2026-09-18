{{ config(
    materialized = 'table'
    , alias = 'bronze_salesforce_dbt_modelos'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "salesforce", camada Bronze, tabela dbt_modelos.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'dbt_modelos')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_salesforce_dbt_modelos  (renome + LGPD Art. 46 + dedup CDC)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   atualizado_em -> dth_atualizado
--   criado_em -> dth_criado
--   tabela_origem -> des_tabela_origem
--   camada -> des_camada
--   nome -> des_nome
--   id -> id_dbt_modelo

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'dbt_modelos') }}
),

tipado AS (
    SELECT
        atualizado_em                             AS dth_atualizado,
        criado_em                                 AS dth_criado,
        tabela_origem                             AS des_tabela_origem,
        camada                                    AS des_camada,
        nome                                      AS des_nome,
        id                                        AS id_dbt_modelo,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS dt_ingestao_lake,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

, deduplicado AS (
    SELECT *
    FROM tipado
    QUALIFY row_number() OVER (
        PARTITION BY id_dbt_modelo
        ORDER BY dt_ingestao_lake DESC
    ) = 1
)

SELECT * FROM deduplicado

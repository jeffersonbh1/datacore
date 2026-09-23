{{ config(
    materialized = 'table'
    , alias = 'bronze_salesforce_origens'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "salesforce", camada Bronze, tabela origens.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'origens')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_salesforce_origens  (renome + LGPD Art. 46 + dedup CDC)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   tipo -> tp_origem
--   criado_em -> dth_criado
--   configuracao -> des_configuracao
--   airbyte_source_id -> id_airbyte_origem
--   nome -> des_nome
--   id -> id_origem
--   status -> des_status

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'origens') }}
),

tipado AS (
    SELECT
        tipo                                      AS tp_origem,
        criado_em                                 AS dth_criado,
        configuracao                              AS des_configuracao,
        airbyte_source_id                         AS id_airbyte_origem,
        nome                                      AS des_nome,
        id_empresa                                AS id_empresa,
        id                                        AS id_origem,
        status                                    AS des_status,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS _dat_carga,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

, deduplicado AS (
    SELECT *
    FROM tipado
    QUALIFY row_number() OVER (
        PARTITION BY id_origem
        ORDER BY _dat_carga DESC
    ) = 1
)

SELECT * FROM deduplicado

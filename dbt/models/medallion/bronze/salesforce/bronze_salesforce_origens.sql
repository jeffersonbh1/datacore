{{ config(
    materialized = 'table'
    , alias = 'bronze_salesforce_origens'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "salesforce", camada Bronze, tabela origens.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'origens')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_salesforce_origens  (renome + LGPD Art. 46)
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
    -- Carga full: a Raw guarda o histórico de todas as cargas; aqui entra só a última.
    WHERE CAST(JSON_VALUE(_airbyte_meta, '$.sync_id') AS INT64) = (
        SELECT MAX(CAST(JSON_VALUE(_airbyte_meta, '$.sync_id') AS INT64))
        FROM {{ source('datacore_raw', 'origens') }}
    )
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

SELECT * FROM tipado

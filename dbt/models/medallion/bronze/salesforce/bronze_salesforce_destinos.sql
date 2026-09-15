{{ config(
    materialized = 'table'
    , alias = 'bronze_salesforce_destinos'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "salesforce", camada Bronze, tabela destinos.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'destinos')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_salesforce_destinos  (renome + LGPD Art. 46 + dedup CDC)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   tipo -> tp_destino
--   criado_em -> dth_criado
--   modo_escrita -> des_modo_escrita
--   configuracao -> des_configuracao
--   nome -> des_nome
--   airbyte_destination_id -> id_airbyte_destino
--   id -> id_destino
--   status -> des_status

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'destinos') }}
),

tipado AS (
    SELECT
        tipo                                      AS tp_destino,
        criado_em                                 AS dth_criado,
        modo_escrita                              AS des_modo_escrita,
        configuracao                              AS des_configuracao,
        nome                                      AS des_nome,
        id_empresa                                AS id_empresa,
        airbyte_destination_id                    AS id_airbyte_destino,
        id                                        AS id_destino,
        status                                    AS des_status,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS dt_ingestao_lake,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

, deduplicado AS (
    SELECT *
    FROM tipado
    QUALIFY row_number() OVER (
        PARTITION BY id_destino
        ORDER BY dt_ingestao_lake DESC
    ) = 1
)

SELECT * FROM deduplicado

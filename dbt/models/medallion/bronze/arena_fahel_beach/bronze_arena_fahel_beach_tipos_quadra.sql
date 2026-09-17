{{ config(
    materialized = 'table'
    , alias = 'bronze_arena_fahel_beach_tipos_quadra'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "arena fahel beach", camada Bronze, tabela tipos_quadra.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'tipos_quadra')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_arena_fahel_beach_tipos_quadra  (renome + LGPD Art. 46 + dedup CDC)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   ativo -> ind_ativo
--   criado_em -> dth_criado
--   nome -> des_nome
--   id -> id_tipo_quadra
--   descricao -> des_tipo_quadra

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'tipos_quadra') }}
),

tipado AS (
    SELECT
        ativo                                     AS ind_ativo,
        criado_em                                 AS dth_criado,
        nome                                      AS des_nome,
        id                                        AS id_tipo_quadra,
        descricao                                 AS des_tipo_quadra,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS dt_ingestao_lake,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

SELECT * FROM tipado

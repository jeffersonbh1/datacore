{{ config(
    materialized = 'table'
    , alias = 'bronze_arena_fahel_beach_categorias_bar'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "arena fahel beach", camada Bronze, tabela categorias_bar.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'categorias_bar')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_arena_fahel_beach_categorias_bar  (renome + LGPD Art. 46 + dedup CDC)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   criado_em -> dth_criado
--   nome -> des_nome
--   id -> id_categoria_bar
--   descricao -> des_categoria_bar

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'categorias_bar') }}
),

tipado AS (
    SELECT
        criado_em                                 AS dth_criado,
        nome                                      AS des_nome,
        id                                        AS id_categoria_bar,
        descricao                                 AS des_categoria_bar,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS _dat_carga,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

, deduplicado AS (
    SELECT *
    FROM tipado
    QUALIFY row_number() OVER (
        PARTITION BY id_categoria_bar
        ORDER BY _dat_carga DESC
    ) = 1
)

SELECT * FROM deduplicado

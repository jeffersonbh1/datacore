{{ config(
    materialized = 'table'
    , alias = 'bronze_arena_fahel_beach_categorias_produtos_bar'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "arena fahel beach", camada Bronze, tabela categorias_produtos_bar.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'categorias_produtos_bar')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_arena_fahel_beach_categorias_produtos_bar  (renome + LGPD Art. 46 + dedup CDC)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   atualizado_em -> dth_atualizado
--   criado_em -> dth_criado
--   status_ativo -> des_status_ativo
--   cor -> des_cor
--   nome -> des_nome
--   icone -> des_icone
--   id -> id_categoria_produto_bar
--   descricao -> des_categoria_produto_bar

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'categorias_produtos_bar') }}
),

tipado AS (
    SELECT
        atualizado_em                             AS dth_atualizado,
        criado_em                                 AS dth_criado,
        status_ativo                              AS des_status_ativo,
        cor                                       AS des_cor,
        nome                                      AS des_nome,
        icone                                     AS des_icone,
        id                                        AS id_categoria_produto_bar,
        ind_cadastro_ativo                        AS ind_cadastro_ativo,
        descricao                                 AS des_categoria_produto_bar,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS dt_ingestao_lake,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

, deduplicado AS (
    SELECT *
    FROM tipado
    QUALIFY row_number() OVER (
        PARTITION BY id_categoria_produto_bar
        ORDER BY dt_ingestao_lake DESC
    ) = 1
)

SELECT * FROM deduplicado

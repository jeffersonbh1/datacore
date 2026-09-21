{{ config(
    materialized = 'table'
    , alias = 'bronze_arena_fahel_beach_produtos_bar'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "arena fahel beach", camada Bronze, tabela produtos_bar.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'produtos_bar')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_arena_fahel_beach_produtos_bar  (renome + LGPD Art. 46 + dedup CDC)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   ultimo_preco_compra -> vlr_ultimo_compra
--   ativo -> ind_ativo
--   status_ativo -> des_status_ativo
--   categoria -> tp_produto_bar
--   total_comprado_acumulado -> des_total_comprado_acumulado
--   nome -> des_nome
--   unidade -> des_unidade
--   descricao -> des_produto_bar
--   preco -> vlr_produto_bar
--   estoque -> des_estoque
--   url_imagem -> des_url_imagem
--   atualizado_em -> dth_atualizado
--   criado_em -> dth_criado
--   estoque_minimo -> des_estoque_minimo
--   id -> id_produto_bar
--   preco_custo -> vlr_custo

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'produtos_bar') }}
),

tipado AS (
    SELECT
        ultimo_preco_compra                       AS vlr_ultimo_compra,
        ativo                                     AS ind_ativo,
        status_ativo                              AS des_status_ativo,
        categoria                                 AS tp_produto_bar,
        total_comprado_acumulado                  AS des_total_comprado_acumulado,
        nome                                      AS des_nome,
        unidade                                   AS des_unidade,
        descricao                                 AS des_produto_bar,
        preco                                     AS vlr_produto_bar,
        estoque                                   AS des_estoque,
        url_imagem                                AS des_url_imagem,
        atualizado_em                             AS dth_atualizado,
        criado_em                                 AS dth_criado,
        estoque_minimo                            AS des_estoque_minimo,
        id                                        AS id_produto_bar,
        preco_custo                               AS vlr_custo,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS dt_ingestao_lake,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

, deduplicado AS (
    SELECT *
    FROM tipado
    QUALIFY row_number() OVER (
        PARTITION BY id_produto_bar
        ORDER BY dt_ingestao_lake DESC
    ) = 1
)

SELECT * FROM deduplicado

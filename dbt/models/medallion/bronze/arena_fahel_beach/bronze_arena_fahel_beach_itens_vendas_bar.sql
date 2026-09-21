{{ config(
    materialized = 'table'
    , alias = 'bronze_arena_fahel_beach_itens_vendas_bar'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "arena fahel beach", camada Bronze, tabela itens_vendas_bar.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'itens_vendas_bar')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_arena_fahel_beach_itens_vendas_bar  (renome + LGPD Art. 46 + dedup CDC)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   preco_unitario -> vlr_unitario
--   vendas_id -> id_vendas
--   nome_produto -> des_nome_produto
--   preco_total -> vlr_total
--   id -> id_item_venda_bar
--   produto_id -> id_produto
--   adicionado_em -> dth_adicionado
--   quantidade -> qtd_item_venda_bar

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'itens_vendas_bar') }}
),

tipado AS (
    SELECT
        preco_unitario                            AS vlr_unitario,
        vendas_id                                 AS id_vendas,
        nome_produto                              AS des_nome_produto,
        preco_total                               AS vlr_total,
        id                                        AS id_item_venda_bar,
        produto_id                                AS id_produto,
        adicionado_em                             AS dth_adicionado,
        quantidade                                AS qtd_item_venda_bar,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS dt_ingestao_lake,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

, deduplicado AS (
    SELECT *
    FROM tipado
    QUALIFY row_number() OVER (
        PARTITION BY id_item_venda_bar
        ORDER BY dt_ingestao_lake DESC
    ) = 1
)

SELECT * FROM deduplicado

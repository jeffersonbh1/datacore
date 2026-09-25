{{ config(
    materialized = 'table'
    , alias = 'bronze_arena_fahel_beach_itens_compras_bar'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "arena fahel beach", camada Bronze, tabela itens_compras_bar.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'itens_compras_bar')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_arena_fahel_beach_itens_compras_bar  (renome + LGPD Art. 46)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   criado_em -> dth_criado
--   nome_produto -> des_nome_produto
--   custo_anterior -> des_custo_anterior
--   novo_custo_medio -> des_novo_custo_medio
--   custo_unitario -> des_custo_unitario
--   unidade -> des_unidade
--   id -> id_item_compra_bar
--   produto_id -> id_produto
--   quantidade -> qtd_item_compra_bar
--   compra_id -> id_compra
--   custo_total -> des_custo_total

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'itens_compras_bar') }}
    -- Carga full: a Raw guarda o histórico de todas as cargas; aqui entra só a última bem-sucedida.
    {{ filtro_ultima_carga_ok(source('datacore_raw', 'itens_compras_bar')) }}
),

tipado AS (
    SELECT
        criado_em                                 AS dth_criado,
        nome_produto                              AS des_nome_produto,
        custo_anterior                            AS des_custo_anterior,
        novo_custo_medio                          AS des_novo_custo_medio,
        custo_unitario                            AS des_custo_unitario,
        unidade                                   AS des_unidade,
        id                                        AS id_item_compra_bar,
        produto_id                                AS id_produto,
        quantidade                                AS qtd_item_compra_bar,
        compra_id                                 AS id_compra,
        custo_total                               AS des_custo_total,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS _dat_carga,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

SELECT * FROM tipado

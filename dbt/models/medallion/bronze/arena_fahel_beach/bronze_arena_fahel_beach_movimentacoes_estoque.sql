{{ config(
    materialized = 'table'
    , alias = 'bronze_arena_fahel_beach_movimentacoes_estoque'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "arena fahel beach", camada Bronze, tabela movimentacoes_estoque.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'movimentacoes_estoque')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_arena_fahel_beach_movimentacoes_estoque  (renome + LGPD Art. 46)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   valor_total -> vlr_total
--   nome_usuario -> des_nome_usuario
--   preco_custo_unitario -> vlr_custo_unitario
--   tipo -> tp_movimentacao_estoque
--   motivo -> des_motivo
--   criado_em -> dth_criado
--   nome_produto -> des_nome_produto
--   usuario -> des_usuario
--   id -> id_movimentacao_estoque
--   produto_id -> id_produto
--   quantidade -> qtd_movimentacao_estoque
--   compra_id -> id_compra

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'movimentacoes_estoque') }}
    -- Carga full: a Raw guarda o histórico de todas as cargas; aqui entra só a última bem-sucedida.
    {{ filtro_ultima_carga_ok(source('datacore_raw', 'movimentacoes_estoque')) }}
),

tipado AS (
    SELECT
        valor_total                               AS vlr_total,
        nome_usuario                              AS des_nome_usuario,
        preco_custo_unitario                      AS vlr_custo_unitario,
        tipo                                      AS tp_movimentacao_estoque,
        motivo                                    AS des_motivo,
        criado_em                                 AS dth_criado,
        nome_produto                              AS des_nome_produto,
        usuario                                   AS des_usuario,
        id                                        AS id_movimentacao_estoque,
        produto_id                                AS id_produto,
        quantidade                                AS qtd_movimentacao_estoque,
        compra_id                                 AS id_compra,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS _dat_carga,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

SELECT * FROM tipado

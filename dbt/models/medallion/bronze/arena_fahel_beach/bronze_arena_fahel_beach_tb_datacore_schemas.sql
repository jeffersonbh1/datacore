{{ config(
    materialized = 'table'
    , alias = 'bronze_arena_fahel_beach_tb_datacore_schemas'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "arena fahel beach", camada Bronze, tabela tb_datacore_schemas.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'tb_datacore_schemas')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_arena_fahel_beach_tb_datacore_schemas  (renome + LGPD Art. 46)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   quantidade_produto -> qtd_produto
--   valor_unitario_produto -> vlr_unitario_produto
--   created_at -> dth_criacao
--   nome_cliente -> des_nome_cliente
--   id -> id_tb_datacore_schema

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'tb_datacore_schemas') }}
    -- Carga full: a Raw guarda o histórico de todas as cargas; aqui entra só a última.
    WHERE CAST(JSON_VALUE(_airbyte_meta, '$.sync_id') AS INT64) = (
        SELECT MAX(CAST(JSON_VALUE(_airbyte_meta, '$.sync_id') AS INT64))
        FROM {{ source('datacore_raw', 'tb_datacore_schemas') }}
    )
),

tipado AS (
    SELECT
        cod_produto                               AS cod_produto,
        quantidade_produto                        AS qtd_produto,
        valor_unitario_produto                    AS vlr_unitario_produto,
        created_at                                AS dth_criacao,
        nome_cliente                              AS des_nome_cliente,
        id                                        AS id_tb_datacore_schema,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS _dat_carga,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

SELECT * FROM tipado

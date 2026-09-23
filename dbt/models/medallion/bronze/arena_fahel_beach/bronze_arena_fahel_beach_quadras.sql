{{ config(
    materialized = 'table'
    , alias = 'bronze_arena_fahel_beach_quadras'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "arena fahel beach", camada Bronze, tabela quadras.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'quadras')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_arena_fahel_beach_quadras  (renome + LGPD Art. 46 + dedup CDC)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   tipo -> tp_quadra
--   criado_em -> dth_criado
--   preco_por_hora -> vlr_por_hora
--   nome -> des_nome
--   id -> id_quadra
--   status -> des_status
--   descricao -> des_quadra

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'quadras') }}
),

tipado AS (
    SELECT
        tipo                                      AS tp_quadra,
        criado_em                                 AS dth_criado,
        preco_por_hora                            AS vlr_por_hora,
        nome                                      AS des_nome,
        id                                        AS id_quadra,
        status                                    AS des_status,
        descricao                                 AS des_quadra,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS _dat_carga,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

, deduplicado AS (
    SELECT *
    FROM tipado
    QUALIFY row_number() OVER (
        PARTITION BY id_quadra
        ORDER BY _dat_carga DESC
    ) = 1
)

SELECT * FROM deduplicado

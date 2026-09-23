{{ config(
    materialized = 'table'
    , alias = 'bronze_arena_fahel_beach_tipos_aluguel'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "arena fahel beach", camada Bronze, tabela tipos_aluguel.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'tipos_aluguel')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_arena_fahel_beach_tipos_aluguel  (renome + LGPD Art. 46 + dedup CDC)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   criado_em -> dth_criado
--   nome -> des_nome
--   id -> id_tipo_aluguel
--   is_default -> ind_padrao
--   descricao -> des_tipo_aluguel

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'tipos_aluguel') }}
),

tipado AS (
    SELECT
        criado_em                                 AS dth_criado,
        nome                                      AS des_nome,
        id                                        AS id_tipo_aluguel,
        is_default                                AS ind_padrao,
        descricao                                 AS des_tipo_aluguel,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS _dat_carga,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

, deduplicado AS (
    SELECT *
    FROM tipado
    QUALIFY row_number() OVER (
        PARTITION BY id_tipo_aluguel
        ORDER BY _dat_carga DESC
    ) = 1
)

SELECT * FROM deduplicado

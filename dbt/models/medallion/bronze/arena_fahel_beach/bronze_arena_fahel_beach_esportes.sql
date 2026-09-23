{{ config(
    materialized = 'table'
    , alias = 'bronze_arena_fahel_beach_esportes'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "arena fahel beach", camada Bronze, tabela esportes.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'esportes')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_arena_fahel_beach_esportes  (renome + LGPD Art. 46)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   ativo -> ind_ativo
--   criado_em -> dth_criado
--   nome -> des_nome
--   id -> id_esporte
--   descricao -> des_esporte

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'esportes') }}
),

tipado AS (
    SELECT
        ativo                                     AS ind_ativo,
        criado_em                                 AS dth_criado,
        nome                                      AS des_nome,
        id                                        AS id_esporte,
        descricao                                 AS des_esporte,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS _dat_carga,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

SELECT * FROM tipado

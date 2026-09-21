{{ config(
    materialized = 'table'
    , alias = 'bronze_arena_fahel_beach_perguntas_avaliacao'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "arena fahel beach", camada Bronze, tabela perguntas_avaliacao.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'perguntas_avaliacao')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_arena_fahel_beach_perguntas_avaliacao  (renome + LGPD Art. 46 + dedup CDC)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   ativo -> ind_ativo
--   criado_em -> dth_criado
--   subtitulo -> des_subtitulo
--   esporte -> des_esporte
--   titulo -> des_titulo
--   icone -> des_icone
--   id -> id_pergunta_avaliacao

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'perguntas_avaliacao') }}
),

tipado AS (
    SELECT
        ativo                                     AS ind_ativo,
        criado_em                                 AS dth_criado,
        subtitulo                                 AS des_subtitulo,
        esporte                                   AS des_esporte,
        titulo                                    AS des_titulo,
        icone                                     AS des_icone,
        id                                        AS id_pergunta_avaliacao,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS dt_ingestao_lake,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

, deduplicado AS (
    SELECT *
    FROM tipado
    QUALIFY row_number() OVER (
        PARTITION BY id_pergunta_avaliacao
        ORDER BY dt_ingestao_lake DESC
    ) = 1
)

SELECT * FROM deduplicado

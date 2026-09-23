{{ config(
    materialized = 'table'
    , alias = 'bronze_arena_fahel_beach_aulas'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "arena fahel beach", camada Bronze, tabela aulas.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'aulas')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_arena_fahel_beach_aulas  (renome + LGPD Art. 46 + dedup CDC)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   aluno_id -> id_aluno
--   professor_id -> id_professor
--   created_at -> dth_criacao
--   id -> id_aula
--   agendamento_id -> id_agendamento

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'aulas') }}
),

tipado AS (
    SELECT
        aluno_id                                  AS id_aluno,
        professor_id                              AS id_professor,
        created_at                                AS dth_criacao,
        id                                        AS id_aula,
        agendamento_id                            AS id_agendamento,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS _dat_carga,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

, deduplicado AS (
    SELECT *
    FROM tipado
    QUALIFY row_number() OVER (
        PARTITION BY id_aula
        ORDER BY _dat_carga DESC
    ) = 1
)

SELECT * FROM deduplicado

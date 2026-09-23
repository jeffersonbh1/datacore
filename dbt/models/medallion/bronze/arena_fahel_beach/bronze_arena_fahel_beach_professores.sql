{{ config(
    materialized = 'table'
    , alias = 'bronze_arena_fahel_beach_professores'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "arena fahel beach", camada Bronze, tabela professores.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'professores')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_arena_fahel_beach_professores  (renome + LGPD Art. 46 + dedup CDC)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   observacoes -> des_observacoes
--   telefone -> des_telefone
--   preco_aula -> vlr_aula
--   esporte -> des_esporte
--   created_at -> dth_criacao
--   nome -> des_nome
--   id -> id_professore
--   email -> des_email
--   status -> des_status

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'professores') }}
),

tipado AS (
    SELECT
        observacoes                               AS des_observacoes,
        {{ hash_sha256('telefone') }}             AS des_telefone,
        preco_aula                                AS vlr_aula,
        esporte                                   AS des_esporte,
        created_at                                AS dth_criacao,
        nome                                      AS des_nome,
        id                                        AS id_professore,
        ind_cadastro_ativo                        AS ind_cadastro_ativo,
        {{ tokenizar_email('email') }}            AS des_email,
        status                                    AS des_status,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS _dat_carga,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

, deduplicado AS (
    SELECT *
    FROM tipado
    QUALIFY row_number() OVER (
        PARTITION BY id_professore
        ORDER BY _dat_carga DESC
    ) = 1
)

SELECT * FROM deduplicado

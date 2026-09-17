{{ config(
    materialized = 'table'
    , alias = 'bronze_arena_fahel_beach_torcedores'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "arena fahel beach", camada Bronze, tabela torcedores.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'torcedores')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_arena_fahel_beach_torcedores  (renome + LGPD Art. 46 + dedup CDC)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   telefone -> des_telefone
--   criado_em -> dth_criado
--   time_favorito -> des_time_favorito
--   nome -> des_nome
--   id -> id_torcedore
--   email -> des_email
--   agendamento_id -> id_agendamento

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'torcedores') }}
),

tipado AS (
    SELECT
        {{ hash_sha256('telefone') }}             AS des_telefone,
        criado_em                                 AS dth_criado,
        time_favorito                             AS des_time_favorito,
        nome                                      AS des_nome,
        id                                        AS id_torcedore,
        {{ tokenizar_email('email') }}            AS des_email,
        agendamento_id                            AS id_agendamento,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS dt_ingestao_lake,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

SELECT * FROM tipado

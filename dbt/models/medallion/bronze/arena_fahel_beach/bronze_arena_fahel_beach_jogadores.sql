{{ config(
    materialized = 'table'
    , alias = 'bronze_arena_fahel_beach_jogadores'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "arena fahel beach", camada Bronze, tabela jogadores.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'jogadores')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_arena_fahel_beach_jogadores  (renome + LGPD Art. 46 + dedup CDC)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   telefone -> des_telefone
--   criado_em -> dth_criado
--   posicao -> des_posicao
--   esporte -> des_esporte
--   valor -> vlr_jogadore
--   nome -> des_nome
--   id -> id_jogadore
--   pago -> ind_pago
--   email -> des_email
--   agendamento_id -> id_agendamento

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'jogadores') }}
),

tipado AS (
    SELECT
        {{ hash_sha256('telefone') }}             AS des_telefone,
        criado_em                                 AS dth_criado,
        posicao                                   AS des_posicao,
        esporte                                   AS des_esporte,
        valor                                     AS vlr_jogadore,
        nome                                      AS des_nome,
        id                                        AS id_jogadore,
        pago                                      AS ind_pago,
        {{ tokenizar_email('email') }}            AS des_email,
        agendamento_id                            AS id_agendamento,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS dt_ingestao_lake,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

, deduplicado AS (
    SELECT *
    FROM tipado
    QUALIFY row_number() OVER (
        PARTITION BY id_jogadore
        ORDER BY dt_ingestao_lake DESC
    ) = 1
)

SELECT * FROM deduplicado

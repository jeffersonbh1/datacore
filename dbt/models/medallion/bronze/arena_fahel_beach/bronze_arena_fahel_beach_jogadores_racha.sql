{{ config(
    materialized = 'table'
    , alias = 'bronze_arena_fahel_beach_jogadores_racha'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "arena fahel beach", camada Bronze, tabela jogadores_racha.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'jogadores_racha')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_arena_fahel_beach_jogadores_racha  (renome + LGPD Art. 46)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   telefone -> des_telefone
--   criado_em -> dth_criado
--   valor -> vlr_jogadore_racha
--   nome -> des_nome
--   id -> id_jogadore_racha
--   pago -> ind_pago
--   email -> des_email
--   agendamento_id -> id_agendamento

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'jogadores_racha') }}
    -- Carga full: a Raw guarda o histórico de todas as cargas; aqui entra só a última.
    WHERE CAST(JSON_VALUE(_airbyte_meta, '$.sync_id') AS INT64) = (
        SELECT MAX(CAST(JSON_VALUE(_airbyte_meta, '$.sync_id') AS INT64))
        FROM {{ source('datacore_raw', 'jogadores_racha') }}
    )
),

tipado AS (
    SELECT
        {{ hash_sha256('telefone') }}             AS des_telefone,
        criado_em                                 AS dth_criado,
        valor                                     AS vlr_jogadore_racha,
        nome                                      AS des_nome,
        id                                        AS id_jogadore_racha,
        pago                                      AS ind_pago,
        {{ tokenizar_email('email') }}            AS des_email,
        agendamento_id                            AS id_agendamento,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS _dat_carga,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

SELECT * FROM tipado

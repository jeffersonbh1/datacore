{{ config(
    materialized = 'table'
    , alias = 'silver_arena_fahel_beach_agendamentos'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "arena fahel beach", camada Silver, tabela agendamentos.
-- A regeração sobrescreve este arquivo. As regras de qualidade vêm da tela
-- "Qualidade de Dados" (tabela qualidade_regras): a linha que viola alguma
-- regra vai para a quarentena silver_arena_fahel_beach_agendamentos_rejeitados em vez desta tabela.
-- Origem: ref('bronze_arena_fahel_beach_agendamentos')
-- Saída : <DBT_SCHEMA_SILVER>.silver_arena_fahel_beach_agendamentos
-- Regras ativas (1):
--   r1: dat_agendamento obrigatório

WITH validado AS (
    SELECT
        *,
        ARRAY_CONCAT(
            IF(`dat_agendamento` IS NULL, ['r1: dat_agendamento obrigatório'], [])
        ) AS _motivos_rejeicao
    FROM {{ ref('bronze_arena_fahel_beach_agendamentos') }}
)

SELECT * EXCEPT (_motivos_rejeicao)
FROM validado
WHERE ARRAY_LENGTH(_motivos_rejeicao) = 0

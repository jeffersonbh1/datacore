{{ config(
    materialized = 'incremental'
    , alias = 'silver_arena_fahel_beach_agendamentos_rejeitados'
    , full_refresh = false
    , on_schema_change = 'append_new_columns'
    , partition_by = {'field': '_dat_rejeicao', 'data_type': 'timestamp', 'granularity': 'day'}
    , post_hook = ["DELETE FROM {{ this }} WHERE _dat_rejeicao < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)"]
) }}

-- GERADO por server/dbtCodegen.ts — sistema "arena fahel beach", quarentena da Silver, tabela agendamentos.
-- A regeração sobrescreve este arquivo. Linhas da Bronze que violaram alguma
-- regra de qualidade (tela "Qualidade de Dados"), com os motivos. Guarda
-- 90 dias de histórico.
-- Origem: ref('bronze_arena_fahel_beach_agendamentos')
-- Saída : <DBT_SCHEMA_SILVER>.silver_arena_fahel_beach_agendamentos_rejeitados

WITH validado AS (
    SELECT
        *,
        ARRAY_CONCAT(
            IF(`dat_agendamento` IS NULL, ['r1: dat_agendamento obrigatório'], []),
            IF(`vlr_total` > 300, ['r2: vlr_total acima do máximo 300'], [])
        ) AS _motivos_rejeicao
    FROM {{ ref('bronze_arena_fahel_beach_agendamentos') }}
)

SELECT
    *,
    current_timestamp() AS _dat_rejeicao,
    '{{ invocation_id }}' AS _id_execucao
FROM validado
WHERE ARRAY_LENGTH(_motivos_rejeicao) > 0

{{ config(
    materialized = 'table'
    , alias = 'silver_arena_fahel_beach_avaliacao_jogo'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "arena fahel beach", camada Silver, tabela avaliacao_jogo.
-- A regeração sobrescreve este arquivo. Ponto de partida: passthrough do Bronze
-- já tipado/deduplicado/sanitizado — adicione aqui as regras de curadoria do
-- negócio (joins, métricas, renomes analíticos) conforme necessário.
-- Origem: ref('bronze_arena_fahel_beach_avaliacao_jogo')
-- Saída : <DBT_SCHEMA_SILVER>.silver_arena_fahel_beach_avaliacao_jogo

SELECT * FROM {{ ref('bronze_arena_fahel_beach_avaliacao_jogo') }}

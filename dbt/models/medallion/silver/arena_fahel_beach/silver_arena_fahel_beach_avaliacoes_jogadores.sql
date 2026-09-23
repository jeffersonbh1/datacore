{{ config(
    materialized = 'table'
    , alias = 'silver_arena_fahel_beach_avaliacoes_jogadores'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "arena fahel beach", camada Silver, tabela avaliacoes_jogadores.
-- A regeração sobrescreve este arquivo. Ponto de partida: passthrough do Bronze
-- já tipado/sanitizado — adicione aqui as regras de curadoria do
-- negócio (joins, métricas, renomes analíticos) conforme necessário.
-- Origem: ref('bronze_arena_fahel_beach_avaliacoes_jogadores')
-- Saída : <DBT_SCHEMA_SILVER>.silver_arena_fahel_beach_avaliacoes_jogadores

SELECT * FROM {{ ref('bronze_arena_fahel_beach_avaliacoes_jogadores') }}

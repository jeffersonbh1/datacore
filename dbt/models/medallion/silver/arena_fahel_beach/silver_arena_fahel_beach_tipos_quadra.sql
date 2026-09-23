{{ config(
    materialized = 'table'
    , alias = 'silver_arena_fahel_beach_tipos_quadra'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "arena fahel beach", camada Silver, tabela tipos_quadra.
-- A regeração sobrescreve este arquivo. Ponto de partida: passthrough do Bronze
-- já tipado/sanitizado — adicione aqui as regras de curadoria do
-- negócio (joins, métricas, renomes analíticos) conforme necessário.
-- Origem: ref('bronze_arena_fahel_beach_tipos_quadra')
-- Saída : <DBT_SCHEMA_SILVER>.silver_arena_fahel_beach_tipos_quadra

SELECT * FROM {{ ref('bronze_arena_fahel_beach_tipos_quadra') }}

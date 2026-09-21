{{ config(
    materialized = 'table'
    , alias = 'bronze_arena_fahel_beach_avaliacoes_jogadores'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "arena fahel beach", camada Bronze, tabela avaliacoes_jogadores.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'avaliacoes_jogadores')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_arena_fahel_beach_avaliacoes_jogadores  (renome + LGPD Art. 46 + dedup CDC)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   criado_em -> dth_criado
--   jogador_avaliado_nome -> des_jogador_avaliado_nome
--   id -> id_avaliacao_jogadore
--   nota -> des_nota
--   agendamento_id -> id_agendamento
--   avaliador_nome -> des_avaliador_nome

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'avaliacoes_jogadores') }}
),

tipado AS (
    SELECT
        criado_em                                 AS dth_criado,
        jogador_avaliado_nome                     AS des_jogador_avaliado_nome,
        id                                        AS id_avaliacao_jogadore,
        nota                                      AS des_nota,
        agendamento_id                            AS id_agendamento,
        avaliador_nome                            AS des_avaliador_nome,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS dt_ingestao_lake,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

, deduplicado AS (
    SELECT *
    FROM tipado
    QUALIFY row_number() OVER (
        PARTITION BY id_avaliacao_jogadore
        ORDER BY dt_ingestao_lake DESC
    ) = 1
)

SELECT * FROM deduplicado

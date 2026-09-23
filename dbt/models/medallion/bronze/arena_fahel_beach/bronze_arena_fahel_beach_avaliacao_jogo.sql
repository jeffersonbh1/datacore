{{ config(
    materialized = 'table'
    , alias = 'bronze_arena_fahel_beach_avaliacao_jogo'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "arena fahel beach", camada Bronze, tabela avaliacao_jogo.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'avaliacao_jogo')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_arena_fahel_beach_avaliacao_jogo  (renome + LGPD Art. 46)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   jogador_id -> id_jogador
--   observacao -> des_avaliacao_jogo
--   tipo_voter -> tp_voter
--   pergunta_id -> id_pergunta
--   criado_em -> dth_criado
--   jogador_avaliado_nome -> des_jogador_avaliado_nome
--   id -> id_avaliacao_jogo
--   nota -> des_nota
--   torcedor_id -> id_torcedor
--   agendamento_id -> id_agendamento
--   avaliador_nome -> des_avaliador_nome

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'avaliacao_jogo') }}
),

tipado AS (
    SELECT
        jogador_id                                AS id_jogador,
        observacao                                AS des_avaliacao_jogo,
        tipo_voter                                AS tp_voter,
        pergunta_id                               AS id_pergunta,
        criado_em                                 AS dth_criado,
        jogador_avaliado_nome                     AS des_jogador_avaliado_nome,
        id                                        AS id_avaliacao_jogo,
        nota                                      AS des_nota,
        torcedor_id                               AS id_torcedor,
        agendamento_id                            AS id_agendamento,
        avaliador_nome                            AS des_avaliador_nome,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS _dat_carga,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

SELECT * FROM tipado

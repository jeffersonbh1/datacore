{{ config(
    materialized = 'table'
    , alias = 'bronze_arena_fahel_beach_alunos'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "arena fahel beach", camada Bronze, tabela alunos.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'alunos')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_arena_fahel_beach_alunos  (renome + LGPD Art. 46)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   observacoes -> des_observacoes
--   telefone -> des_telefone
--   professor_id -> id_professor
--   esporte -> des_esporte
--   mensalidade -> des_mensalidade
--   created_at -> dth_criacao
--   nome -> des_nome
--   id -> id_aluno
--   nivel -> des_nivel
--   status -> des_status

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'alunos') }}
    -- Carga full: a Raw guarda o histórico de todas as cargas; aqui entra só a última.
    WHERE CAST(JSON_VALUE(_airbyte_meta, '$.sync_id') AS INT64) = (
        SELECT MAX(CAST(JSON_VALUE(_airbyte_meta, '$.sync_id') AS INT64))
        FROM {{ source('datacore_raw', 'alunos') }}
    )
),

tipado AS (
    SELECT
        observacoes                               AS des_observacoes,
        {{ hash_sha256('telefone') }}             AS des_telefone,
        professor_id                              AS id_professor,
        esporte                                   AS des_esporte,
        mensalidade                               AS des_mensalidade,
        created_at                                AS dth_criacao,
        nome                                      AS des_nome,
        id                                        AS id_aluno,
        nivel                                     AS des_nivel,
        ind_cadastro_ativo                        AS ind_cadastro_ativo,
        status                                    AS des_status,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS _dat_carga,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

SELECT * FROM tipado

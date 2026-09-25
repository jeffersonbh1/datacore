{{ config(
    materialized = 'table'
    , alias = 'bronze_arena_fahel_beach_usuarios'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "arena fahel beach", camada Bronze, tabela usuarios.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'usuarios')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_arena_fahel_beach_usuarios  (renome + LGPD Art. 46)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   senha -> des_senha
--   telefone -> des_telefone
--   criado_em -> dth_criado
--   nome -> des_nome
--   id -> id_usuario
--   login -> des_login
--   email -> des_email
--   perfil -> des_perfil

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'usuarios') }}
    -- Carga full: a Raw guarda o histórico de todas as cargas; aqui entra só a última bem-sucedida.
    {{ filtro_ultima_carga_ok(source('datacore_raw', 'usuarios')) }}
),

tipado AS (
    SELECT
        {{ hash_sha256('senha') }}                AS des_senha,
        {{ hash_sha256('telefone') }}             AS des_telefone,
        criado_em                                 AS dth_criado,
        nome                                      AS des_nome,
        id                                        AS id_usuario,
        login                                     AS des_login,
        {{ tokenizar_email('email') }}            AS des_email,
        perfil                                    AS des_perfil,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS _dat_carga,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

SELECT * FROM tipado

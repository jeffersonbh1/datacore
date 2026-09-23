{{ config(
    materialized = 'incremental'
    , alias = 'bronze_salesforce_usuarios'
    , unique_key = 'id_usuario'
    , incremental_strategy = 'merge'
    , on_schema_change = 'sync_all_columns'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "salesforce", camada Bronze, tabela usuarios.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'usuarios')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_salesforce_usuarios  (renome + LGPD Art. 46 + dedup CDC)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   senha_hash -> des_senha_hash
--   pode_visualizar_pii_bruto -> ind_visualizar_pii_bruto
--   dt_alteracao -> dat_alteracao
--   ultimo_acesso_em -> dth_ultimo_acesso
--   nome -> des_nome
--   auth_user_id -> id_auth_usuario
--   mfa_habilitado -> des_mfa_habilitado
--   dt_criacao -> dat_criacao
--   departamento -> des_departamento
--   avatar_iniciais -> des_avatar_iniciais
--   id -> id_usuario
--   email -> des_email
--   papel -> des_papel

-- Marca d'água: maior _dat_carga já gravada nesta tabela (none na 1ª carga).
{% set v_max_dat_carga = max_dat_carga() if is_incremental() else none %}

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'usuarios') }}
    {% if v_max_dat_carga is not none %}
    WHERE _airbyte_extracted_at > TIMESTAMP('{{ v_max_dat_carga }}')
    {% endif %}
),

tipado AS (
    SELECT
        {{ hash_sha256('senha_hash') }}           AS des_senha_hash,
        pode_visualizar_pii_bruto                 AS ind_visualizar_pii_bruto,
        dt_alteracao                              AS dat_alteracao,
        ultimo_acesso_em                          AS dth_ultimo_acesso,
        nome                                      AS des_nome,
        auth_user_id                              AS id_auth_usuario,
        mfa_habilitado                            AS des_mfa_habilitado,
        dt_criacao                                AS dat_criacao,
        departamento                              AS des_departamento,
        id_empresa                                AS id_empresa,
        avatar_iniciais                           AS des_avatar_iniciais,
        id                                        AS id_usuario,
        ind_cadastro_ativo                        AS ind_cadastro_ativo,
        {{ tokenizar_email('email') }}            AS des_email,
        papel                                     AS des_papel,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS _dat_carga,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

, deduplicado AS (
    SELECT *
    FROM tipado
    QUALIFY row_number() OVER (
        PARTITION BY id_usuario
        ORDER BY _dat_carga DESC
    ) = 1
)

SELECT * FROM deduplicado

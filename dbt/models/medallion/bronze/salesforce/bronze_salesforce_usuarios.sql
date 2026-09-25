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
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_salesforce_usuarios  (renome + LGPD Art. 46)
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

-- Carga incremental: busca a maior _dat_carga já gravada nesta tabela (macro
-- max_dat_carga) para ler da Raw só os registros novos.
{% set v_max_dat_carga = none %}
{% if is_incremental() %}
    {% set v_max_dat_carga = max_dat_carga() %}
{% endif %}
{{ avisar_chave_nula(source('datacore_raw', 'usuarios'), ['id'], v_max_dat_carga) }}

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'usuarios') }}
    WHERE id IS NOT NULL
    {% if v_max_dat_carga is not none %}
      AND _airbyte_extracted_at > TIMESTAMP('{{ v_max_dat_carga }}')
    {% endif %}
    -- A Raw empilha as versões: fica só a mais recente de cada chave do lote.
    QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY _airbyte_extracted_at DESC, dt_alteracao DESC) = 1
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

SELECT * FROM tipado

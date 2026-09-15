{{ config(
    materialized = 'incremental'
    , alias = 'bronze_salesforce_usuarios'
    , unique_key = 'id_usuario'
    , incremental_strategy = 'merge'
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

with fonte as (
    select * from {{ source('datacore_raw', 'usuarios') }}
    {% if is_incremental() %}
    where _airbyte_extracted_at > (select max(dt_ingestao_lake) from {{ this }})
    {% endif %}
),

tipado as (
    select
        {{ hash_sha256('senha_hash') }} as des_senha_hash,
        pode_visualizar_pii_bruto as ind_visualizar_pii_bruto,
        dt_alteracao as dat_alteracao,
        ultimo_acesso_em as dth_ultimo_acesso,
        nome as des_nome,
        auth_user_id as id_auth_usuario,
        mfa_habilitado as des_mfa_habilitado,
        dt_criacao as dat_criacao,
        departamento as des_departamento,
        id_empresa as id_empresa,
        avatar_iniciais as des_avatar_iniciais,
        id as id_usuario,
        ind_cadastro_ativo as ind_cadastro_ativo,
        {{ tokenizar_email('email') }} as des_email,
        papel as des_papel,
        cast(_airbyte_extracted_at as timestamp) as dt_ingestao_lake,
        current_timestamp() as _dbt_loaded_at
    from fonte
)

, deduplicado as (
    select *
    from tipado
    qualify row_number() over (
        partition by id_usuario
        order by dt_ingestao_lake desc
    ) = 1
)

select * from deduplicado

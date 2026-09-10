{{ config(
    materialized = 'table'
    , alias = 'bronze_datacore_usuarios'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "DataCore", camada Bronze, tabela usuarios.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'usuarios')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_datacore_usuarios  (renome + LGPD Art. 46 + dedup CDC)

with fonte as (
    select * from {{ source('datacore_raw', 'usuarios') }}
),

tipado as (
    select
        {{ hash_sha256('senha_hash') }} as senha_hash,
        pode_visualizar_pii_bruto,
        dt_alteracao,
        ultimo_acesso_em,
        nome,
        mfa_habilitado,
        dt_criacao,
        departamento,
        id_empresa,
        avatar_iniciais,
        id,
        ind_cadastro_ativo,
        {{ tokenizar_email('email') }} as email,
        papel,
        cast(_airbyte_extracted_at as timestamp) as dt_ingestao_lake,
        current_timestamp() as _dbt_loaded_at
    from fonte
)

select * from tipado

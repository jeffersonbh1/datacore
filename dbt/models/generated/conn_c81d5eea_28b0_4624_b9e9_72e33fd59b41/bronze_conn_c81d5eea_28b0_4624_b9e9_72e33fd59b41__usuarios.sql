{{ config(
    materialized = 'table'
    , alias = 'bronze_usuarios'
    , enabled = env_var('DBT_ACTIVE_SLUG', 'conn_c81d5eea_28b0_4624_b9e9_72e33fd59b41') == 'conn_c81d5eea_28b0_4624_b9e9_72e33fd59b41'
    , tags = ['generated', 'conn_c81d5eea_28b0_4624_b9e9_72e33fd59b41', 'bronze']
    , partition_by = {'field': 'dt_ingestao_lake', 'data_type': 'timestamp', 'granularity': 'day'}
) }}

-- GERADO por server/dbtCodegen.ts — integração conn_c81d5eea_28b0_4624_b9e9_72e33fd59b41, tabela usuarios.
-- Camada Bronze: renome/tipagem leve + LGPD (Art. 46) + deduplicação CDC.
-- Editar aqui é permitido; a regeração sobrescreve o diretório inteiro.

with raw_source as (
    select * from {{ ref('stg_conn_c81d5eea_28b0_4624_b9e9_72e33fd59b41__usuarios') }}
),

sanitizado as (
    select
        senha_hash,
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
        dt_ingestao_lake,
        current_timestamp() as _dbt_loaded_at
    from raw_source
)

select * from sanitizado

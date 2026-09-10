{{ config(
    materialized = 'table'
    , alias = 'bronze_usuarios'
    , enabled = env_var('DBT_ACTIVE_SLUG', 'conn_a21e3763_753f_4f96_82a5_d0d7fb3e74b7') == 'conn_a21e3763_753f_4f96_82a5_d0d7fb3e74b7'
    , tags = ['generated', 'conn_a21e3763_753f_4f96_82a5_d0d7fb3e74b7', 'bronze']
    , partition_by = {'field': 'dt_ingestao_lake', 'data_type': 'timestamp', 'granularity': 'day'}
) }}

-- GERADO por server/dbtCodegen.ts — integração conn_a21e3763_753f_4f96_82a5_d0d7fb3e74b7, tabela usuarios.
-- Camada Bronze: renome/tipagem leve + LGPD (Art. 46) + deduplicação CDC.
-- Editar aqui é permitido; a regeração sobrescreve o diretório inteiro.

with raw_source as (
    select * from {{ ref('stg_conn_a21e3763_753f_4f96_82a5_d0d7fb3e74b7__usuarios') }}
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

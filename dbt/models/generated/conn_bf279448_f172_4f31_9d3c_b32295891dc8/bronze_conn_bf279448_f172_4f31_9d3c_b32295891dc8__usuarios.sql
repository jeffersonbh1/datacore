{{ config(
    materialized = 'incremental'
    , alias = 'bronze_usuarios'
    , enabled = env_var('DBT_ACTIVE_SLUG', 'conn_bf279448_f172_4f31_9d3c_b32295891dc8') == 'conn_bf279448_f172_4f31_9d3c_b32295891dc8'
    , tags = ['generated', 'conn_bf279448_f172_4f31_9d3c_b32295891dc8', 'bronze']
    , partition_by = {'field': 'dt_ingestao_lake', 'data_type': 'timestamp', 'granularity': 'day'}
    , unique_key = 'id'
    , incremental_strategy = 'merge'
) }}

-- GERADO por server/dbtCodegen.ts — integração conn_bf279448_f172_4f31_9d3c_b32295891dc8, tabela usuarios.
-- Camada Bronze: renome/tipagem leve + LGPD (Art. 46) + deduplicação CDC.
-- Editar aqui é permitido; a regeração sobrescreve o diretório inteiro.

with raw_source as (
    select * from {{ ref('stg_conn_bf279448_f172_4f31_9d3c_b32295891dc8__usuarios') }}
    {% if is_incremental() %}
    where dt_ingestao_lake > (select max(dt_ingestao_lake) from {{ this }})
    {% endif %}
),

sanitizado as (
    select
        senha_hash,
        pode_visualizar_pii_bruto,
        dt_alteracao,
        ultimo_acesso_em,
        nome,
        auth_user_id,
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

, deduplicado as (
    select *
    from sanitizado
    qualify row_number() over (
        partition by id
        order by dt_ingestao_lake desc
    ) = 1
)

select * from deduplicado

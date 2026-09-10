{{ config(
    materialized = 'ephemeral',
    enabled = env_var('DBT_ACTIVE_SLUG', 'conn_3895e0e8_7f91_4b6f_99d1_c7a4f75a8f84') == 'conn_3895e0e8_7f91_4b6f_99d1_c7a4f75a8f84',
    tags = ['generated', 'conn_3895e0e8_7f91_4b6f_99d1_c7a4f75a8f84', 'staging'],
) }}

-- GERADO por server/dbtCodegen.ts — integração conn_3895e0e8_7f91_4b6f_99d1_c7a4f75a8f84, tabela usuarios.
-- Ephemeral: compilado como CTE dentro do bronze_ correspondente (sem objeto no BQ).
-- enabled: só participa do parse quando DBT_ACTIVE_SLUG é esta integração (ou
-- não está setado). Evita colisão de alias quando integrações compartilham o
-- mesmo bronze dataset.
with fonte as (
    select * from {{ source('conn_3895e0e8_7f91_4b6f_99d1_c7a4f75a8f84', 'usuarios') }}
),

renomeado as (
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
        email,
        papel,
        cast(_airbyte_extracted_at as timestamp) as dt_ingestao_lake,
        _airbyte_raw_id as _raw_id
    from fonte
)

select * from renomeado

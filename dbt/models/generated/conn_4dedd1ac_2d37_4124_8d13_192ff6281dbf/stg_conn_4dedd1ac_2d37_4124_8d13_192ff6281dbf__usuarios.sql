{{ config(
    materialized = 'ephemeral',
    enabled = env_var('DBT_ACTIVE_SLUG', 'conn_4dedd1ac_2d37_4124_8d13_192ff6281dbf') == 'conn_4dedd1ac_2d37_4124_8d13_192ff6281dbf',
    tags = ['generated', 'conn_4dedd1ac_2d37_4124_8d13_192ff6281dbf', 'staging'],
) }}

-- GERADO por server/dbtCodegen.ts — integração conn_4dedd1ac_2d37_4124_8d13_192ff6281dbf, tabela usuarios.
-- Ephemeral: compilado como CTE dentro do bronze_ correspondente (sem objeto no BQ).
-- enabled: só participa do parse quando DBT_ACTIVE_SLUG é esta integração (ou
-- não está setado). Evita colisão de alias quando integrações compartilham o
-- mesmo bronze dataset.
with fonte as (
    select * from {{ source('conn_4dedd1ac_2d37_4124_8d13_192ff6281dbf', 'usuarios') }}
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

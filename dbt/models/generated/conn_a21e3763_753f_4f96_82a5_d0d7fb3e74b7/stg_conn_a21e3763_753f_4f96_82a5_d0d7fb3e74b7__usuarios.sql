{{ config(
    materialized = 'ephemeral',
    enabled = env_var('DBT_ACTIVE_SLUG', 'conn_a21e3763_753f_4f96_82a5_d0d7fb3e74b7') == 'conn_a21e3763_753f_4f96_82a5_d0d7fb3e74b7',
    tags = ['generated', 'conn_a21e3763_753f_4f96_82a5_d0d7fb3e74b7', 'staging'],
) }}

-- GERADO por server/dbtCodegen.ts — integração conn_a21e3763_753f_4f96_82a5_d0d7fb3e74b7, tabela usuarios.
-- Ephemeral: compilado como CTE dentro do bronze_ correspondente (sem objeto no BQ).
-- enabled: só participa do parse quando DBT_ACTIVE_SLUG é esta integração (ou
-- não está setado). Evita colisão de alias quando integrações compartilham o
-- mesmo bronze dataset.
with fonte as (
    select * from {{ source('conn_a21e3763_753f_4f96_82a5_d0d7fb3e74b7', 'usuarios') }}
),

renomeado as (
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
        email,
        papel,
        cast(_airbyte_extracted_at as timestamp) as dt_ingestao_lake,
        _airbyte_raw_id as _raw_id
    from fonte
)

select * from renomeado

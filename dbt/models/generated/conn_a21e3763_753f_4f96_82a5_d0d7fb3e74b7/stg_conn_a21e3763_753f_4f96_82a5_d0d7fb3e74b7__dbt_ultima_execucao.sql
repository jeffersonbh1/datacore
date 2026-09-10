{{ config(
    materialized = 'ephemeral',
    enabled = env_var('DBT_ACTIVE_SLUG', 'conn_a21e3763_753f_4f96_82a5_d0d7fb3e74b7') == 'conn_a21e3763_753f_4f96_82a5_d0d7fb3e74b7',
    tags = ['generated', 'conn_a21e3763_753f_4f96_82a5_d0d7fb3e74b7', 'staging'],
) }}

-- GERADO por server/dbtCodegen.ts — integração conn_a21e3763_753f_4f96_82a5_d0d7fb3e74b7, tabela dbt_ultima_execucao.
-- Ephemeral: compilado como CTE dentro do bronze_ correspondente (sem objeto no BQ).
-- enabled: só participa do parse quando DBT_ACTIVE_SLUG é esta integração (ou
-- não está setado). Evita colisão de alias quando integrações compartilham o
-- mesmo bronze dataset.
with fonte as (
    select * from {{ source('conn_a21e3763_753f_4f96_82a5_d0d7fb3e74b7', 'dbt_ultima_execucao') }}
),

renomeado as (
    select
        modelo_id,
        execucao_id,
        finalizado_em,
        disparado_por,
        sucesso,
        iniciado_em,
        status,
        cast(_airbyte_extracted_at as timestamp) as dt_ingestao_lake,
        _airbyte_raw_id as _raw_id
    from fonte
)

select * from renomeado

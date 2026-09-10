{{ config(
    materialized = 'ephemeral',
    enabled = env_var('DBT_ACTIVE_SLUG', 'conn_bf279448_f172_4f31_9d3c_b32295891dc8') == 'conn_bf279448_f172_4f31_9d3c_b32295891dc8',
    tags = ['generated', 'conn_bf279448_f172_4f31_9d3c_b32295891dc8', 'staging'],
) }}

-- GERADO por server/dbtCodegen.ts — integração conn_bf279448_f172_4f31_9d3c_b32295891dc8, tabela dbt_modelos.
-- Ephemeral: compilado como CTE dentro do bronze_ correspondente (sem objeto no BQ).
-- enabled: só participa do parse quando DBT_ACTIVE_SLUG é esta integração (ou
-- não está setado). Evita colisão de alias quando integrações compartilham o
-- mesmo bronze dataset.
with fonte as (
    select * from {{ source('conn_bf279448_f172_4f31_9d3c_b32295891dc8', 'dbt_modelos') }}
),

renomeado as (
    select
        atualizado_em,
        criado_em,
        tabela_origem,
        camada,
        nome,
        id,
        cast(_airbyte_extracted_at as timestamp) as dt_ingestao_lake,
        _airbyte_raw_id as _raw_id
    from fonte
)

select * from renomeado

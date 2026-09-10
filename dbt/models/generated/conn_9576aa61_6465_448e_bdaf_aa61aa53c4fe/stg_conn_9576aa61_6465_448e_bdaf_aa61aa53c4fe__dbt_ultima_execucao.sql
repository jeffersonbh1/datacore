{{ config(
    materialized = 'ephemeral',
    enabled = env_var('DBT_ACTIVE_SLUG', 'conn_9576aa61_6465_448e_bdaf_aa61aa53c4fe') == 'conn_9576aa61_6465_448e_bdaf_aa61aa53c4fe',
    tags = ['generated', 'conn_9576aa61_6465_448e_bdaf_aa61aa53c4fe', 'staging'],
) }}

-- GERADO por server/dbtCodegen.ts — integração conn_9576aa61_6465_448e_bdaf_aa61aa53c4fe, tabela dbt_ultima_execucao.
-- Ephemeral: compilado como CTE dentro do bronze_ correspondente (sem objeto no BQ).
-- enabled: só participa do parse quando DBT_ACTIVE_SLUG é esta integração (ou
-- não está setado). Evita colisão de alias quando integrações compartilham o
-- mesmo bronze dataset.
with fonte as (
    select * from {{ source('conn_9576aa61_6465_448e_bdaf_aa61aa53c4fe', 'dbt_ultima_execucao') }}
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

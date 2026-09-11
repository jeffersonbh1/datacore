{{ config(
    materialized = 'table'
    , alias = 'bronze_salesforce_empresas'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "salesforce", camada Bronze, tabela empresas.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'empresas')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_salesforce_empresas  (renome + LGPD Art. 46 + dedup CDC)

with fonte as (
    select * from {{ source('datacore_raw', 'empresas') }}
),

tipado as (
    select
        atualizado_em,
        criado_em,
        airbyte_workspace_id,
        nome,
        plano,
        id,
        slug,
        status,
        cast(_airbyte_extracted_at as timestamp) as dt_ingestao_lake,
        current_timestamp() as _dbt_loaded_at
    from fonte
)

, deduplicado as (
    select *
    from tipado
    qualify row_number() over (
        partition by id
        order by dt_ingestao_lake desc
    ) = 1
)

select * from deduplicado

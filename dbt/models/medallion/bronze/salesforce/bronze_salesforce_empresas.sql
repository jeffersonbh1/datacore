{{ config(
    materialized = 'table'
    , alias = 'bronze_salesforce_empresas'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "salesforce", camada Bronze, tabela empresas.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'empresas')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_salesforce_empresas  (renome + LGPD Art. 46 + dedup CDC)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   atualizado_em -> dth_atualizado
--   criado_em -> dth_criado
--   airbyte_workspace_id -> id_airbyte_workspace
--   nome -> des_nome
--   plano -> des_plano
--   id -> id_empresa
--   slug -> des_slug
--   status -> des_status

with fonte as (
    select * from {{ source('datacore_raw', 'empresas') }}
),

tipado as (
    select
        atualizado_em as dth_atualizado,
        criado_em as dth_criado,
        airbyte_workspace_id as id_airbyte_workspace,
        nome as des_nome,
        plano as des_plano,
        id as id_empresa,
        slug as des_slug,
        status as des_status,
        cast(_airbyte_extracted_at as timestamp) as dt_ingestao_lake,
        current_timestamp() as _dbt_loaded_at
    from fonte
)

, deduplicado as (
    select *
    from tipado
    qualify row_number() over (
        partition by id_empresa
        order by dt_ingestao_lake desc
    ) = 1
)

select * from deduplicado

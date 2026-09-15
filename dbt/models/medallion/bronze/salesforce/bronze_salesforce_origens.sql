{{ config(
    materialized = 'table'
    , alias = 'bronze_salesforce_origens'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "salesforce", camada Bronze, tabela origens.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'origens')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_salesforce_origens  (renome + LGPD Art. 46 + dedup CDC)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   tipo -> tp_origem
--   criado_em -> dth_criado
--   configuracao -> des_configuracao
--   airbyte_source_id -> id_airbyte_origem
--   nome -> des_nome
--   id -> id_origem
--   status -> des_status

with fonte as (
    select * from {{ source('datacore_raw', 'origens') }}
),

tipado as (
    select
        tipo as tp_origem,
        criado_em as dth_criado,
        configuracao as des_configuracao,
        airbyte_source_id as id_airbyte_origem,
        nome as des_nome,
        id_empresa as id_empresa,
        id as id_origem,
        status as des_status,
        cast(_airbyte_extracted_at as timestamp) as dt_ingestao_lake,
        current_timestamp() as _dbt_loaded_at
    from fonte
)

, deduplicado as (
    select *
    from tipado
    qualify row_number() over (
        partition by id_origem
        order by dt_ingestao_lake desc
    ) = 1
)

select * from deduplicado

{{ config(
    materialized = 'table'
    , alias = 'bronze_salesforce_dbt_modelos'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "salesforce", camada Bronze, tabela dbt_modelos.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'dbt_modelos')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_salesforce_dbt_modelos  (renome + LGPD Art. 46 + dedup CDC)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   atualizado_em -> dth_atualizado
--   criado_em -> dth_criado
--   tabela_origem -> des_tabela_origem
--   camada -> des_camada
--   nome -> des_nome
--   id -> id_dbt_modelo

with fonte as (
    select * from {{ source('datacore_raw', 'dbt_modelos') }}
),

tipado as (
    select
        atualizado_em as dth_atualizado,
        criado_em as dth_criado,
        tabela_origem as des_tabela_origem,
        camada as des_camada,
        nome as des_nome,
        id as id_dbt_modelo,
        cast(_airbyte_extracted_at as timestamp) as dt_ingestao_lake,
        current_timestamp() as _dbt_loaded_at
    from fonte
)

, deduplicado as (
    select *
    from tipado
    qualify row_number() over (
        partition by id_dbt_modelo
        order by dt_ingestao_lake desc
    ) = 1
)

select * from deduplicado

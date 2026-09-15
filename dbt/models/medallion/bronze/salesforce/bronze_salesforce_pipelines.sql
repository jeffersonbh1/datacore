{{ config(
    materialized = 'table'
    , alias = 'bronze_salesforce_pipelines'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "salesforce", camada Bronze, tabela pipelines.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'pipelines')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_salesforce_pipelines  (renome + LGPD Art. 46 + dedup CDC)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   atualizado_em -> dth_atualizado
--   criado_em -> dth_criado
--   criado_por -> des_criado_por
--   categoria -> tp_pipeline
--   camadas -> des_camadas
--   nome -> des_nome
--   integracao_id -> id_integracao
--   id -> id_pipeline
--   layout_overrides -> des_layout_overrides

with fonte as (
    select * from {{ source('datacore_raw', 'pipelines') }}
),

tipado as (
    select
        atualizado_em as dth_atualizado,
        criado_em as dth_criado,
        criado_por as des_criado_por,
        categoria as tp_pipeline,
        camadas as des_camadas,
        nome as des_nome,
        id_empresa as id_empresa,
        integracao_id as id_integracao,
        id as id_pipeline,
        layout_overrides as des_layout_overrides,
        cast(_airbyte_extracted_at as timestamp) as dt_ingestao_lake,
        current_timestamp() as _dbt_loaded_at
    from fonte
)

, deduplicado as (
    select *
    from tipado
    qualify row_number() over (
        partition by id_pipeline
        order by dt_ingestao_lake desc
    ) = 1
)

select * from deduplicado

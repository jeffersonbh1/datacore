{{ config(
    materialized = 'table'
    , alias = 'bronze_dbt_ultima_execucao'
) }}

-- GERADO por server/dbtCodegen.ts — camada Bronze, tabela dbt_ultima_execucao.
-- Um arquivo por tabela; a regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'dbt_ultima_execucao')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_dbt_ultima_execucao  (renome + LGPD Art. 46 + dedup CDC)

with fonte as (
    select * from {{ source('datacore_raw', 'dbt_ultima_execucao') }}
),

tipado as (
    select
        modelo_id,
        execucao_id,
        finalizado_em,
        disparado_por,
        sucesso,
        iniciado_em,
        status,
        cast(_airbyte_extracted_at as timestamp) as dt_ingestao_lake,
        current_timestamp() as _dbt_loaded_at
    from fonte
)

select * from tipado

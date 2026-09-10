{{ config(
    materialized = 'table'
    , alias = 'bronze_datacore_tabelas_carregadas'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "DataCore", camada Bronze, tabela tabelas_carregadas.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'tabelas_carregadas')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_datacore_tabelas_carregadas  (renome + LGPD Art. 46 + dedup CDC)

with fonte as (
    select * from {{ source('datacore_raw', 'tabelas_carregadas') }}
),

tipado as (
    select
        atualizado_em,
        connection_id,
        nome_tabela,
        namespace,
        integracao_nome,
        id,
        coluna_atualizacao,
        registrado_em,
        tipo_carga,
        cast(_airbyte_extracted_at as timestamp) as dt_ingestao_lake,
        current_timestamp() as _dbt_loaded_at
    from fonte
)

select * from tipado

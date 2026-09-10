{{ config(
    materialized = 'table'
    , alias = 'bronze_tabelas_carregadas'
) }}

-- GERADO por server/dbtCodegen.ts — camada Bronze, tabela tabelas_carregadas.
-- Um arquivo por tabela; a regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'tabelas_carregadas')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_tabelas_carregadas  (renome + LGPD Art. 46 + dedup CDC)

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

, deduplicado as (
    select *
    from tipado
    qualify row_number() over (
        partition by id
        order by dt_ingestao_lake desc
    ) = 1
)

select * from deduplicado

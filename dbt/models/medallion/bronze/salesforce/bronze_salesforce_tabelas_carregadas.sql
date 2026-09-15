{{ config(
    materialized = 'table'
    , alias = 'bronze_salesforce_tabelas_carregadas'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "salesforce", camada Bronze, tabela tabelas_carregadas.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'tabelas_carregadas')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_salesforce_tabelas_carregadas  (renome + LGPD Art. 46 + dedup CDC)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   atualizado_em -> dth_atualizado
--   connection_id -> id_connection
--   nome_tabela -> des_nome_tabela
--   namespace -> des_namespace
--   integracao_nome -> des_integracao_nome
--   id -> id_tabela_carregada
--   coluna_atualizacao -> des_coluna_atualizacao
--   registrado_em -> dth_registrado
--   tipo_carga -> tp_carga

with fonte as (
    select * from {{ source('datacore_raw', 'tabelas_carregadas') }}
),

tipado as (
    select
        atualizado_em as dth_atualizado,
        connection_id as id_connection,
        nome_tabela as des_nome_tabela,
        namespace as des_namespace,
        integracao_nome as des_integracao_nome,
        id as id_tabela_carregada,
        coluna_atualizacao as des_coluna_atualizacao,
        registrado_em as dth_registrado,
        tipo_carga as tp_carga,
        cast(_airbyte_extracted_at as timestamp) as dt_ingestao_lake,
        current_timestamp() as _dbt_loaded_at
    from fonte
)

, deduplicado as (
    select *
    from tipado
    qualify row_number() over (
        partition by id_tabela_carregada
        order by dt_ingestao_lake desc
    ) = 1
)

select * from deduplicado

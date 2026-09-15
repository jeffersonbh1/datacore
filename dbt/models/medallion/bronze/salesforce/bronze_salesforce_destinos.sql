{{ config(
    materialized = 'table'
    , alias = 'bronze_salesforce_destinos'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "salesforce", camada Bronze, tabela destinos.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'destinos')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_salesforce_destinos  (renome + LGPD Art. 46 + dedup CDC)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   tipo -> tp_destino
--   criado_em -> dth_criado
--   modo_escrita -> des_modo_escrita
--   configuracao -> des_configuracao
--   nome -> des_nome
--   airbyte_destination_id -> id_airbyte_destino
--   id -> id_destino
--   status -> des_status

with fonte as (
    select * from {{ source('datacore_raw', 'destinos') }}
),

tipado as (
    select
        tipo as tp_destino,
        criado_em as dth_criado,
        modo_escrita as des_modo_escrita,
        configuracao as des_configuracao,
        nome as des_nome,
        id_empresa as id_empresa,
        airbyte_destination_id as id_airbyte_destino,
        id as id_destino,
        status as des_status,
        cast(_airbyte_extracted_at as timestamp) as dt_ingestao_lake,
        current_timestamp() as _dbt_loaded_at
    from fonte
)

, deduplicado as (
    select *
    from tipado
    qualify row_number() over (
        partition by id_destino
        order by dt_ingestao_lake desc
    ) = 1
)

select * from deduplicado

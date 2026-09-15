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

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'tabelas_carregadas') }}
),

tipado AS (
    SELECT
        atualizado_em AS dth_atualizado,
        connection_id AS id_connection,
        nome_tabela AS des_nome_tabela,
        namespace AS des_namespace,
        integracao_nome AS des_integracao_nome,
        id AS id_tabela_carregada,
        coluna_atualizacao AS des_coluna_atualizacao,
        registrado_em AS dth_registrado,
        tipo_carga AS tp_carga,
        cast(_airbyte_extracted_at AS TIMESTAMP) AS dt_ingestao_lake,
        current_timestamp() AS _dbt_loaded_at
    FROM fonte
)

, deduplicado AS (
    SELECT *
    FROM tipado
    QUALIFY row_number() OVER (
        PARTITION BY id_tabela_carregada
        ORDER BY dt_ingestao_lake DESC
    ) = 1
)

SELECT * FROM deduplicado

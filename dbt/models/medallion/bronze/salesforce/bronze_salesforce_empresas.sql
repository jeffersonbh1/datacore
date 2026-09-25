{{ config(
    materialized = 'table'
    , alias = 'bronze_salesforce_empresas'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "salesforce", camada Bronze, tabela empresas.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'empresas')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_salesforce_empresas  (renome + LGPD Art. 46)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   atualizado_em -> dth_atualizado
--   criado_em -> dth_criado
--   airbyte_workspace_id -> id_airbyte_workspace
--   nome -> des_nome
--   plano -> des_plano
--   id -> id_empresa
--   slug -> des_slug
--   status -> des_status

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'empresas') }}
    -- Carga full: a Raw guarda o histórico de todas as cargas; aqui entra só a última bem-sucedida.
    {{ filtro_ultima_carga_ok(source('datacore_raw', 'empresas')) }}
),

tipado AS (
    SELECT
        atualizado_em                             AS dth_atualizado,
        criado_em                                 AS dth_criado,
        airbyte_workspace_id                      AS id_airbyte_workspace,
        nome                                      AS des_nome,
        plano                                     AS des_plano,
        id                                        AS id_empresa,
        slug                                      AS des_slug,
        status                                    AS des_status,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS _dat_carga,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

SELECT * FROM tipado

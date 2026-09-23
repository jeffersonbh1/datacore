{{ config(
    materialized = 'table'
    , alias = 'bronze_salesforce_pipelines'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "salesforce", camada Bronze, tabela pipelines.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'pipelines')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_salesforce_pipelines  (renome + LGPD Art. 46)
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

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'pipelines') }}
),

tipado AS (
    SELECT
        atualizado_em                             AS dth_atualizado,
        criado_em                                 AS dth_criado,
        criado_por                                AS des_criado_por,
        categoria                                 AS tp_pipeline,
        camadas                                   AS des_camadas,
        nome                                      AS des_nome,
        id_empresa                                AS id_empresa,
        integracao_id                             AS id_integracao,
        id                                        AS id_pipeline,
        layout_overrides                          AS des_layout_overrides,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS _dat_carga,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

SELECT * FROM tipado

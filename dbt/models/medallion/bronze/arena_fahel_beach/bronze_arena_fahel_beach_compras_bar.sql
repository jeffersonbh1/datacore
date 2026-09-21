{{ config(
    materialized = 'table'
    , alias = 'bronze_arena_fahel_beach_compras_bar'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "arena fahel beach", camada Bronze, tabela compras_bar.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'compras_bar')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_arena_fahel_beach_compras_bar  (renome + LGPD Art. 46 + dedup CDC)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   valor_total -> vlr_total
--   observacoes -> des_observacoes
--   forma_pagamento -> des_forma_pagamento
--   codigo -> cod_compra_bar
--   atualizado_em -> dth_atualizado
--   criado_em -> dth_criado
--   usuario -> des_usuario
--   id -> id_compra_bar
--   fornecedor -> des_fornecedor
--   data_compra -> dat_compra
--   status -> des_status
--   numero_nota -> num_nota

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'compras_bar') }}
),

tipado AS (
    SELECT
        valor_total                               AS vlr_total,
        observacoes                               AS des_observacoes,
        forma_pagamento                           AS des_forma_pagamento,
        codigo                                    AS cod_compra_bar,
        atualizado_em                             AS dth_atualizado,
        criado_em                                 AS dth_criado,
        usuario                                   AS des_usuario,
        id                                        AS id_compra_bar,
        fornecedor                                AS des_fornecedor,
        data_compra                               AS dat_compra,
        status                                    AS des_status,
        numero_nota                               AS num_nota,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS dt_ingestao_lake,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

, deduplicado AS (
    SELECT *
    FROM tipado
    QUALIFY row_number() OVER (
        PARTITION BY id_compra_bar
        ORDER BY dt_ingestao_lake DESC
    ) = 1
)

SELECT * FROM deduplicado

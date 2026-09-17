{{ config(
    materialized = 'table'
    , alias = 'bronze_arena_fahel_beach_vendas_bar'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "arena fahel beach", camada Bronze, tabela vendas_bar.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'vendas_bar')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_arena_fahel_beach_vendas_bar  (renome + LGPD Art. 46 + dedup CDC)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   codigo -> cod_venda_bar
--   telefone_cliente -> des_telefone_cliente
--   localizacao -> des_localizacao
--   data -> dat_venda_bar
--   desconto -> des_desconto
--   fechado_em -> dth_fechado
--   origem_venda -> des_origem_venda
--   valor_final -> vlr_final
--   nome_cliente -> des_nome_cliente
--   aberto_em -> dth_aberto
--   valor_total -> vlr_total
--   observacoes -> des_observacoes
--   forma_pagamento -> des_forma_pagamento
--   criado_em -> dth_criado
--   status_pagamento -> des_status_pagamento
--   id -> id_venda_bar
--   comanda_id -> id_comanda
--   status -> des_status

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'vendas_bar') }}
),

tipado AS (
    SELECT
        codigo                                    AS cod_venda_bar,
        {{ hash_sha256('telefone_cliente') }}     AS des_telefone_cliente,
        localizacao                               AS des_localizacao,
        data                                      AS dat_venda_bar,
        desconto                                  AS des_desconto,
        fechado_em                                AS dth_fechado,
        origem_venda                              AS des_origem_venda,
        valor_final                               AS vlr_final,
        nome_cliente                              AS des_nome_cliente,
        aberto_em                                 AS dth_aberto,
        valor_total                               AS vlr_total,
        observacoes                               AS des_observacoes,
        forma_pagamento                           AS des_forma_pagamento,
        criado_em                                 AS dth_criado,
        status_pagamento                          AS des_status_pagamento,
        id                                        AS id_venda_bar,
        comanda_id                                AS id_comanda,
        status                                    AS des_status,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS dt_ingestao_lake,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

SELECT * FROM tipado

{{ config(
    materialized = 'table'
    , alias = 'bronze_arena_fahel_beach_agendamentos'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "arena fahel beach", camada Bronze, tabela agendamentos.
-- A regeração sobrescreve este arquivo.
-- Origem: source('datacore_raw', 'agendamentos')  (dataset via DBT_RAW_DATASET)
-- Saída : <DBT_SCHEMA_BRONZE>.bronze_arena_fahel_beach_agendamentos  (renome + LGPD Art. 46 + dedup CDC)
-- Padronização de nomes (docs/CONVENCAO_NOMENCLATURA_BRONZE.md):
--   metodo_pagamento -> des_metodo_pagamento
--   telefone_cliente -> des_telefone_cliente
--   data -> dat_agendamento
--   nome_quadra -> des_nome_quadra
--   horario_fim -> des_horario_fim
--   esporte -> des_esporte
--   created_at -> dth_criacao
--   nome_cliente -> des_nome_cliente
--   tipo_agendamento -> tp_agendamento
--   valor_total -> vlr_total
--   observacoes -> des_observacoes
--   horario_inicio -> des_horario_inicio
--   quadra_id -> id_quadra
--   status_pagamento -> des_status_pagamento
--   id -> id_agendamento

WITH fonte AS (
    SELECT * FROM {{ source('datacore_raw', 'agendamentos') }}
),

tipado AS (
    SELECT
        metodo_pagamento                          AS des_metodo_pagamento,
        {{ hash_sha256('telefone_cliente') }}     AS des_telefone_cliente,
        data                                      AS dat_agendamento,
        nome_quadra                               AS des_nome_quadra,
        horario_fim                               AS des_horario_fim,
        esporte                                   AS des_esporte,
        created_at                                AS dth_criacao,
        nome_cliente                              AS des_nome_cliente,
        tipo_agendamento                          AS tp_agendamento,
        valor_total                               AS vlr_total,
        observacoes                               AS des_observacoes,
        horario_inicio                            AS des_horario_inicio,
        quadra_id                                 AS id_quadra,
        status_pagamento                          AS des_status_pagamento,
        id                                        AS id_agendamento,
        cast(_airbyte_extracted_at AS TIMESTAMP)  AS dt_ingestao_lake,
        current_timestamp()                       AS _dbt_loaded_at
    FROM fonte
)

SELECT * FROM tipado

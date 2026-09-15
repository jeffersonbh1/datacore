{{
  config(
    enabled = env_var('DBT_DEMO_ENABLED', 'true') == 'true',
    materialized = "table",
    partition_by = {
      "field": "data_referencia",
      "data_type": "date",
      "granularity": "month"
    },
    cluster_by = ["status_transacao", "faixa_ticket"],
    tags = ["lakehouse", "silver", "curated_analytics"]
  )
}}

/*
  ========================================================================
  Camada SILVER — Curadoria & Dimensões Conformadas
  ------------------------------------------------------------------------
  Uma linha por transação válida, pronta para BI/ML: partes de data,
  faixa de ticket e flag de sucesso. Descarta lixo (id nulo, valor < 0).
  ========================================================================
*/

WITH bronze AS (
    SELECT * FROM {{ ref('bronze_transacoes') }}
),

curado AS (

    SELECT
        id_transacao,

        dt_geracao_origem                                AS dt_transacao,
        cast(dt_geracao_origem AS DATE)                  AS data_referencia,
        extract(year  FROM dt_geracao_origem)            AS ano_transacao,
        extract(month FROM dt_geracao_origem)            AS mes_transacao,

        valor_transacao,
        CASE
            WHEN valor_transacao > 1000 THEN 'TICKET_ALTO'
            WHEN valor_transacao > 200  THEN 'TICKET_MEDIO'
            ELSE 'TICKET_VAREJO'
        END                                             AS faixa_ticket,

        status_transacao,
        cpf_titular_mascarado,
        numero_cartao_hash,
        email_comprador_tokenizado,

        status_transacao IN unnest({{ var('status_sucesso') }}) AS ind_transacao_sucesso,

        current_timestamp()                             AS _dbt_silver_updated_at

    FROM bronze
    WHERE id_transacao IS NOT NULL
      AND valor_transacao IS NOT NULL
      AND valor_transacao >= 0

)

SELECT * FROM curado

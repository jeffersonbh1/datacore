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
    tags = ["lakehouse", "gold", "data_mart", "kpis"]
  )
}}

/*
  ========================================================================
  Camada GOLD — Data Mart executivo
  ------------------------------------------------------------------------
  Grão: (data_referencia, status_transacao, faixa_ticket).
  KPIs de volume, receita, ticket médio e taxa de aprovação.
  ========================================================================
*/

WITH silver AS (
    SELECT * FROM {{ ref('silver_transacoes') }}
),

kpis AS (

    SELECT
        data_referencia,
        ano_transacao,
        mes_transacao,
        status_transacao,
        faixa_ticket,

        count(DISTINCT id_transacao)                                             AS total_transacoes,
        count(DISTINCT cpf_titular_mascarado)                                    AS clientes_unicos_atendidos,
        sum(IF(ind_transacao_sucesso, valor_transacao, 0))                       AS receita_liquida_total,
        avg(IF(ind_transacao_sucesso, valor_transacao, NULL))                    AS ticket_medio,
        countif(NOT ind_transacao_sucesso)                                       AS total_cancelamentos,
        round(safe_divide(countif(ind_transacao_sucesso) * 100.0, count(*)), 2)  AS taxa_aprovacao_percentual,

        current_timestamp()                                                      AS _dbt_gold_loaded_at

    FROM silver
    GROUP BY 1, 2, 3, 4, 5

)

SELECT * FROM kpis

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

with silver as (
    select * from {{ ref('silver_transacoes') }}
),

kpis as (

    select
        data_referencia,
        ano_transacao,
        mes_transacao,
        status_transacao,
        faixa_ticket,

        count(distinct id_transacao)                                             as total_transacoes,
        count(distinct cpf_titular_mascarado)                                    as clientes_unicos_atendidos,
        sum(if(ind_transacao_sucesso, valor_transacao, 0))                       as receita_liquida_total,
        avg(if(ind_transacao_sucesso, valor_transacao, null))                    as ticket_medio,
        countif(not ind_transacao_sucesso)                                       as total_cancelamentos,
        round(safe_divide(countif(ind_transacao_sucesso) * 100.0, count(*)), 2)  as taxa_aprovacao_percentual,

        current_timestamp()                                                      as _dbt_gold_loaded_at

    from silver
    group by 1, 2, 3, 4, 5

)

select * from kpis

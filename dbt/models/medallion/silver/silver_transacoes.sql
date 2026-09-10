{{
  config(
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

with bronze as (
    select * from {{ ref('bronze_transacoes') }}
),

curado as (

    select
        id_transacao,

        dt_geracao_origem                                as dt_transacao,
        cast(dt_geracao_origem as date)                  as data_referencia,
        extract(year  from dt_geracao_origem)            as ano_transacao,
        extract(month from dt_geracao_origem)            as mes_transacao,

        valor_transacao,
        case
            when valor_transacao > 1000 then 'TICKET_ALTO'
            when valor_transacao > 200  then 'TICKET_MEDIO'
            else 'TICKET_VAREJO'
        end                                             as faixa_ticket,

        status_transacao,
        cpf_titular_mascarado,
        numero_cartao_hash,
        email_comprador_tokenizado,

        status_transacao in unnest({{ var('status_sucesso') }}) as ind_transacao_sucesso,

        current_timestamp()                             as _dbt_silver_updated_at

    from bronze
    where id_transacao is not null
      and valor_transacao is not null
      and valor_transacao >= 0

)

select * from curado

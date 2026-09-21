-- Modelo Gold proposto pelo agente "Converse com os dados" (DataCore) e revisado/salvo por uma pessoa.
-- Empresa: DataCore Matriz | Salvo por: Jefferson Cunha | Em: 2026-09-21T19:54:20.437Z
{{ config(
    materialized='table',
    partition_by={'field': 'dat_referencia_mes', 'data_type': 'date', 'granularity': 'month'},
    cluster_by=['des_segmento']
) }}

with vendas_bar as (

    select
        date_trunc(dat_venda_bar, month)                            as dat_referencia_mes,
        'BAR'                                                       as des_segmento,
        id_venda_bar                                                as id_transacao,
        coalesce(vlr_total, 0)                                      as vlr_bruto,
        coalesce(des_desconto, 0)                                   as vlr_desconto,
        coalesce(vlr_final, vlr_total, 0)                           as vlr_liquido,
        des_status_pagamento                                        as des_status_pagamento
    from {{ ref('silver_arena_fahel_beach_vendas_bar') }}
    where dat_venda_bar is not null
      and coalesce(des_status, '') <> 'Cancelada'

),

agendamentos as (

    select
        a.id_agendamento,
        date_trunc(a.dat_agendamento, month)                        as dat_referencia_mes,
        case
            when exists (
                select 1
                from {{ ref('silver_arena_fahel_beach_aulas') }} au
                where au.id_agendamento = a.id_agendamento
            ) then 'AULAS'
            else 'ALUGUEL_QUADRA'
        end                                                         as des_segmento,
        coalesce(a.vlr_total, 0)                                    as vlr_bruto,
        a.des_status_pagamento
    from {{ ref('silver_arena_fahel_beach_agendamentos') }} a
    where a.dat_agendamento is not null

),

base_unificada as (

    select
        dat_referencia_mes,
        des_segmento,
        id_transacao,
        vlr_bruto,
        vlr_desconto,
        vlr_liquido,
        des_status_pagamento
    from vendas_bar

    union all

    select
        dat_referencia_mes,
        des_segmento,
        id_agendamento                                              as id_transacao,
        vlr_bruto,
        cast(0 as numeric)                                          as vlr_desconto,
        vlr_bruto                                                   as vlr_liquido,
        des_status_pagamento
    from agendamentos

),

faturamento_mensal as (

    select
        dat_referencia_mes,
        extract(year  from dat_referencia_mes)                      as num_ano,
        extract(month from dat_referencia_mes)                      as num_mes,
        des_segmento,
        count(distinct id_transacao)                                as qtd_transacoes,
        sum(vlr_bruto)                                              as vlr_faturamento_bruto,
        sum(vlr_desconto)                                           as vlr_desconto,
        sum(vlr_liquido)                                            as vlr_faturamento_liquido,
        sum(case when des_status_pagamento = 'Pago'
                 then vlr_liquido else 0 end)                       as vlr_faturamento_pago,
        sum(case when coalesce(des_status_pagamento, 'Pendente') <> 'Pago'
                 then vlr_liquido else 0 end)                       as vlr_faturamento_pendente
    from base_unificada
    group by 1, 2, 3, 4

)

select
    dat_referencia_mes,
    num_ano,
    num_mes,
    des_segmento,
    qtd_transacoes,
    vlr_faturamento_bruto,
    vlr_desconto,
    vlr_faturamento_liquido,
    vlr_faturamento_pago,
    vlr_faturamento_pendente,
    current_timestamp()                                             as _dbt_loaded_at
from faturamento_mensal
order by dat_referencia_mes, des_segmento

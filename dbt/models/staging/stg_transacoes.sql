/*
  Staging: normaliza a tabela raw_transacoes do Airbyte antes das camadas do
  medalhão. Sem regra de negócio aqui — só renome, tipagem de datas e a marca
  d'água de ingestão. Materializado como view.
*/

with fonte as (
    select * from {{ source('datacore', 'transacoes') }}
),

renomeado as (
    select
        cast(id_transacao as string)                as id_transacao,
        valor                                       as valor_bruto,
        status                                      as status_bruto,
        cpf_titular,
        numero_cartao,
        email_comprador,

        -- Timestamp do evento na origem (usado na ordenação da deduplicação CDC).
        cast(data_transacao as timestamp)           as dt_evento_origem,
        -- Timestamp em que o Airbyte extraiu a linha (marca d'água do incremental).
        cast(_airbyte_extracted_at as timestamp)    as dt_ingestao_lake,
        _airbyte_raw_id                             as _raw_id
    from fonte
)

select * from renomeado

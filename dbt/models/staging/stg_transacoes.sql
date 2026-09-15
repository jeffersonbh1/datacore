{{ config(enabled = env_var('DBT_DEMO_ENABLED', 'true') == 'true') }}

/*
  Staging: normaliza a tabela raw_transacoes do Airbyte antes das camadas do
  medalhão. Sem regra de negócio aqui — só renome, tipagem de datas e a marca
  d'água de ingestão. Materializado como view.
  EXEMPLO — desligado no gateway (DBT_DEMO_ENABLED=false).
*/

WITH fonte AS (
    SELECT * FROM {{ source('datacore', 'transacoes') }}
),

renomeado AS (
    SELECT
        cast(id_transacao AS STRING)                AS id_transacao,
        valor                                       AS valor_bruto,
        status                                      AS status_bruto,
        cpf_titular,
        numero_cartao,
        email_comprador,

        -- Timestamp do evento na origem (usado na ordenação da deduplicação CDC).
        cast(data_transacao AS TIMESTAMP)           AS dt_evento_origem,
        -- Timestamp em que o Airbyte extraiu a linha (marca d'água do incremental).
        cast(_airbyte_extracted_at AS TIMESTAMP)    AS dt_ingestao_lake,
        _airbyte_raw_id                             AS _raw_id
    FROM fonte
)

SELECT * FROM renomeado

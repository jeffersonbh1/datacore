{{
  config(
    enabled = env_var('DBT_DEMO_ENABLED', 'true') == 'true',
    materialized = "incremental",
    unique_key = "id_transacao",
    incremental_strategy = "merge",
    partition_by = {
      "field": "dt_ingestao_lake",
      "data_type": "timestamp",
      "granularity": "day"
    },
    cluster_by = ["status_transacao"],
    tags = ["lakehouse", "bronze", "lgpd_conformidade", "raw_ingestion"]
  )
}}

/*
  ========================================================================
  Camada BRONZE — Higienização, Tipagem Estrita, Deduplicação CDC e LGPD
  ------------------------------------------------------------------------
  - Schema enforcement + SAFE_CAST defensivo
  - Anonimização de PII (Art. 46 ANPD) via macros/lgpd.sql
  - Deduplicação determinística por id_transacao (registro mais recente)
  - Carga incremental por marca d'água (dt_ingestao_lake)
  Equivale ao SQL gerado em DbtSqlEditorModal.tsx, agora executável.
  ========================================================================
*/

with raw_source as (

    select * from {{ ref('stg_transacoes') }}

    {% if is_incremental() %}
      -- Micro-batch: só linhas ingeridas depois do último carregamento.
      where dt_ingestao_lake > (select max(dt_ingestao_lake) from {{ this }})
    {% endif %}

),

sanitizado as (

    select
        cast(id_transacao as string)                             as id_transacao,

        dt_evento_origem                                         as dt_geracao_origem,
        dt_ingestao_lake,
        current_timestamp()                                      as _dbt_loaded_at,

        {{ cast_decimal('valor_bruto') }}                        as valor_transacao,
        trim(upper(coalesce(status_bruto, 'PENDENTE')))          as status_transacao,

        -- Conformidade LGPD (Art. 46): redação, hash e pseudonimização.
        {{ mascarar_cpf('cpf_titular') }}                        as cpf_titular_mascarado,
        {{ hash_sha256('numero_cartao') }}                       as numero_cartao_hash,
        {{ tokenizar_email('email_comprador') }}                 as email_comprador_tokenizado

    from raw_source

),

deduplicado as (

    -- CDC: mantém a versão mais recente de cada id_transacao.
    select *
    from sanitizado
    qualify row_number() over (
        partition by id_transacao
        order by dt_geracao_origem desc, dt_ingestao_lake desc
    ) = 1

)

select * from deduplicado

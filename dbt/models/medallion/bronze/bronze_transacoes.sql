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

WITH raw_source AS (

    SELECT * FROM {{ ref('stg_transacoes') }}

    {% if is_incremental() %}
      -- Micro-batch: só linhas ingeridas depois do último carregamento.
      WHERE dt_ingestao_lake > (SELECT max(dt_ingestao_lake) FROM {{ this }})
    {% endif %}

),

sanitizado AS (

    SELECT
        cast(id_transacao AS STRING)                             AS id_transacao,

        dt_evento_origem                                         AS dt_geracao_origem,
        dt_ingestao_lake,
        current_timestamp()                                      AS _dbt_loaded_at,

        {{ cast_decimal('valor_bruto') }}                        AS valor_transacao,
        trim(upper(COALESCE(status_bruto, 'PENDENTE')))          AS status_transacao,

        -- Conformidade LGPD (Art. 46): redação, hash e pseudonimização.
        {{ mascarar_cpf('cpf_titular') }}                        AS cpf_titular_mascarado,
        {{ hash_sha256('numero_cartao') }}                       AS numero_cartao_hash,
        {{ tokenizar_email('email_comprador') }}                 AS email_comprador_tokenizado

    FROM raw_source

),

deduplicado AS (

    -- CDC: mantém a versão mais recente de cada id_transacao.
    SELECT *
    FROM sanitizado
    QUALIFY row_number() OVER (
        PARTITION BY id_transacao
        ORDER BY dt_geracao_origem DESC, dt_ingestao_lake DESC
    ) = 1

)

SELECT * FROM deduplicado

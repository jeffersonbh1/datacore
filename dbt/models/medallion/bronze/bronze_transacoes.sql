{{
  config(
    enabled = env_var('DBT_DEMO_ENABLED', 'true') == 'true',
    materialized = "incremental",
    unique_key = "id_transacao",
    incremental_strategy = "merge",
    on_schema_change = "sync_all_columns",
    partition_by = {
      "field": "_dat_carga",
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
  - Carga incremental por marca d'água (_dat_carga, macro max_dat_carga)
  Equivale ao SQL gerado em DbtSqlEditorModal.tsx, agora executável.
  ========================================================================
*/

-- Marca d'água: maior _dat_carga já gravada nesta tabela (none na 1ª carga).
{% set v_max_dat_carga = max_dat_carga() if is_incremental() else none %}

WITH raw_source AS (

    SELECT * FROM {{ ref('stg_transacoes') }}

    {% if v_max_dat_carga is not none %}
      -- Micro-batch: só linhas carregadas depois da última carga.
      WHERE _dat_carga > TIMESTAMP('{{ v_max_dat_carga }}')
    {% endif %}

),

sanitizado AS (

    SELECT
        cast(id_transacao AS STRING)                             AS id_transacao,

        dt_evento_origem                                         AS dt_geracao_origem,
        _dat_carga,
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
        ORDER BY dt_geracao_origem DESC, _dat_carga DESC
    ) = 1

)

SELECT * FROM deduplicado

{#
    Macros de conformidade LGPD (Art. 46 ANPD) — anonimização/pseudonimização de
    PII na entrada da camada Bronze. São o equivalente executável das
    transformações descritas em
    src/components/PipelineCanvas/DbtSqlEditorModal.tsx.
#}

{# CPF -> redação parcial determinística. Normaliza para dígitos e remascara.
   Entradas inválidas (não 11 dígitos) viram um token fixo, sem vazar o valor. #}
{% macro mascarar_cpf(coluna) -%}
  CASE
    WHEN {{ coluna }} IS NULL THEN NULL
    WHEN length(regexp_replace(cast({{ coluna }} AS STRING), r'[^0-9]', '')) != 11
      THEN '***.***.***-**'
    ELSE regexp_replace(
      regexp_replace(cast({{ coluna }} AS STRING), r'[^0-9]', ''),
      r'^([0-9]{3})([0-9]{3})([0-9]{3})([0-9]{2})$',
      r'***.\2.***-**'
    )
  END
{%- endmacro %}


{# Hash SHA-256 irreversível (hex). Uso: PAN de cartão, documentos, identificadores. #}
{% macro hash_sha256(coluna) -%}
  CASE
    WHEN {{ coluna }} IS NULL THEN NULL
    WHEN trim(cast({{ coluna }} AS STRING)) = '' THEN NULL
    ELSE to_hex(sha256(cast({{ coluna }} AS STRING)))
  END
{%- endmacro %}


{# E-mail -> pseudonimização preservando o domínio para analytics.
   local-part vira hash truncado; domínio normalizado em minúsculas. #}
{% macro tokenizar_email(coluna) -%}
  CASE
    WHEN {{ coluna }} IS NULL OR trim(cast({{ coluna }} AS STRING)) = '' THEN NULL
    WHEN strpos(cast({{ coluna }} AS STRING), '@') = 0
      THEN to_hex(sha256(lower(trim(cast({{ coluna }} AS STRING)))))
    ELSE concat(
      substr(
        to_hex(sha256(lower(trim(split(cast({{ coluna }} AS STRING), '@')[safe_offset(0)])))),
        1, 16
      ),
      '@',
      lower(trim(split(cast({{ coluna }} AS STRING), '@')[safe_offset(1)]))
    )
  END
{%- endmacro %}

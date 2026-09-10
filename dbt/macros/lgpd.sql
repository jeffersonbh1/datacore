{#
    Macros de conformidade LGPD (Art. 46 ANPD) — anonimização/pseudonimização de
    PII na entrada da camada Bronze. São o equivalente executável das
    transformações descritas em
    src/components/PipelineCanvas/DbtSqlEditorModal.tsx.
#}

{# CPF -> redação parcial determinística. Normaliza para dígitos e remascara.
   Entradas inválidas (não 11 dígitos) viram um token fixo, sem vazar o valor. #}
{% macro mascarar_cpf(coluna) -%}
  case
    when {{ coluna }} is null then null
    when length(regexp_replace(cast({{ coluna }} as string), r'[^0-9]', '')) != 11
      then '***.***.***-**'
    else regexp_replace(
      regexp_replace(cast({{ coluna }} as string), r'[^0-9]', ''),
      r'^([0-9]{3})([0-9]{3})([0-9]{3})([0-9]{2})$',
      r'***.\2.***-**'
    )
  end
{%- endmacro %}


{# Hash SHA-256 irreversível (hex). Uso: PAN de cartão, documentos, identificadores. #}
{% macro hash_sha256(coluna) -%}
  case
    when {{ coluna }} is null then null
    when trim(cast({{ coluna }} as string)) = '' then null
    else to_hex(sha256(cast({{ coluna }} as string)))
  end
{%- endmacro %}


{# E-mail -> pseudonimização preservando o domínio para analytics.
   local-part vira hash truncado; domínio normalizado em minúsculas. #}
{% macro tokenizar_email(coluna) -%}
  case
    when {{ coluna }} is null or trim(cast({{ coluna }} as string)) = '' then null
    when strpos(cast({{ coluna }} as string), '@') = 0
      then to_hex(sha256(lower(trim(cast({{ coluna }} as string)))))
    else concat(
      substr(
        to_hex(sha256(lower(trim(split(cast({{ coluna }} as string), '@')[safe_offset(0)])))),
        1, 16
      ),
      '@',
      lower(trim(split(cast({{ coluna }} as string), '@')[safe_offset(1)]))
    )
  end
{%- endmacro %}

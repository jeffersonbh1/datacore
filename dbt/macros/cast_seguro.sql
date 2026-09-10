{#
    Cast numérico defensivo: SAFE_CAST evita quebra da carga por valores sujos
    (retorna NULL em vez de erro) e arredonda para a escala de negócio.
#}
{% macro cast_decimal(coluna, escala=2) -%}
  round(safe_cast({{ coluna }} as numeric), {{ escala }})
{%- endmacro %}

{#
    Maior _dat_carga já gravada na tabela do modelo (ou em `relation`, se
    informada) — a marca d'água dos modelos incrementais. Chamada no INÍCIO do
    modelo; o filtro da fonte então lê só o que chegou depois dela:

        {% set v_max_dat_carga = max_dat_carga() if is_incremental() else none %}
        ...
        {% if v_max_dat_carga is not none %}
        WHERE _airbyte_extracted_at > TIMESTAMP('{{ v_max_dat_carga }}')
        {% endif %}

    Devolve a data como texto (ex.: '2026-09-23 14:05:12.123456+00') ou `none`
    quando não há o que filtrar: tabela ainda não existe, está vazia ou ainda
    não tem a coluna (tabela criada antes da coluna existir). Com `none` o
    modelo reprocessa a fonte inteira — o merge pela chave única evita
    duplicar registros.
#}
{% macro max_dat_carga(relation=none, coluna='_dat_carga') %}
  {%- if not execute -%}
    {{ return(none) }}
  {%- endif -%}

  {%- set alvo = load_relation(relation if relation is not none else this) -%}
  {%- if alvo is none -%}
    {{ return(none) }}
  {%- endif -%}

  {%- set colunas = adapter.get_columns_in_relation(alvo) | map(attribute='name') | map('lower') | list -%}
  {%- if coluna | lower not in colunas -%}
    {{ return(none) }}
  {%- endif -%}

  {%- set resultado = run_query('SELECT CAST(MAX(' ~ adapter.quote(coluna) ~ ') AS STRING) FROM ' ~ alvo) -%}
  {{ return(resultado.columns[0].values()[0]) }}
{% endmacro %}

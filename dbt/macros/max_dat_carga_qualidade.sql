{#
    Marca d'água da Silver INCREMENTAL com regras de qualidade (ver
    server/dbtCodegen.ts): a maior _dat_carga já processada, somando o que foi
    aceito (a própria Silver) e o que foi para a quarentena (_rejeitados).

    Sem somar a quarentena, um lote em que todas as linhas foram rejeitadas não
    avançaria a marca d'água da Silver e seria relido (e rejeitado de novo) a
    cada execução. As linhas rejeitadas NESTA execução ficam de fora: o modelo
    _rejeitados roda antes da Silver, e a Silver precisa enxergar a marca
    d'água de antes dele para ler o mesmo lote.

        {% set v_max_dat_carga = max_dat_carga_qualidade(this, ref('silver_x_rejeitados')) %}

    `silver` e `rejeitados` podem ser `none` ou ainda não existir. Devolve a
    data como texto, ou `none` (lê a Bronze inteira) quando nenhuma das duas tem dado.
#}
{% macro max_dat_carga_qualidade(silver, rejeitados) %}
  {%- if not execute -%}
    {{ return(none) }}
  {%- endif -%}

  {%- set partes = [] -%}
  {%- for rel, filtro in [(silver, ''), (rejeitados, " WHERE _id_execucao != '" ~ invocation_id ~ "'")] -%}
    {%- set alvo = load_relation(rel) if rel is not none else none -%}
    {%- if alvo is not none -%}
      {%- set colunas = adapter.get_columns_in_relation(alvo) | map(attribute='name') | map('lower') | list -%}
      {%- if '_dat_carga' in colunas -%}
        {%- do partes.append('SELECT MAX(_dat_carga) AS d FROM ' ~ alvo ~ filtro) -%}
      {%- endif -%}
    {%- endif -%}
  {%- endfor -%}

  {%- if partes | length == 0 -%}
    {{ return(none) }}
  {%- endif -%}

  {%- set resultado = run_query('SELECT CAST(MAX(d) AS STRING) FROM (' ~ partes | join(' UNION ALL ') ~ ')') -%}
  {{ return(resultado.columns[0].values()[0]) }}
{% endmacro %}

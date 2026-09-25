{#
    Aviso no log da execução quando a Raw traz registros com alguma coluna da
    chave vazia (NULL). A Bronze incremental descarta essas linhas — NULL nunca
    casa no merge, então elas seriam inseridas de novo a cada carga. Conta só o
    lote que a Bronze vai ler: o que chegou depois de `desde` (a marca d'água,
    ou tudo quando `none`).

        {{ avisar_chave_nula(source('datacore_raw', 'usuarios'), ['id'], v_max_dat_carga) }}
#}
{% macro avisar_chave_nula(relation, colunas, desde=none) %}
  {%- if execute -%}
    {%- set nulas = [] -%}
    {%- for c in colunas -%}
      {%- do nulas.append(c ~ ' IS NULL') -%}
    {%- endfor -%}
    {%- set sql = 'SELECT COUNT(*) FROM ' ~ relation ~ ' WHERE (' ~ nulas | join(' OR ') ~ ')' -%}
    {%- if desde is not none -%}
      {%- set sql = sql ~ " AND _airbyte_extracted_at > TIMESTAMP('" ~ desde ~ "')" -%}
    {%- endif -%}
    {%- set qtd = run_query(sql).columns[0].values()[0] -%}
    {%- if qtd > 0 -%}
      {{ log('AVISO: ' ~ this.identifier ~ ': ' ~ qtd ~ ' registro(s) da Raw com a chave (' ~ colunas | join(', ') ~ ') vazia foram descartados.', info=True) }}
    {%- endif -%}
  {%- endif -%}
{% endmacro %}

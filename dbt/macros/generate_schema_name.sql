{#
    Sobrescreve o comportamento padrão do dbt (que prefixaria o schema alvo em
    <target_schema>_<custom>). Aqui cada camada usa o dataset EXATO definido em
    dbt_project.yml (+schema), casando com a convenção raw_/bronze_/silver_/gold_
    do gateway. Para isolar ambientes de devs distintos, volte ao padrão dbt
    (concatenação) ou parametrize +schema por variável de ambiente.
#}
{% macro generate_schema_name(custom_schema_name, node) -%}
    {%- if custom_schema_name is none -%}
        {{ target.schema }}
    {%- else -%}
        {{ custom_schema_name | trim }}
    {%- endif -%}
{%- endmacro %}

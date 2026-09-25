{#
    WHERE da Bronze full: só a última carga BEM-SUCEDIDA da Raw.

    A Raw full empilha as cargas (full_refresh_append). "Maior sync_id" não
    basta: um sync que falhou ou foi cancelado no meio deixa uma carga parcial
    com sync_id próprio, e uma tentativa refeita no mesmo job grava as duas
    tentativas com o mesmo sync_id. O gateway consulta o Airbyte e passa
    (server/rawLastLoad.ts):

        --vars '{"raw_carga_ok": {"sync_id": 129, "desde": "2026-09-25T17:01:33Z"}}'

    sync_id = o último job bem-sucedido; desde = início da tentativa que deu
    certo (descarta linhas de tentativas anteriores do mesmo job).

    Sem a var num build/run, a tabela NÃO é reconstruída (erro com o motivo em
    raw_carga_ok_motivo) e continua com o último dado bom. Em compile (editor do
    Studio, sem gateway), cai para o maior sync_id só para renderizar o SQL.

        {{ filtro_ultima_carga_ok(source('datacore_raw', 'alunos')) }}
#}
{% macro filtro_ultima_carga_ok(relation) %}
  {%- set carga = var('raw_carga_ok', none) -%}
  {%- if carga is none -%}
    {%- if execute and flags.WHICH in ['build', 'run'] -%}
      {{ exceptions.raise_compiler_error(
          'Bronze full NÃO reconstruída: ' ~ var('raw_carga_ok_motivo', 'sem a última carga bem-sucedida da Raw')
          ~ '. A tabela continua com o último dado bom; execute de novo com a VM do Airbyte ligada.') }}
    {%- endif -%}
    WHERE CAST(JSON_VALUE(_airbyte_meta, '$.sync_id') AS INT64) = (
        SELECT MAX(CAST(JSON_VALUE(_airbyte_meta, '$.sync_id') AS INT64))
        FROM {{ relation }}
    )
  {%- else -%}
    WHERE CAST(JSON_VALUE(_airbyte_meta, '$.sync_id') AS INT64) = {{ carga['sync_id'] | int }}
      AND _airbyte_extracted_at >= TIMESTAMP('{{ carga['desde'] }}')
  {%- endif -%}
{% endmacro %}

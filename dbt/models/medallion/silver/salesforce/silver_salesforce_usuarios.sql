{{ config(
    materialized = 'incremental'
    , alias = 'silver_salesforce_usuarios'
    , unique_key = 'id_usuario'
    , incremental_strategy = 'merge'
    , on_schema_change = 'sync_all_columns'
) }}

-- GERADO por server/dbtCodegen.ts — sistema "salesforce", camada Silver, tabela usuarios.
-- A regeração sobrescreve este arquivo. Ponto de partida: passthrough do Bronze
-- já tipado/sanitizado — adicione aqui as regras de curadoria do
-- negócio (joins, métricas, renomes analíticos) conforme necessário.
-- Origem: ref('bronze_salesforce_usuarios')
-- Saída : <DBT_SCHEMA_SILVER>.silver_salesforce_usuarios

-- Carga incremental: busca a maior _dat_carga já gravada nesta tabela (macro
-- max_dat_carga) para ler da Bronze só os registros novos.
{% if is_incremental() %}
    {% set v_max_dat_carga = max_dat_carga() %}
{% endif %}

SELECT * FROM {{ ref('bronze_salesforce_usuarios') }}
{% if is_incremental() and v_max_dat_carga is not none %}
WHERE _dat_carga > TIMESTAMP('{{ v_max_dat_carga }}')
{% endif %}

{#
    Reconciliação da Silver com regras de qualidade (modelo `table`, ver
    server/dbtCodegen.ts): toda linha da Bronze tem que ter ido OU para a
    Silver OU para a quarentena nesta execução. Diferença = bug no SQL gerado
    (linha perdida ou duplicada), nunca um problema do dado.

    Na Silver incremental a conta é por lote e não fecha com os totais — lá o
    teste não é aplicado.
#}
{% test reconciliacao_qualidade(model, bronze, rejeitados) %}
WITH contagens AS (
    SELECT
        (SELECT COUNT(*) FROM {{ bronze }}) AS linhas_bronze,
        (SELECT COUNT(*) FROM {{ model }}) AS linhas_silver,
        (SELECT COUNT(*) FROM {{ rejeitados }} WHERE _id_execucao = '{{ invocation_id }}') AS linhas_rejeitadas
)
SELECT * FROM contagens
WHERE linhas_bronze != linhas_silver + linhas_rejeitadas
{% endtest %}

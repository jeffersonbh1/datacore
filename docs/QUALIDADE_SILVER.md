# Qualidade de dados na camada Silver (fase 1)

Regras de validação de **linha** por tabela Silver, criadas na tela **Qualidade de Dados**.
A linha que viola uma regra ativa vai para a **quarentena**
(`silver_<sistema>_<tabela>_rejeitados`) em vez da Silver.

## Como funciona

```
Tela Qualidade de Dados ──PUT /api/quality/:integracaoId/regras──► gateway
   valida coluna/tipo/parâmetros (server/qualityRules.ts)
   grava em qualidade_regras (Supabase)
   regera silver_<t>.sql + silver_<t>_rejeitados.sql + _properties.yml (server/dbtCodegen.ts)
   commit/push no git (DBT_CODEGEN_GIT)

Executar (Studio) ──► dbt build da Silver + quarentena
   gateway grava o resultado em qualidade_execucoes (server/qualityResults.ts)

Tela Qualidade de Dados ◄── lê qualidade_regras / qualidade_execucoes direto do Supabase (RLS)
```

- **Fonte da verdade das regras:** tabela `qualidade_regras` (Supabase). O gerador usa a cópia
  em `dbt/_generated_silver.json` (campo `regras` do modelo), que também fica versionada no git.
- **Tabela sem regras:** o SQL da Silver é exatamente o de antes (passthrough da Bronze).
- **Tipos:** vêm do BigQuery (`INFORMATION_SCHEMA.COLUMNS`), nunca do prefixo do nome da coluna.
- **NULL** só é reprovado pela regra "Obrigatório"; nas outras, valor nulo passa.

## Regras da fase 1

| Regra | Colunas | Parâmetros |
|---|---|---|
| Obrigatório (`not_null`) | todas | — |
| Valores permitidos (`accepted_values`) | texto, número, data | lista de valores (maiúsculas contam) |
| Faixa (`range`) | número, data | mínimo e/ou máximo |

Sempre validados, sem configurar: chave primária única e não nula (já existia) e, na Silver
`table` com regras, a **reconciliação** `Bronze = Silver + quarentena desta execução`
(`dbt/tests/generic/reconciliacao_qualidade.sql`).

## Silver incremental

- A marca d'água considera o que foi aceito **e** o que foi para a quarentena
  (`dbt/macros/max_dat_carga_qualidade.sql`), para um lote todo rejeitado não ser relido a cada execução.
- Se a versão nova de um registro for rejeitada, a versão antiga é **removida** da Silver (`post_hook`).
- Regras novas valem para registros novos ou alterados; para revalidar tudo, execute "Do zero".

## Quarentena

- Colunas da Bronze + `_motivos_rejeicao` (ex.: `r12: vlr_total abaixo do mínimo 0`, onde `12` é o id da regra),
  `_dat_rejeicao` e `_id_execucao` (`invocation_id` do dbt).
- Só acumula; não é recriada pelo `--full-refresh`. Guarda **90 dias** (`post_hook` de retenção).

## Testes do gerador

```
npm run server:test
```

## Implantação

1. Rodar `sql/018_qualidade_silver.sql` no SQL Editor do Supabase.
2. Redeploy manual do gateway (`server/` e `dbt/` mudaram).
3. O front publica sozinho pela Vercel.

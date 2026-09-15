# Convenção de Nomenclatura de Campos — Camada Bronze (DataCore)

> Ligado a [`ARQUITETURA.md`](./ARQUITETURA.md) (seção 8, "A camada Bronze em
> detalhe") e a [`../dbt/README.md`](../dbt/README.md). A implementação vive em
> [`../server/bronzeNaming.ts`](../server/bronzeNaming.ts), chamada por
> `server/dbtCodegen.ts` ao gerar cada `bronze_<sistema>_<tabela>.sql`.

## Objetivo

Padronizar os nomes dos campos na camada Bronze para garantir consistência,
legibilidade e previsibilidade em todo o pipeline (Bronze → Silver → Gold),
facilitando o entendimento do tipo e do significado de cada coluna apenas pelo
nome.

---

## Regra geral

Todo campo de negócio recebe um **prefixo** (ou sufixo, no caso dos metadados
técnicos) que identifica seu tipo/natureza. Se o nome original do campo já
contiver uma palavra que expresse esse tipo, essa palavra é **substituída**
pelo prefixo — nunca duplicada.

**Procedimento de conversão:**
1. Identificar se o nome do campo contém palavra(s) que já expressam o tipo
   (ex: descrição, valor, quantidade, data, código, tipo, percentual,
   indicador/booleano em português ou inglês).
2. Remover essa palavra do nome.
3. Aplicar o prefixo/sufixo correspondente na frente do que sobrou.
4. Se o campo estiver em inglês, traduzir o restante do nome para português.
5. Se não sobrar nada com sentido próprio após remover a palavra redundante
   (ex: campo chamado apenas `descricao`), manter um nome mínimo coerente com
   o contexto da tabela (ex: `des_ocorrido`, `des_status`).

---

## Tabela de prefixos e sufixos

| Prefixo/Sufixo | Tipo de dado | Exemplo padronizado |
|---|---|---|
| `des_` | Texto descritivo (string) | `des_nome_cliente` |
| `vlr_` | Valor numérico monetário/decimal | `vlr_total_pedido` |
| `ind_` | Booleano (todo campo de verdadeiro/falso, sim/não) | `ind_ativo`, `ind_deletado` |
| `qtd_` | Quantidade (inteiro) | `qtd_itens` |
| `dat_` | Data (sem hora) | `dat_nascimento` |
| `dth_` | Data e hora (timestamp) | `dth_criacao` |
| `cod_` | Código de negócio (vindo do source) | `cod_produto` |
| `id_` | Chave técnica/surrogate gerada pelo pipeline | `id_pedido` |
| `num_` | Número genérico não monetário | `num_versao` |
| `per_` | Percentual | `per_desconto` |
| `tp_` | Tipo/categoria (enum de negócio) | `tp_pagamento` |
| `uf_` | Sigla/unidade federativa ou similar curto e fixo | `uf_estado` |
| `json_` / `var_` | Campo semi-estruturado (JSON/variant) | `json_metadata` |
| `_at` (sufixo) | Metadado técnico de auditoria (timestamp de sistema) | `loaded_at`, `extracted_at` |
| `_src` (sufixo) | Metadado técnico de origem | `airbyte_src` |

---

## Exemplos de conversão

| Nome original (source) | Nome padronizado | Observação |
|---|---|---|
| `descricao_ocorrido` | `des_ocorrido` | "descricao" substituído por `des_` |
| `is_deleted` | `ind_deletado` | booleano, traduzido + prefixado |
| `active` | `ind_ativo` | booleano, traduzido + prefixado |
| `valor_total_pedido` | `vlr_total_pedido` | "valor" substituído por `vlr_` |
| `quantidade_itens` | `qtd_itens` | "quantidade" substituído por `qtd_` |
| `data_nascimento` | `dat_nascimento` | "data" substituído por `dat_` |
| `data_hora_criacao` | `dth_criacao` | "data_hora" substituído por `dth_` |
| `codigo_produto` | `cod_produto` | "codigo" substituído por `cod_` |
| `tipo_pagamento` | `tp_pagamento` | "tipo" substituído por `tp_` |
| `percentual_desconto` | `per_desconto` | "percentual" substituído por `per_` |
| `id_cliente` | `id_cliente` | já correto, sem alteração |
| `descricao` (campo isolado, sem contexto no nome) | `des_ocorrido` (ou nome mínimo coerente com a tabela) | aplicar regra 5 |

---

## Pontos em aberto para refinamento futuro

- Definir tradução padrão para termos técnicos recorrentes em inglês (ex:
  `status`, `type`, `flag`) que apareçam em múltiplas fontes, para evitar
  traduções inconsistentes entre pipelines.
- Definir se `cod_` e `id_` coexistem na mesma tabela quando o source já traz
  um campo de código de negócio E o pipeline gera uma surrogate key para a
  mesma entidade.
- Avaliar necessidade de um prefixo específico para campos de e-mail,
  telefone ou outros dados sensíveis/PII, caso isso facilite governança e
  mascaramento futuro.

---

## Implementação (`server/bronzeNaming.ts`)

A convenção acima é aplicada **automaticamente** pelo codegen (`server/dbtCodegen.ts`)
a cada coluna selecionada de cada tabela, ao gerar
`bronze_<sistema>_<tabela>.sql`. É uma heurística sobre o **nome** da coluna —
o discovery do Airbyte não propaga o tipo de dado (ver `ARQUITETURA.md`, seção
10), então a decisão entre, por exemplo, `dat_` e `dth_` quando o nome não
deixa claro é sempre uma aproximação, nunca uma leitura do tipo real.

### O que o motor decide sozinho

- Tokeniza o nome (`camelCase` → `snake_case`, sem acento, minúsculo) e testa
  os tokens contra listas de palavras-gatilho por tipo (as mesmas da tabela
  acima, em PT e EN — ex.: `valor`/`value`/`preco`/`amount` → `vlr_`).
  Cada lista já inclui a própria sigla do prefixo (`vlr`, `dat`, `cod`, ...),
  então aplicar a função a um nome já padronizado é **idempotente**.
- Booleano tem duas formas de detecção: uma palavra auxiliar removida (`is_`,
  `has_`, `pode_`, `possui_`, `flag_`, `indicador_`) ou um adjetivo já
  conhecido mantido por inteiro e traduzido (`active` → `ind_ativo`,
  `deletado` → `ind_deletado`). Só classifica pelo adjetivo isolado quando
  **todos** os tokens do nome são adjetivos conhecidos — evita falso positivo
  em nomes como `records_synced` (uma contagem, não um flag) onde só uma
  palavra do meio bate com a lista.
- `_em`/`_at` no **fim** do nome (idiomatismo comum de timestamp de evento de
  negócio: `criado_em`, `created_at`) vira `dth_`. Isso é **diferente** do
  sufixo técnico `_at` da tabela acima: aquele é reservado às duas colunas de
  marca d'água que o próprio pipeline adiciona (`dt_ingestao_lake`,
  `_dbt_loaded_at`) — essas nunca passam pela padronização, são geradas à
  parte no SQL.
- Coluna `id`/`cod` isolada (sem nada sobrando depois de remover a
  palavra-tipo) usa o nome da tabela como contexto — regra 5 da convenção —
  com uma singularização simples de plurais comuns do português (`origens` →
  `origem`, `integracoes` → `integracao`).
- Duas colunas de origem diferentes que caiam no mesmo nome padronizado
  (colisão) recebem um sufixo numérico (`_2`, `_3`, ...) para nunca gerar SQL
  com alias duplicado.
- A PK usada em `unique_key` (incremental) e no `partition by` da deduplicação
  CDC é resolvida para o nome **já padronizado** — dedup e merge sempre
  apontam para a coluna que de fato existe na projeção.
- Todo campo cujo nome é efetivamente renomeado aparece num comentário no
  topo do `.sql` gerado (`-- Padronização de nomes: original -> novo`), para
  auditoria rápida sem precisar comparar com o schema do source.

### O que fica deliberadamente em aberto (mesma lista da seção anterior)

- **Tradução de termos técnicos recorrentes** (`status`, `type`, `flag`,
  `role`): sem uma palavra-tipo reconhecida na tabela oficial, esses campos
  caem no bucket padrão `des_` (ex.: `status` → `des_status`). Não é uma
  decisão final — é o comportamento enquanto o glossário oficial (primeiro
  ponto em aberto) não existir.
- **`cod_` vs. `id_` na mesma tabela**: cada coluna é padronizada
  independentemente; se o source trouxer `codigo_produto` **e** `id`, o
  resultado natural é `cod_produto` e `id_<tabela>` coexistindo — o motor não
  tenta decidir qual das duas "deveria" ser a chave.
- **Prefixo dedicado para PII** (e-mail, telefone, documento): não existe.
  Esses campos recebem o prefixo do seu tipo de dado como qualquer outro
  (normalmente `des_`) — a proteção de PII continua sendo o mascaramento LGPD
  (`dbt/macros/lgpd.sql`), um mecanismo separado da nomenclatura.
- **Dicionário de tradução PT/EN** (`EN_PT` em `bronzeNaming.ts`) é **melhor
  esforço**, não exaustivo: cobre termos recorrentes de CRM/e-commerce/pessoas.
  Um token sem entrada no dicionário é mantido como está (não é erro).

### Limitações conhecidas

- Sem o tipo real da coluna, a heurística erra para o lado conservador em
  ambiguidades: `dt_algo`/`data_algo` isolado (sem palavra de hora) vira
  `dat_` mesmo quando na prática for um timestamp completo.
- A detecção de booleano por adjetivo isolado exige que **todos** os tokens
  do nome sejam adjetivos conhecidos; um booleano composto com uma palavra
  fora da lista (ex.: um acrônimo específico do negócio + adjetivo) cai no
  bucket padrão `des_` em vez de `ind_` — mais seguro do que o inverso
  (marcar uma contagem como booleana), mas exige revisão manual pontual.
  Auxiliares explícitos (`is_`, `has_`, `pode_`, `ind_`, `flag_`) continuam
  detectando o booleano independentemente da palavra que sobrar.
- A singularização de contexto (regra 5) é ingênua: cobre os plurais mais
  comuns do português (`-ões` → `-ão`, `-ens` → `-em`, `-s` → nada) mas não
  trata irregulares.
- Só se aplica quando a integração seleciona colunas explícitas
  (`IntegrationTableSpec.columns`) — no modo passthrough (`select *`, sem
  lista de colunas) os nomes originais do source são preservados, porque não
  há como renomear um `*` sem conhecer as colunas.

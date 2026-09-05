# Banco de Dados — DataCore

Scripts SQL para PostgreSQL. Rode na ordem numérica.

## Convenção de tabelas

Toda tabela do sistema deve incluir, além das colunas específicas do domínio:

- `dt_criacao` — `TIMESTAMPTZ NOT NULL DEFAULT now()`
- `dt_alteracao` — `TIMESTAMPTZ NOT NULL DEFAULT now()`, mantida automaticamente
  por uma trigger `BEFORE UPDATE` que chama `fn_atualiza_dt_alteracao()`
  (definida em `migrations/0001_funcoes_comuns.sql`).
- `ind_cadastro_ativo` — `BOOLEAN NOT NULL DEFAULT TRUE` (soft delete).

## Como rodar

```bash
psql "$DATABASE_URL" -f db/migrations/0001_funcoes_comuns.sql
psql "$DATABASE_URL" -f db/migrations/0002_criar_tabela_usuarios.sql

# opcional, só em ambiente local/demo:
psql "$DATABASE_URL" -f db/seed/0001_seed_usuarios.sql
```

## Tabelas

| Arquivo | Tabela | Descrição |
|---|---|---|
| `0002_criar_tabela_usuarios.sql` | `usuarios` | Autenticação e RBAC da plataforma |

-- ============================================================================
-- Funções utilitárias compartilhadas por todas as tabelas do DataCore.
-- ============================================================================

-- Necessária para gen_random_uuid() usado como default de chave primária.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Mantém a coluna dt_alteracao sempre atualizada a cada UPDATE.
-- Toda tabela do sistema deve criar um trigger BEFORE UPDATE apontando
-- para esta função (ver exemplo em 0002_criar_tabela_usuarios.sql).
CREATE OR REPLACE FUNCTION fn_atualiza_dt_alteracao()
RETURNS TRIGGER AS $$
BEGIN
    NEW.dt_alteracao = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

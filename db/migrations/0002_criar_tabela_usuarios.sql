-- ============================================================================
-- Tabela: usuarios
-- Usuários com acesso à plataforma DataCore (autenticação e RBAC).
-- Convenção do projeto: toda tabela possui dt_alteracao (mantida por trigger)
-- e ind_cadastro_ativo (soft delete, default TRUE).
-- ============================================================================

CREATE TYPE papel_usuario AS ENUM (
    'admin',
    'data_engineer',
    'data_analyst',
    'dpo_compliance',
    'viewer'
);

CREATE TABLE usuarios (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome                        VARCHAR(150) NOT NULL,
    email                       VARCHAR(255) NOT NULL UNIQUE,
    senha_hash                  VARCHAR(255) NOT NULL,
    papel                       papel_usuario NOT NULL DEFAULT 'viewer',
    departamento                VARCHAR(150),
    avatar_iniciais             VARCHAR(5),
    mfa_habilitado              BOOLEAN NOT NULL DEFAULT FALSE,
    pode_visualizar_pii_bruto   BOOLEAN NOT NULL DEFAULT FALSE,
    ultimo_acesso_em            TIMESTAMPTZ,
    dt_criacao                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    dt_alteracao                TIMESTAMPTZ NOT NULL DEFAULT now(),
    ind_cadastro_ativo          BOOLEAN NOT NULL DEFAULT TRUE
);

COMMENT ON TABLE usuarios IS 'Usuários com acesso à plataforma DataCore (autenticação e RBAC)';
COMMENT ON COLUMN usuarios.senha_hash IS 'Hash da senha (bcrypt/argon2) — nunca armazenar em texto plano';
COMMENT ON COLUMN usuarios.papel IS 'Papel de acesso RBAC: admin, data_engineer, data_analyst, dpo_compliance ou viewer';
COMMENT ON COLUMN usuarios.dt_alteracao IS 'Atualizado automaticamente pela trigger trg_usuarios_dt_alteracao';
COMMENT ON COLUMN usuarios.ind_cadastro_ativo IS 'Soft delete: FALSE = cadastro inativo/desativado, não deve autenticar';

CREATE INDEX idx_usuarios_email ON usuarios (email);
CREATE INDEX idx_usuarios_ativo ON usuarios (ind_cadastro_ativo);

CREATE TRIGGER trg_usuarios_dt_alteracao
    BEFORE UPDATE ON usuarios
    FOR EACH ROW
    EXECUTE FUNCTION fn_atualiza_dt_alteracao();

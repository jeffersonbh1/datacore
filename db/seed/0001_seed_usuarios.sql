-- ============================================================================
-- Seed de usuários de demonstração (mesmos usuários do mock atual do frontend).
-- Senha de todos os usuários abaixo: "datacore123" (apenas para ambiente local).
-- Usa pgcrypto (crypt/gen_salt) só para gerar o hash de seed — a aplicação
-- deve gerar o hash de produção com bcrypt/argon2 no backend, nunca no banco.
-- ============================================================================

INSERT INTO usuarios (nome, email, senha_hash, papel, departamento, avatar_iniciais, mfa_habilitado, pode_visualizar_pii_bruto)
VALUES
    ('Jefferson Barbosa', 'jeffersonbh1@gmail.com', crypt('datacore123', gen_salt('bf')), 'admin', 'Arquitetura de Dados & Cloud', 'JB', TRUE, TRUE),
    ('Carlos Silva', 'carlos.silva@empresa.com.br', crypt('datacore123', gen_salt('bf')), 'data_engineer', 'Engenharia de Plataforma', 'CS', TRUE, FALSE),
    ('Beatriz Lopes', 'beatriz.dpo@empresa.com.br', crypt('datacore123', gen_salt('bf')), 'dpo_compliance', 'Governança, Risco & Compliance (LGPD)', 'BL', TRUE, TRUE),
    ('Mariana Duarte', 'mariana.duarte@empresa.com.br', crypt('datacore123', gen_salt('bf')), 'data_engineer', 'Engenharia de Dados', 'MD', TRUE, FALSE)
ON CONFLICT (email) DO NOTHING;

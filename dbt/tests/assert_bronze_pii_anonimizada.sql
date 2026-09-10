-- LGPD: nenhuma PII pode chegar em claro na Bronze.
-- Falha se sobrar um CPF completamente formatado, ou se o e-mail tokenizado não
-- estiver no formato esperado (<16 hex>@dominio).
select
    id_transacao,
    cpf_titular_mascarado,
    email_comprador_tokenizado
from {{ ref('bronze_transacoes') }}
where regexp_contains(coalesce(cpf_titular_mascarado, ''), r'^[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}$')
   or (
        email_comprador_tokenizado is not null
        and not regexp_contains(email_comprador_tokenizado, r'^[0-9a-f]{16}@')
   )

-- Modelo Gold proposto pelo agente "Converse com os dados" (DataCore) e revisado/salvo por uma pessoa.
-- Empresa: DataCore Matriz | Salvo por: Jefferson Cunha | Em: 2026-09-21T19:06:31.262Z
select
    date_trunc(date(dth_criacao), month) as dat_mes_cadastro,
    count(distinct id_aluno) as qtd_alunos
from {{ ref('silver_arena_fahel_beach_alunos') }}
where dth_criacao is not null
group by 1

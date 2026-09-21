import { getSupabaseAdmin } from '../supabaseAdmin';

// -----------------------------------------------------------------------------
// Base de conhecimento SEMÂNTICO do agente: regras de negócio, métricas/KPIs,
// relacionamentos entre tabelas e padrões, gravados em `regras_negocio` (ver
// sql/013_regras_negocio.sql) e mantidos pelo próprio usuário na tela "Converse
// com os dados". Na v1 a recuperação é por palavras-chave (sem embeddings) —
// o volume por empresa é pequeno e a busca fica 100% previsível/rastreável.
// -----------------------------------------------------------------------------

export type KnowledgeType = 'regra_negocio' | 'metrica' | 'relacionamento' | 'padrao';

export interface KnowledgeItem {
  id: number;
  tipo: KnowledgeType;
  titulo: string;
  descricao: string;
  tabelas_relacionadas: string[];
}

const MAX_SCAN = 500;

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Radical bem simples (PT-BR): "faturamento" e "faturar" casam em "fatura". */
function stem(token: string): string {
  return token.length > 6 ? token.slice(0, 6) : token;
}

function queryStems(query: string): string[] {
  return normalize(query)
    .split(/[^a-z0-9_]+/)
    .filter((w) => w.length >= 3)
    .map(stem);
}

export async function searchKnowledge(
  idEmpresa: number,
  query: string,
  tipo?: KnowledgeType,
): Promise<{ totalAtivos: number; items: KnowledgeItem[] }> {
  let q = getSupabaseAdmin()
    .from('regras_negocio')
    .select('id, tipo, titulo, descricao, tabelas_relacionadas')
    .eq('id_empresa', idEmpresa)
    .eq('ativo', true)
    .order('id', { ascending: true })
    .limit(MAX_SCAN);
  if (tipo) q = q.eq('tipo', tipo);

  const { data, error } = await q;
  if (error) throw new Error(`Falha ao consultar a base de conhecimento: ${error.message}`);
  const rows = (data ?? []) as KnowledgeItem[];

  const stems = queryStems(query);
  if (stems.length === 0) return { totalAtivos: rows.length, items: rows.slice(0, 50) };

  const scored = rows
    .map((item) => {
      const title = normalize(item.titulo);
      const body = normalize(`${item.descricao} ${(item.tabelas_relacionadas || []).join(' ')}`);
      let score = 0;
      for (const s of stems) {
        if (title.includes(s)) score += 2;
        else if (body.includes(s)) score += 1;
      }
      return { item, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return { totalAtivos: rows.length, items: scored.slice(0, 15).map((x) => x.item) };
}

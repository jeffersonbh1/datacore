import { supabase } from './supabase';

// Base de conhecimento do agente (tabela regras_negocio, ver sql/013). O
// isolamento por empresa é feito por RLS com a sessão real do usuário; o
// id_empresa gravado vem do perfil dele.

export type KnowledgeType = 'regra_negocio' | 'metrica' | 'relacionamento' | 'padrao';

export const KNOWLEDGE_TYPE_LABEL: Record<KnowledgeType, string> = {
  regra_negocio: 'Regra de negócio',
  metrica: 'Métrica / KPI',
  relacionamento: 'Relacionamento',
  padrao: 'Padrão de modelagem',
};

export interface KnowledgeItem {
  id: number;
  tipo: KnowledgeType;
  titulo: string;
  descricao: string;
  tabelas_relacionadas: string[];
  ativo: boolean;
  criado_em: string;
}

const COLUMNS = 'id, tipo, titulo, descricao, tabelas_relacionadas, ativo, criado_em';

export async function fetchKnowledge(idEmpresa: number): Promise<KnowledgeItem[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('regras_negocio')
    .select(COLUMNS)
    .eq('id_empresa', idEmpresa)
    .order('criado_em', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as KnowledgeItem[];
}

export async function createKnowledge(
  idEmpresa: number,
  item: { tipo: KnowledgeType; titulo: string; descricao: string; tabelas_relacionadas: string[] },
): Promise<KnowledgeItem> {
  if (!supabase) throw new Error('Supabase não configurado.');
  const { data, error } = await supabase
    .from('regras_negocio')
    .insert({ id_empresa: idEmpresa, ...item })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as KnowledgeItem;
}

export async function setKnowledgeActive(id: number, ativo: boolean): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('regras_negocio').update({ ativo, atualizado_em: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteKnowledge(id: number): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('regras_negocio').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

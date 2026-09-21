import type Anthropic from '@anthropic-ai/sdk';
import { getBigQueryClient } from '../bigqueryClient';
import { piiMacroFor } from '../dbtCodegen';
import { listModels, summarizeModel, goldNamePrefix, type Layer, type TenantContext } from './catalog';
import { searchKnowledge, type KnowledgeType } from './knowledge';
import { capJson, runSelect, validateSql } from './sql';

// -----------------------------------------------------------------------------
// Ferramentas do agente. Todas somente-leitura; o agente NÃO tem ferramenta de
// escrita — salvar um modelo Gold é uma ação do usuário na tela (botão +
// confirmação), nunca uma decisão do modelo. Toda entrada é validada aqui
// (eager_input_streaming desliga a validação do lado da API).
// -----------------------------------------------------------------------------

export const AGENT_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'list_catalog',
    description:
      'Lista os modelos (tabelas) do catálogo de dados da empresa: Bronze, Silver e Gold já existentes, com dataset, sistema de origem e nº de colunas. ' +
      'Use PRIMEIRO para descobrir quais tabelas existem e para verificar se já existe um modelo Gold reaproveitável. Também devolve os datasets e o prefixo de nome dos modelos Gold.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        layer: { type: 'string', enum: ['bronze', 'silver', 'gold'], description: 'Filtra por camada (opcional).' },
        search: { type: 'string', description: 'Palavras para filtrar por nome de modelo/tabela/coluna (opcional), ex.: "pedido cliente".' },
      },
    },
  },
  {
    name: 'describe_table',
    description:
      'Descreve um modelo do catálogo: colunas com tipo real no BigQuery, descrição documentada, marcação de dado pessoal (PII) e chave primária. ' +
      'Chame antes de usar qualquer coluna num SQL — nunca presuma nomes ou tipos de colunas.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: { model: { type: 'string', description: 'Nome do modelo, exatamente como aparece em list_catalog (ex.: silver_crm_pedidos).' } },
      required: ['model'],
    },
  },
  {
    name: 'search_knowledge',
    description:
      'Busca na base de conhecimento da empresa: regras de negócio (ex.: "Faturamento considera só pedidos APROVADO"), métricas/KPIs, relacionamentos entre tabelas e padrões. ' +
      'Chame antes de modelar qualquer métrica. Se vier vazio, a regra NÃO está cadastrada — pergunte ao usuário, não invente. Se vierem regras conflitantes, exponha o conflito.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Termos do assunto, ex.: "faturamento pedidos status". Vazio lista tudo (até 50).' },
        tipo: { type: 'string', enum: ['regra_negocio', 'metrica', 'relacionamento', 'padrao'], description: 'Filtra por tipo (opcional).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'validate_sql',
    description:
      'Valida um SQL de modelo dbt contra o BigQuery SEM executá-lo (dry run): confere se tabelas e colunas existem, se a sintaxe está correta, se só toca datasets da empresa, e devolve as colunas de saída com tipos e o custo estimado. ' +
      'Aceita {{ ref(\'modelo\') }} e {{ config(...) }}. Chame sempre antes de apresentar o SQL final; se falhar, corrija e valide de novo.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: { sql: { type: 'string', description: 'SQL do modelo (pode conter {{ ref(...) }}).' } },
      required: ['sql'],
    },
  },
  {
    name: 'run_select_query',
    description:
      'Executa uma consulta SELECT somente-leitura no BigQuery e devolve as linhas — para responder perguntas sobre os dados e gerar insights com números reais. ' +
      'Restrições: um único SELECT, só tabelas bronze_/silver_/gold_ da empresa (nunca Raw), teto de bytes processados, colunas de dado pessoal vêm omitidas. ' +
      'Prefira agregar (COUNT/SUM/GROUP BY) a trazer linhas cruas. Pode usar {{ ref(\'modelo\') }} ou o nome qualificado projeto.dataset.tabela.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'Consulta SELECT em SQL padrão do BigQuery.' },
        max_rows: { type: 'integer', description: 'Máximo de linhas devolvidas (padrão 50, máximo 200).' },
      },
      required: ['sql'],
    },
  },
];

const TOOL_LABELS: Record<string, (input: Record<string, unknown>) => string> = {
  list_catalog: (i) => (i.search ? `Consultando o catálogo (“${String(i.search)}”)` : 'Consultando o catálogo de dados'),
  describe_table: (i) => `Lendo as colunas de ${String(i.model ?? 'tabela')}`,
  search_knowledge: (i) => (i.query ? `Buscando regras de negócio (“${String(i.query)}”)` : 'Listando a base de conhecimento'),
  validate_sql: () => 'Validando o SQL no BigQuery (dry run)',
  run_select_query: () => 'Executando consulta no BigQuery',
};

export const toolLabel = (name: string, input: Record<string, unknown>): string => (TOOL_LABELS[name] ? TOOL_LABELS[name](input) : name);

export interface ToolOutcome {
  /** Conteúdo devolvido ao modelo (texto/JSON). */
  content: string;
  isError: boolean;
  /** Resumo curto para a linha de progresso da tela. */
  summary: string;
}

function reqString(input: Record<string, unknown>, key: string, max = 20_000): string {
  const v = input[key];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Parâmetro "${key}" é obrigatório (texto).`);
  if (v.length > max) throw new Error(`Parâmetro "${key}" excede ${max} caracteres.`);
  return v;
}

function optEnum<T extends string>(input: Record<string, unknown>, key: string, allowed: readonly T[]): T | undefined {
  const v = input[key];
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string' || !allowed.includes(v as T)) throw new Error(`Parâmetro "${key}" deve ser um de: ${allowed.join(', ')}.`);
  return v as T;
}

const SAFE_IDENT = /^[A-Za-z0-9_-]+$/;

async function describeTable(tenant: TenantContext, name: string) {
  const model = tenant.models.get(name);
  if (!model) {
    const near = listModels(tenant, { search: name.split('_').slice(0, 3).join(' ') }).slice(0, 8).map((m) => m.name);
    throw new Error(`Modelo "${name}" não existe no catálogo da empresa.${near.length ? ` Parecidos: ${near.join(', ')}.` : ' Use list_catalog.'}`);
  }
  if (!SAFE_IDENT.test(tenant.projectId) || !SAFE_IDENT.test(model.dataset) || !SAFE_IDENT.test(model.name)) {
    throw new Error('Identificador de dataset/tabela inválido.');
  }

  const [rows] = await getBigQueryClient().query({
    query: `SELECT column_name, data_type, is_nullable
            FROM \`${tenant.projectId}.${model.dataset}\`.INFORMATION_SCHEMA.COLUMNS
            WHERE table_name = @t ORDER BY ordinal_position`,
    params: { t: model.name },
    location: process.env.DBT_GCP_LOCATION || 'southamerica-east1',
  });

  const docs = new Map(model.columns.map((c) => [c.name, c]));
  const built = rows.length > 0;
  const columns = built
    ? (rows as Array<{ column_name: string; data_type: string; is_nullable: string }>).map((r) => ({
        name: r.column_name,
        type: r.data_type,
        nullable: r.is_nullable === 'YES',
        description: docs.get(r.column_name)?.description ?? null,
        source_column: docs.get(r.column_name)?.source ?? null,
        is_pii: piiMacroFor(r.column_name) !== null,
      }))
    : model.columns.map((c) => ({
        name: c.name, type: null, nullable: null, description: c.description ?? null, source_column: c.source ?? null,
        is_pii: piiMacroFor(c.name) !== null,
      }));

  return {
    model: model.name,
    layer: model.layer,
    table: `${tenant.projectId}.${model.dataset}.${model.name}`,
    sistema: model.sistema,
    source_table: model.sourceTable ?? null,
    primary_key: model.primaryKey,
    built_in_bigquery: built,
    ...(built ? {} : { warning: 'A tabela ainda não foi construída no BigQuery — colunas vêm só da documentação dbt, sem tipos.' }),
    columns,
  };
}

/** Executa uma tool_use. Erros viram tool_result com is_error (o modelo se recupera). */
export async function executeTool(tenant: TenantContext, name: string, input: Record<string, unknown>): Promise<ToolOutcome> {
  try {
    switch (name) {
      case 'list_catalog': {
        const layer = optEnum<Layer>(input, 'layer', ['bronze', 'silver', 'gold']);
        const search = typeof input.search === 'string' ? input.search : undefined;
        const found = listModels(tenant, { layer, search });
        const shown = found.slice(0, 80);
        return {
          isError: false,
          summary: `${found.length} modelo(s)`,
          content: capJson({
            empresa: tenant.empresaNome,
            project: tenant.projectId,
            datasets: tenant.datasets,
            gold_model_name_prefix: goldNamePrefix(tenant),
            total: found.length,
            ...(found.length > shown.length ? { note: `Mostrando ${shown.length} de ${found.length}; refine com "search".` } : {}),
            models: shown.map(summarizeModel),
          }),
        };
      }
      case 'describe_table': {
        const out = await describeTable(tenant, reqString(input, 'model', 200));
        return { isError: false, summary: `${out.columns.length} coluna(s)`, content: capJson(out) };
      }
      case 'search_knowledge': {
        const tipo = optEnum<KnowledgeType>(input, 'tipo', ['regra_negocio', 'metrica', 'relacionamento', 'padrao']);
        const query = typeof input.query === 'string' ? input.query : '';
        const out = await searchKnowledge(tenant.idEmpresa, query, tipo);
        return {
          isError: false,
          summary: out.items.length ? `${out.items.length} item(ns) encontrado(s)` : 'nada cadastrado sobre isso',
          content: capJson({
            total_cadastrados_ativos: out.totalAtivos,
            encontrados: out.items.length,
            ...(out.items.length === 0 ? { aviso: 'Nenhuma regra/métrica/relacionamento cadastrado para estes termos. NÃO invente — pergunte ao usuário.' } : {}),
            itens: out.items,
          }),
        };
      }
      case 'validate_sql': {
        const result = await validateSql(tenant, reqString(input, 'sql', 100_000));
        return {
          isError: false,
          summary: result.ok === true ? 'SQL válido' : result.ok === null ? 'validação parcial (Jinja)' : 'SQL com erro',
          content: capJson(result),
        };
      }
      case 'run_select_query': {
        const raw = input.max_rows;
        const maxRows = Math.min(200, Math.max(1, typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 50));
        const out = await runSelect(tenant, reqString(input, 'sql', 100_000), maxRows);
        return {
          isError: false,
          summary: `${out.rowCount} linha(s)${out.truncated ? '+' : ''} · ${(out.bytesProcessed / 1e6).toFixed(1)} MB`,
          content: capJson(out),
        };
      }
      default:
        return { isError: true, summary: 'ferramenta desconhecida', content: `Ferramenta desconhecida: ${name}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, summary: message.slice(0, 140), content: message };
  }
}

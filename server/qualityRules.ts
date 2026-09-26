// -----------------------------------------------------------------------------
// Regras de qualidade de LINHA da camada Silver (fase 1): not_null,
// accepted_values e range. Cada regra ativa vira uma condição SQL no modelo
// Silver gerado (server/dbtCodegen.ts): a linha que viola alguma regra vai para
// a quarentena silver_<sistema>_<tabela>_rejeitados em vez da Silver.
//
// A regra entra num arquivo .sql que o dbt renderiza com Jinja — então tudo que
// vem do usuário (nome de coluna, valores, limites) é validado aqui antes de
// virar SQL: coluna só da lista real da tabela, número só finito, data só
// AAAA-MM-DD, texto escapado para literal do BigQuery e sem delimitadores Jinja.
// -----------------------------------------------------------------------------

export type QualityRuleType = 'not_null' | 'accepted_values' | 'range';

/** Família do tipo da coluna no BigQuery — decide como o literal é escrito. */
export type ColumnKind = 'string' | 'number' | 'date' | 'timestamp' | 'boolean' | 'other';

export interface QualityRuleParams {
  valores?: Array<string | number>;
  min?: number | string | null;
  max?: number | string | null;
}

/** Regra como o gerador a consome (espelho de qualidade_regras + o tipo da coluna). */
export interface QualityRuleSpec {
  id: number;
  coluna: string;
  tipo: QualityRuleType;
  parametros: QualityRuleParams;
  /** Tipo da coluna resolvido no BigQuery quando a regra foi salva. */
  tipoColuna: ColumnKind;
}

export const QUALITY_RULE_TYPES: QualityRuleType[] = ['not_null', 'accepted_values', 'range'];

const MAX_VALUES = 200;
const MAX_VALUE_LEN = 200;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Delimitadores Jinja: um valor com eles seria interpretado pelo dbt ao compilar o modelo.
const JINJA_RE = /\{\{|\}\}|\{%|%\}|\{#|#\}/;

/** Tipo do BigQuery (INFORMATION_SCHEMA.COLUMNS.data_type) -> família. */
export function columnKindFromBigQueryType(dataType: string): ColumnKind {
  const t = dataType.toUpperCase().replace(/\(.*$/, '').trim();
  if (t === 'STRING') return 'string';
  if (['INT64', 'INTEGER', 'NUMERIC', 'BIGNUMERIC', 'FLOAT64', 'FLOAT', 'DECIMAL', 'BIGDECIMAL'].includes(t)) return 'number';
  if (t === 'DATE') return 'date';
  if (t === 'TIMESTAMP' || t === 'DATETIME') return 'timestamp';
  if (t === 'BOOL' || t === 'BOOLEAN') return 'boolean';
  return 'other';
}

/** Tipos de regra que fazem sentido para a família da coluna. */
export function ruleTypesFor(kind: ColumnKind): QualityRuleType[] {
  if (kind === 'number' || kind === 'date' || kind === 'timestamp') return ['not_null', 'accepted_values', 'range'];
  if (kind === 'string') return ['not_null', 'accepted_values'];
  return ['not_null'];
}

/** Literal de texto do BigQuery, com escape de barra, aspas e quebras de linha. */
export function sqlStringLiteral(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
  return `'${escaped}'`;
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '';
}

/** Literal SQL de um valor para a família da coluna (já validado). */
function literalFor(kind: ColumnKind, value: string | number): string {
  if (kind === 'number') return String(toFiniteNumber(value));
  if (kind === 'date') return `DATE ${sqlStringLiteral(String(value))}`;
  if (kind === 'timestamp') return `TIMESTAMP ${sqlStringLiteral(String(value))}`;
  return sqlStringLiteral(String(value));
}

function validateLiteral(kind: ColumnKind, value: unknown, label: string): string | null {
  if (kind === 'number') return toFiniteNumber(value) === null ? `${label}: "${value}" não é um número.` : null;
  if (kind === 'date' || kind === 'timestamp') {
    return typeof value === 'string' && DATE_RE.test(value) && !Number.isNaN(Date.parse(value))
      ? null
      : `${label}: "${value}" não é uma data no formato AAAA-MM-DD.`;
  }
  if (typeof value !== 'string' && typeof value !== 'number') return `${label}: valor inválido.`;
  const s = String(value);
  if (s.length > MAX_VALUE_LEN) return `${label}: valor com mais de ${MAX_VALUE_LEN} caracteres.`;
  if (JINJA_RE.test(s)) return `${label}: o valor "${s}" contém uma sequência não permitida ({{, }}, {%, %}, {#, #}).`;
  // Quebra de linha escaparia do comentário "--" que lista as regras no cabeçalho do modelo.
  if (/[\x00-\x1f\x7f]/.test(s)) return `${label}: o valor contém quebra de linha ou caractere de controle.`;
  return null;
}

/**
 * Valida uma regra contra as colunas reais da tabela (nome -> família do tipo).
 * Devolve a mensagem de erro, ou null se a regra pode virar SQL.
 */
export function validateQualityRule(
  rule: { coluna: string; tipo: string; parametros?: QualityRuleParams | null },
  columns: Map<string, ColumnKind>,
): string | null {
  if (!rule.coluna || !IDENT_RE.test(rule.coluna)) return `Coluna inválida: "${rule.coluna}".`;
  const kind = columns.get(rule.coluna);
  if (!kind) return `A coluna "${rule.coluna}" não existe na tabela.`;
  if (!QUALITY_RULE_TYPES.includes(rule.tipo as QualityRuleType)) return `Tipo de regra desconhecido: "${rule.tipo}".`;
  const tipo = rule.tipo as QualityRuleType;
  if (!ruleTypesFor(kind).includes(tipo)) return `A regra "${tipo}" não se aplica à coluna "${rule.coluna}" (tipo ${kind}).`;
  const p = rule.parametros || {};

  if (tipo === 'accepted_values') {
    if (!Array.isArray(p.valores) || p.valores.length === 0) return `"${rule.coluna}": informe ao menos um valor permitido.`;
    if (p.valores.length > MAX_VALUES) return `"${rule.coluna}": no máximo ${MAX_VALUES} valores permitidos.`;
    for (const v of p.valores) {
      const err = validateLiteral(kind, v, `"${rule.coluna}"`);
      if (err) return err;
    }
  }

  if (tipo === 'range') {
    if (isEmpty(p.min) && isEmpty(p.max)) return `"${rule.coluna}": informe o mínimo, o máximo ou os dois.`;
    for (const [label, v] of [['mínimo', p.min], ['máximo', p.max]] as const) {
      if (isEmpty(v)) continue;
      const err = validateLiteral(kind, v, `"${rule.coluna}" (${label})`);
      if (err) return err;
    }
    if (!isEmpty(p.min) && !isEmpty(p.max)) {
      const a = kind === 'number' ? toFiniteNumber(p.min)! : Date.parse(String(p.min));
      const b = kind === 'number' ? toFiniteNumber(p.max)! : Date.parse(String(p.max));
      if (a > b) return `"${rule.coluna}": o mínimo é maior que o máximo.`;
    }
  }
  return null;
}

/** Só os parâmetros que a regra usa, normalizados (números como número). */
export function normalizeRuleParams(tipo: QualityRuleType, kind: ColumnKind, p: QualityRuleParams | null | undefined): QualityRuleParams {
  const params = p || {};
  if (tipo === 'accepted_values') {
    const valores = (params.valores || []).map((v) => (kind === 'number' ? toFiniteNumber(v)! : String(v)));
    return { valores: [...new Set(valores)] };
  }
  if (tipo === 'range') {
    const norm = (v: unknown) => (isEmpty(v) ? null : kind === 'number' ? toFiniteNumber(v) : String(v));
    return { min: norm(params.min), max: norm(params.max) };
  }
  return {};
}

/** Condição SQL VERDADEIRA quando a linha viola a regra. NULL só viola not_null:
 *  nas outras, a comparação com NULL dá NULL e o IF() cai no ramo "sem motivo". */
export function ruleViolationSql(rule: QualityRuleSpec): string {
  const col = `\`${rule.coluna}\``;
  const kind = rule.tipoColuna;
  const p = rule.parametros || {};
  if (rule.tipo === 'not_null') return `${col} IS NULL`;
  if (rule.tipo === 'accepted_values') {
    return `${col} NOT IN (${(p.valores || []).map((v) => literalFor(kind, v)).join(', ')})`;
  }
  const parts: string[] = [];
  if (!isEmpty(p.min)) parts.push(`${col} < ${literalFor(kind, p.min as string | number)}`);
  if (!isEmpty(p.max)) parts.push(`${col} > ${literalFor(kind, p.max as string | number)}`);
  return parts.length === 1 ? parts[0] : `(${parts.join(' OR ')})`;
}

/** Descrição curta da regra (tela, log e texto gravado na quarentena). */
export function describeQualityRule(rule: Pick<QualityRuleSpec, 'coluna' | 'tipo' | 'parametros'>): string {
  const p = rule.parametros || {};
  if (rule.tipo === 'not_null') return `${rule.coluna} obrigatório`;
  if (rule.tipo === 'accepted_values') return `${rule.coluna} fora dos valores permitidos (${(p.valores || []).join(', ')})`;
  const min = isEmpty(p.min) ? null : p.min;
  const max = isEmpty(p.max) ? null : p.max;
  if (min !== null && max !== null) return `${rule.coluna} fora da faixa ${min} a ${max}`;
  if (min !== null) return `${rule.coluna} abaixo do mínimo ${min}`;
  return `${rule.coluna} acima do máximo ${max}`;
}

/** Texto gravado em _motivos_rejeicao: "r<id>: <descrição>". O id é o que a
 *  contagem por motivo usa (parseRuleIdFromMotivo). */
export function motivoText(rule: QualityRuleSpec): string {
  return `r${rule.id}: ${describeQualityRule(rule)}`;
}

export function parseRuleIdFromMotivo(motivo: string): number | null {
  const m = /^r(\d+):/.exec(motivo);
  return m ? Number(m[1]) : null;
}

/** Expressão ARRAY<STRING> com os motivos de rejeição da linha (vazia = linha válida). */
export function motivosArraySql(rules: QualityRuleSpec[], indent = '        '): string {
  const items = rules.map((r) => {
    const text = motivoText(r);
    // O texto vai dentro de um .sql renderizado pelo Jinja: sem delimitadores Jinja.
    const safe = sqlStringLiteral(text.replace(/[{}]/g, ''));
    return `${indent}    IF(${ruleViolationSql(r)}, [${safe}], [])`;
  });
  return `${indent}ARRAY_CONCAT(\n${items.join(',\n')}\n${indent})`;
}

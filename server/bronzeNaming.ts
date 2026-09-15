// -----------------------------------------------------------------------------
// Padronização de nomes de campo da camada Bronze.
//
// Implementa a convenção descrita em `docs/CONVENCAO_NOMENCLATURA_BRONZE.md`:
// todo campo de negócio recebe um prefixo que expressa seu tipo (des_, vlr_,
// ind_, qtd_, dat_, dth_, cod_, id_, num_, per_, tp_, uf_, json_); se o nome
// original já contém a palavra que expressa esse tipo, ela é REMOVIDA (nunca
// duplicada) e o prefixo assume o lugar dela.
//
// É uma heurística sobre o NOME da coluna — o discovery do Airbyte não traz o
// tipo de dado da coluna (ver docs/ARQUITETURA.md, seção 10), então não há como
// decidir com certeza entre, por exemplo, "data" (dat_) e "timestamp" (dth_)
// quando o nome não deixa isso claro. Onde o texto da convenção deixa a regra
// em aberto (tradução padrão de termos como "status"/"type"/"flag" — ver
// "Pontos em aberto" no documento), esta implementação usa um valor provisório
// e documentado; ela não decide silenciosamente algo que o documento marca como
// pendente.
//
// Importante: esta função só se aplica às COLUNAS DE NEGÓCIO selecionadas na
// integração (`IntegrationTableSpec.columns`). As colunas técnicas que o
// gerador acrescenta por conta própria (`dt_ingestao_lake`, `_dbt_loaded_at`)
// não passam por aqui — são a "marca d'água" de pipeline que o próprio
// documento reserva para o sufixo `_at`.
// -----------------------------------------------------------------------------

export type BronzePrefix = 'des' | 'vlr' | 'ind' | 'qtd' | 'dat' | 'dth' | 'cod' | 'id' | 'num' | 'per' | 'tp' | 'uf' | 'json';

/** Contexto usado só no caso-limite de o nome não sobrar nada após a remoção
 *  da palavra redundante (regra 5 da convenção) — ex.: coluna chamada só
 *  "descricao" ou só "id". Sem um dicionário de negócio por tabela, o melhor
 *  contexto disponível é o próprio nome da tabela/stream. */
export interface StandardizeContext {
  tableName?: string;
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Tokeniza um nome de coluna: camelCase -> snake_case, minúsculas, sem
 *  acento, separado por qualquer caractere não alfanumérico. */
function tokenize(raw: string): string[] {
  const snake = raw.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
  const clean = stripAccents(snake.toLowerCase());
  return clean.split(/[^a-z0-9]+/).filter(Boolean);
}

/** Singular ingênuo (só para o fallback de contexto) — cobre os plurais mais
 *  comuns do português (-ões -> -ão, -ns -> -m, -s -> nada) além do "-s" do
 *  inglês. Não trata irregulares; é só um "melhor esforço" para casos como
 *  coluna "id" isolada numa tabela "clientes" -> "id_cliente", ou
 *  "integracoes" -> "integracao" (não "integracoe", que um strip ingênuo de
 *  "-s" produziria). */
function naiveSingular(token: string): string {
  if (token.length > 4 && token.endsWith('oes')) return `${token.slice(0, -3)}ao`;
  // "-ens" -> "-em" é o plural nasal do português (origem/origens,
  // viagem/viagens) — restrito a "ens" (não o "ns" genérico) para não pegar
  // palavras em inglês que só por coincidência terminam em "ns" (ex.: "runs").
  if (token.length > 4 && token.endsWith('ens')) return `${token.slice(0, -3)}em`;
  if (token.length > 3 && token.endsWith('s')) return token.slice(0, -1);
  return token;
}

// --- dicionário de tradução (best-effort, ver nota no topo do arquivo) ------
// Cobre termos recorrentes em fontes em inglês (CRM/e-commerce/pessoas).
// Token sem entrada aqui é mantido como está — não é erro, é o comportamento
// documentado até haver um glossário oficial (ponto em aberto da convenção).
const EN_PT: Record<string, string> = {
  name: 'nome', first: 'primeiro', last: 'ultimo', middle: 'meio', full: 'completo',
  email: 'email', phone: 'telefone', mobile: 'celular', fax: 'fax',
  address: 'endereco', street: 'rua', city: 'cidade', state: 'estado', country: 'pais',
  zip: 'cep', zipcode: 'cep', postal: 'postal',
  customer: 'cliente', supplier: 'fornecedor', vendor: 'fornecedor', company: 'empresa',
  user: 'usuario', owner: 'responsavel', employee: 'funcionario',
  product: 'produto', item: 'item', order: 'pedido', invoice: 'fatura', payment: 'pagamento',
  discount: 'desconto', tax: 'imposto', shipping: 'frete', total: 'total', subtotal: 'subtotal',
  balance: 'saldo', price: 'preco', cost: 'custo', fee: 'taxa',
  created: 'criacao', updated: 'atualizacao', deleted: 'exclusao', modified: 'alteracao',
  started: 'inicio', finished: 'fim', completed: 'conclusao', built: 'construcao', synced: 'sincronizacao',
  birth: 'nascimento', expiration: 'expiracao', expiry: 'expiracao', due: 'vencimento',
  document: 'documento', reference: 'referencia', notes: 'notas', comment: 'comentario',
  category: 'categoria', department: 'departamento', role: 'papel', title: 'titulo',
  source: 'origem', destination: 'destino', target: 'destino', channel: 'canal',
  error: 'erro', message: 'mensagem', reason: 'motivo', description: 'descricao',
  version: 'versao', duration: 'duracao', attempt: 'tentativa', retry: 'tentativa',
  record: 'registro', records: 'registros', row: 'linha', rows: 'linhas',
  amount: 'valor', currency: 'moeda', method: 'metodo',
};

function translateToken(token: string): string {
  return EN_PT[token] ?? token;
}

// Tradução dedicada para o caso (b) do booleano (adjetivo isolado, sem palavra
// auxiliar) — usa a forma adjetiva em PT, não a forma nominal de EN_PT (que
// existe para outros contextos, ex.: "deleted_at" -> "dth_exclusao").
const BOOL_ADJ_PT: Record<string, string> = {
  active: 'ativo', inactive: 'inativo', deleted: 'deletado', removed: 'removido',
  enabled: 'habilitado', disabled: 'desabilitado', blocked: 'bloqueado', approved: 'aprovado',
  paid: 'pago', cancelled: 'cancelado', canceled: 'cancelado', synced: 'sincronizado',
  validated: 'validado', verified: 'verificado', required: 'obrigatorio', optional: 'opcional',
  public: 'publico', private: 'privado', default: 'padrao', primary: 'principal', valid: 'valido',
  expired: 'expirado', archived: 'arquivado', hidden: 'oculto', visible: 'visivel', locked: 'bloqueado',
};

function translateBoolToken(token: string): string {
  return BOOL_ADJ_PT[token] ?? translateToken(token);
}

// --- palavras que expressam o TIPO (removidas, nunca duplicadas) -----------
// Cada lista já inclui o próprio prefixo/sigla, para que aplicar a função a um
// nome já padronizado seja idempotente (ex.: "vlr_total" continua "vlr_total").
const DATETIME_MARKERS = new Set(['datahora', 'timestamp', 'datetime', 'dth']);
const DATE_MARKERS = new Set(['data', 'date', 'dt', 'dat']);
// "_em"/"_at" no fim do nome é o idiomatismo comum (PT/EN) para timestamp de
// evento de negócio (ex.: "criado_em", "created_at") — não confundir com o
// sufixo técnico `_at` que a convenção reserva para a marca d'água do próprio
// pipeline (loaded_at/extracted_at), que nunca passa por esta função.
const DATETIME_TRAILING = new Set(['em', 'at']);
const PERCENT_MARKERS = new Set(['percentual', 'percentagem', 'percent', 'percentage', 'pct', 'per']);
const MONEY_MARKERS = new Set(['valor', 'value', 'preco', 'price', 'montante', 'amount', 'vlr']);
const QUANTITY_MARKERS = new Set(['quantidade', 'quantity', 'qtd', 'qty']);
const NUMBER_MARKERS = new Set(['numero', 'number', 'nro', 'num', 'nr']);
const TYPE_MARKERS = new Set(['tipo', 'type', 'categoria', 'category', 'tp']);
const CODE_MARKERS = new Set(['codigo', 'code', 'cod']);
const JSON_MARKERS = new Set(['json', 'metadata', 'payload', 'variant', 'var']);
const DESCRIPTIVE_MARKERS = new Set(['descricao', 'description', 'desc', 'obs', 'observacao', 'observation', 'des']);

// Booleano: dois jeitos de reconhecer.
// (a) palavra AUXILIAR (removida) — "is_deleted", "pode_editar", "ind_ativo".
const BOOL_AUX_MARKERS = new Set(['is', 'has', 'pode', 'possui', 'permite', 'tem', 'flag', 'indicador', 'ind', 'bool', 'boolean']);
// (b) ADJETIVO conhecido — a palavra em si já é o conteúdo relevante e fica
// (traduzida), só ganha o prefixo: "active" -> "ind_ativo", "deleted" -> "ind_deletado".
const BOOL_ADJECTIVES = new Set([
  'ativo', 'ativa', 'inativo', 'inativa', 'deletado', 'deletada', 'excluido', 'excluida',
  'removido', 'removida', 'habilitado', 'habilitada', 'desabilitado', 'desabilitada',
  'bloqueado', 'bloqueada', 'aprovado', 'aprovada', 'pago', 'paga', 'cancelado', 'cancelada',
  'sincronizado', 'sincronizada', 'validado', 'validada', 'verificado', 'verificada',
  'obrigatorio', 'obrigatoria', 'opcional', 'publico', 'publica', 'privado', 'privada',
  'principal', 'padrao', 'valido', 'valida', 'expirado', 'expirada', 'arquivado', 'arquivada',
  'oculto', 'oculta', 'visivel', 'bloqueada',
  'active', 'inactive', 'deleted', 'removed', 'enabled', 'disabled', 'blocked', 'approved',
  'paid', 'cancelled', 'canceled', 'synced', 'validated', 'verified', 'required', 'optional',
  'public', 'private', 'default', 'primary', 'valid', 'expired', 'archived', 'hidden', 'visible', 'locked',
]);

interface Classification {
  prefix: BronzePrefix;
  tokens: string[];
}

/** Remove a 1ª ocorrência de um token pertencente a `set`; retorna null se nenhum token bater. */
function removeFirst(tokens: string[], set: Set<string>): string[] | null {
  const idx = tokens.findIndex((t) => set.has(t));
  if (idx === -1) return null;
  return [...tokens.slice(0, idx), ...tokens.slice(idx + 1)];
}

function classify(tokens: string[]): Classification {
  // 1) booleano — auxiliar removido tem prioridade (permite idempotência de
  // nomes como "ind_cadastro_ativo": remove só o "ind", mantém "ativo").
  const boolAux = removeFirst(tokens, BOOL_AUX_MARKERS);
  if (boolAux) return { prefix: 'ind', tokens: boolAux };
  // Só classifica pelo adjetivo isolado quando TODOS os tokens são adjetivos
  // booleanos conhecidos (ex.: "active", "ativo_padrao") — exigir isso evita
  // falso positivo em nomes como "records_synced" (uma contagem, não um flag)
  // onde só uma palavra do meio por acaso é um adjetivo da lista.
  if (tokens.every((t) => BOOL_ADJECTIVES.has(t))) return { prefix: 'ind', tokens };

  // 2) data e hora (timestamp) — combinação data+hora, marcador dedicado, ou
  // final "_em"/"_at" (idiomatismo de timestamp de evento de negócio).
  if (tokens.includes('data') && tokens.includes('hora')) {
    const t1 = removeFirst(tokens, new Set(['data']))!;
    const t2 = removeFirst(t1, new Set(['hora']))!;
    return { prefix: 'dth', tokens: t2 };
  }
  if (tokens.includes('date') && tokens.includes('time')) {
    const t1 = removeFirst(tokens, new Set(['date']))!;
    const t2 = removeFirst(t1, new Set(['time']))!;
    return { prefix: 'dth', tokens: t2 };
  }
  const dth = removeFirst(tokens, DATETIME_MARKERS);
  if (dth) return { prefix: 'dth', tokens: dth };
  if (tokens.length > 1 && DATETIME_TRAILING.has(tokens[tokens.length - 1])) {
    return { prefix: 'dth', tokens: tokens.slice(0, -1) };
  }

  // 3) data (sem hora) — sem marcador de hora, mais conservador (ver nota no
  // topo: "dt_"/"data_" isolado vira dat_ por padrão, na dúvida).
  const dat = removeFirst(tokens, DATE_MARKERS);
  if (dat) return { prefix: 'dat', tokens: dat };

  // 4) percentual
  const per = removeFirst(tokens, PERCENT_MARKERS);
  if (per) return { prefix: 'per', tokens: per };

  // 5) valor monetário/decimal
  const vlr = removeFirst(tokens, MONEY_MARKERS);
  if (vlr) return { prefix: 'vlr', tokens: vlr };

  // 6) quantidade
  const qtd = removeFirst(tokens, QUANTITY_MARKERS);
  if (qtd) return { prefix: 'qtd', tokens: qtd };

  // 7) número genérico
  const num = removeFirst(tokens, NUMBER_MARKERS);
  if (num) return { prefix: 'num', tokens: num };

  // 8) tipo/categoria (enum de negócio)
  const tp = removeFirst(tokens, TYPE_MARKERS);
  if (tp) return { prefix: 'tp', tokens: tp };

  // 9) código de negócio
  const cod = removeFirst(tokens, CODE_MARKERS);
  if (cod) return { prefix: 'cod', tokens: cod };

  // 10) chave técnica/surrogate — token "id" isolado, em qualquer posição
  // (reordena para prefixo: "cliente_id" e "id_cliente" chegam ao mesmo lugar).
  const id = removeFirst(tokens, new Set(['id']));
  if (id) return { prefix: 'id', tokens: id };

  // 11) UF / sigla curta e fixa
  const uf = removeFirst(tokens, new Set(['uf']));
  if (uf) return { prefix: 'uf', tokens: uf };

  // 12) semi-estruturado (JSON/variant)
  const json = removeFirst(tokens, JSON_MARKERS);
  if (json) return { prefix: 'json', tokens: json };

  // 13) default — texto descritivo. Remove a palavra "descrição"/"desc" se
  // houver; senão o nome inteiro é o conteúdo (ex.: "nome" -> "des_nome").
  const des = removeFirst(tokens, DESCRIPTIVE_MARKERS);
  return { prefix: 'des', tokens: des ?? tokens };
}

/** Padroniza um único nome de coluna. Ver regras completas em
 *  `docs/CONVENCAO_NOMENCLATURA_BRONZE.md`. */
export function standardizeColumnName(original: string, ctx: StandardizeContext = {}): string {
  const tokens = tokenize(original);
  if (tokens.length === 0) return original;

  const { prefix, tokens: remaining } = classify(tokens);
  let finalTokens = remaining.map(prefix === 'ind' ? translateBoolToken : translateToken);

  // Regra 5 da convenção: nada sobrou com sentido próprio (ex.: coluna
  // chamada só "descricao" ou só "id") — usa o nome da tabela como contexto.
  if (finalTokens.length === 0) {
    const ctxTokens = tokenize(ctx.tableName || '').map(translateToken).map(naiveSingular);
    finalTokens = ctxTokens.length > 0 ? ctxTokens : ['campo'];
  }

  return `${prefix}_${finalTokens.join('_')}`;
}

/** Padroniza todas as colunas de uma tabela, resolvendo colisões (duas
 *  colunas de origem diferentes que caiam no mesmo nome padronizado) com um
 *  sufixo numérico — nunca gera SQL com alias duplicado. */
export function buildColumnRenameMap(columns: string[], tableName?: string): Map<string, string> {
  const used = new Set<string>();
  const map = new Map<string, string>();
  for (const col of columns) {
    const base = standardizeColumnName(col, { tableName });
    let candidate = base;
    let n = 2;
    while (used.has(candidate)) candidate = `${base}_${n++}`;
    used.add(candidate);
    map.set(col, candidate);
  }
  return map;
}

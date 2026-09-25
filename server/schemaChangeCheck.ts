import { airbyteConfigFetch } from './airbyteClient';
import { getSupabaseAdmin } from './supabaseAdmin';

// -----------------------------------------------------------------------------
// Detecção de mudança de schema na origem de uma integração (sql/016).
//
// A cada verificação o Airbyte consulta a origem de novo (discover_schema sem
// cache) e o resultado é comparado com a última "foto" guardada em
// integracoes.schema_snapshot. Cada diferença vira um alerta em
// alertas_ingestao (tipo 'mudanca_schema'), exibido na tela Pipelines & Fluxos.
// A primeira verificação de uma integração só grava a foto (não há com o que
// comparar). Chamado pelo Studio a cada "Executar" com sincronização e pelo
// botão "Verificar agora" do modal de alertas.
//
// Tabelas que NÃO fazem parte da integração só geram alerta quando aparecem ou
// somem da origem — mudança de coluna nelas seria ruído.
//
// Mudanças que podem quebrar as camadas seguintes (tipo alterado, coluna
// removida, chave primária alterada, tabela integrada removida) geram alerta
// BLOQUEANTE (sql/017): enquanto ele estiver aberto, Bronze/Silver/Gold da
// tabela não são atualizados (ver fetchBlockedTables).
// -----------------------------------------------------------------------------

/** Frase final de todo alerta bloqueante — deixa claro que as demais camadas não foram atualizadas. */
export const BLOCK_NOTE =
  ' ATUALIZAÇÃO BLOQUEADA: enquanto este alerta estiver aberto, a Bronze, a Silver e o Gold desta tabela NÃO são atualizados — continuam com os dados da última carga que deu certo. Depois de corrigir, marque este alerta como ciente/resolvido para liberar a atualização.';

/** { tabela: { columns: { coluna: tipo }, pk: [coluna] } } */
export type SchemaSnapshot = Record<string, { columns: Record<string, string>; pk: string[] }>;

interface DiscoveredStream {
  stream?: {
    name?: string;
    jsonSchema?: { properties?: Record<string, JsonSchemaProp> };
    sourceDefinedPrimaryKey?: string[][];
  };
}

interface JsonSchemaProp {
  type?: string | string[];
  format?: string;
  airbyte_type?: string;
}

export interface SchemaAlert {
  categoria: 'tabela_nova' | 'tabela_removida' | 'coluna_nova' | 'coluna_removida' | 'tipo_alterado' | 'chave_alterada';
  severidade: 'critica' | 'alta' | 'media' | 'info';
  mensagem: string;
  detalhe: string | null;
  tabela: string;
  /** true = bloqueia a atualização da tabela nas camadas seguintes até ser resolvido. */
  bloqueante: boolean;
}

export interface SchemaCheckResult {
  /** true na primeira verificação: a foto foi gravada, sem alertas. */
  baseline: boolean;
  alerts: SchemaAlert[];
  verificadoEm: string;
}

function typeOf(p: JsonSchemaProp | undefined): string {
  if (!p) return 'desconhecido';
  const types = (Array.isArray(p.type) ? p.type : p.type ? [p.type] : []).filter((t) => t !== 'null');
  const base = types.join('|') || 'desconhecido';
  const extra = p.airbyte_type || p.format;
  return extra ? `${base}(${extra})` : base;
}

async function discoverSnapshot(sourceId: string): Promise<SchemaSnapshot> {
  const res = await airbyteConfigFetch<{ catalog?: { streams?: DiscoveredStream[] }; jobInfo?: { succeeded?: boolean } }>(
    '/sources/discover_schema',
    { sourceId, disable_cache: true },
  );
  const streams = res.catalog?.streams;
  if (!streams) throw new Error('O Airbyte não devolveu o catálogo da origem (descoberta falhou).');
  const snap: SchemaSnapshot = {};
  for (const s of streams) {
    const name = s.stream?.name;
    if (!name) continue;
    const columns: Record<string, string> = {};
    for (const [col, prop] of Object.entries(s.stream?.jsonSchema?.properties || {})) columns[col] = typeOf(prop);
    snap[name] = { columns, pk: (s.stream?.sourceDefinedPrimaryKey || []).map((p) => p.join('.')) };
  }
  return snap;
}

const list = (xs: string[]) => xs.join(', ');

export function diffSnapshots(before: SchemaSnapshot, after: SchemaSnapshot, integrated: Set<string>): SchemaAlert[] {
  const alerts: SchemaAlert[] = [];

  for (const table of Object.keys(after)) {
    if (!before[table]) {
      alerts.push({
        categoria: 'tabela_nova',
        severidade: 'info',
        mensagem: `Tabela nova na origem: ${table}. Ela não é sincronizada até ser incluída na integração (Pipelines & Fluxos → Editar).`,
        detalhe: `Colunas: ${list(Object.keys(after[table].columns))}`,
        tabela: table,
        bloqueante: false,
      });
    }
  }

  for (const table of Object.keys(before)) {
    const isIntegrated = integrated.has(table);
    const old = before[table];
    const cur = after[table];

    if (!cur) {
      alerts.push({
        categoria: 'tabela_removida',
        severidade: isIntegrated ? 'critica' : 'info',
        mensagem: isIntegrated
          ? `A tabela integrada ${table} não existe mais na origem — a sincronização dela vai falhar. Remova-a da integração (Pipelines & Fluxos → Editar).${BLOCK_NOTE}`
          : `A tabela ${table} (não integrada) não existe mais na origem.`,
        detalhe: null,
        tabela: table,
        bloqueante: isIntegrated,
      });
      continue;
    }
    if (!isIntegrated) continue;

    const added = Object.keys(cur.columns).filter((c) => !(c in old.columns));
    const removed = Object.keys(old.columns).filter((c) => !(c in cur.columns));
    const changed = Object.keys(cur.columns).filter((c) => c in old.columns && old.columns[c] !== cur.columns[c]);

    if (added.length) {
      alerts.push({
        categoria: 'coluna_nova',
        severidade: 'media',
        mensagem: `Coluna(s) nova(s) em ${table}: ${list(added)}. O Airbyte leva para a Raw automaticamente; a Bronze não as inclui até o modelo dbt da tabela ser regerado. Não bloqueia a atualização.`,
        detalhe: added.map((c) => `${c}: ${cur.columns[c]}`).join('\n'),
        tabela: table,
        bloqueante: false,
      });
    }
    if (removed.length) {
      alerts.push({
        categoria: 'coluna_removida',
        severidade: 'alta',
        mensagem: `Coluna(s) removida(s) em ${table}: ${list(removed)}. A Raw recebe a mudança; a Bronze e as camadas seguintes podem falhar ou passar a receber valores vazios nessas colunas. Revise o modelo dbt da tabela e o que depende dessas colunas.${BLOCK_NOTE}`,
        detalhe: removed.map((c) => `${c}: ${old.columns[c]}`).join('\n'),
        tabela: table,
        bloqueante: true,
      });
    }
    if (changed.length) {
      alerts.push({
        categoria: 'tipo_alterado',
        severidade: 'alta',
        mensagem: `Tipo de coluna alterado em ${table}: ${list(changed)}. A Raw recebe a mudança; a construção da Bronze pode falhar ou converter valores de forma errada. Revise o modelo dbt e, ao liberar, execute a tabela com "Do zero".${BLOCK_NOTE}`,
        detalhe: changed.map((c) => `${c}: ${old.columns[c]} → ${cur.columns[c]}`).join('\n'),
        tabela: table,
        bloqueante: true,
      });
    }
    if (list(old.pk) !== list(cur.pk)) {
      alerts.push({
        categoria: 'chave_alterada',
        severidade: 'critica',
        mensagem: `A chave primária de ${table} mudou. Mudança incompatível: o Airbyte bloqueia a conexão até o schema ser revisto na conexão do Airbyte; depois regenere os modelos dbt e, ao liberar, execute com "Do zero".${BLOCK_NOTE}`,
        detalhe: `Antes: ${list(old.pk) || '(nenhuma)'}\nDepois: ${list(cur.pk) || '(nenhuma)'}`,
        tabela: table,
        bloqueante: true,
      });
    }
  }
  return alerts;
}

/** Verifica o schema da origem da integração ligada à conexão, grava os alertas e a nova foto. */
export async function checkSchemaChanges(connectionId: string): Promise<SchemaCheckResult> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('integracoes')
    .select('id, id_empresa, nome, tabelas_selecionadas, schema_snapshot, origens(airbyte_source_id)')
    .eq('airbyte_connection_id', connectionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Nenhuma integração com airbyte_connection_id="${connectionId}".`);

  const origem = Array.isArray(data.origens) ? data.origens[0] : data.origens;
  const sourceId = (origem as { airbyte_source_id?: string } | null)?.airbyte_source_id;
  if (!sourceId) throw new Error('Integração sem origem no Airbyte.');

  const after = await discoverSnapshot(sourceId);
  const before = data.schema_snapshot as SchemaSnapshot | null;
  const verificadoEm = new Date().toISOString();
  const alerts = before ? diffSnapshots(before, after, new Set((data.tabelas_selecionadas as string[]) || [])) : [];

  if (alerts.length) {
    const { error: insertError } = await supabase.from('alertas_ingestao').insert(
      alerts.map((a) => ({
        id_empresa: data.id_empresa,
        integracao_id: data.id,
        integracao_nome: data.nome,
        tipo: 'mudanca_schema',
        categoria: a.categoria,
        severidade: a.severidade,
        mensagem: a.mensagem,
        detalhe: a.detalhe,
        tabela: a.tabela,
        bloqueante: a.bloqueante,
      })),
    );
    // Sem gravar os alertas, a foto NÃO é atualizada — a próxima verificação tenta de novo.
    if (insertError) throw new Error(`Falha ao gravar os alertas de schema: ${insertError.message}`);
  }

  const { error: updateError } = await supabase
    .from('integracoes')
    .update({ schema_snapshot: after, schema_verificado_em: verificadoEm })
    .eq('id', data.id);
  if (updateError) throw new Error(`Falha ao gravar a foto do schema: ${updateError.message}`);

  return { baseline: !before, alerts, verificadoEm };
}

/**
 * Tabelas bloqueadas de uma integração: as que têm alerta bloqueante em aberto
 * (sql/017). Mapa tabela → motivo (mensagem do alerta mais recente).
 */
export async function fetchBlockedTables(integracaoId: number): Promise<Map<string, string>> {
  const { data, error } = await getSupabaseAdmin()
    .from('alertas_ingestao')
    .select('tabela, mensagem')
    .eq('integracao_id', integracaoId)
    .eq('bloqueante', true)
    .is('resolvido_em', null)
    .order('criado_em', { ascending: false });
  if (error) throw new Error(`Falha ao consultar os bloqueios da integração: ${error.message}`);
  const out = new Map<string, string>();
  for (const r of data || []) if (r.tabela && !out.has(r.tabela)) out.set(r.tabela, r.mensagem);
  return out;
}

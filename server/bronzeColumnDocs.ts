import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMap, isScalar, isSeq, parseDocument, YAMLSeq } from 'yaml';
import { BRONZE_MANIFEST_FILE, bronzeModelName, sistemaSlug, type BronzeManifest } from './dbtCodegen';
import { resolveDbtProjectDir } from './dbtRunner';

// -----------------------------------------------------------------------------
// Descrições de coluna do Dicionário de Dados Raw (Hub de Governança & LGPD)
// vivem no MESMO _properties.yml que server/dbtCodegen.ts já gera por sistema
// (dbt/models/medallion/bronze/<sistema>/_properties.yml) — não num arquivo à
// parte. O manifesto dbt/_generated_bronze.json dá o mapeamento coluna raw
// (origem) -> coluna padronizada (Bronze); a descrição em si é lida/gravada
// direto no .yml via a API de Document da lib `yaml`, editando só o campo
// `description` daquela coluna e preservando o resto do arquivo (comentários,
// formatação, outros modelos) — bem diferente da regeração total que
// writeIntegrationModels faz.
// -----------------------------------------------------------------------------

function readBronzeManifest(): BronzeManifest {
  const path = join(resolveDbtProjectDir(), BRONZE_MANIFEST_FILE);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as BronzeManifest;
  } catch {
    return {};
  }
}

function propertiesPath(sistema: string): string {
  return join(resolveDbtProjectDir(), 'models', 'medallion', 'bronze', sistemaSlug(sistema), '_properties.yml');
}

/** Nome padronizado (Bronze) de uma coluna raw, via o mapeamento origem ->
 *  padronizado gravado no manifesto (ver server/dbtCodegen.ts::resolveColumnDocs).
 *  Quando a coluna não foi selecionada para a Bronze deste sistema — caso das
 *  colunas de controle do Airbyte (_airbyte_raw_id, _airbyte_meta, etc.) e de
 *  colunas raw não escolhidas na integração — documenta sob o próprio nome
 *  raw: TODA coluna vista no Dicionário de Dados deve poder ser documentada,
 *  não só as que a Bronze já padronizou. */
export function standardizedColumnName(sistema: string, table: string, rawColumn: string): string {
  const manifest = readBronzeManifest();
  const model = manifest[sistemaSlug(sistema)]?.[bronzeModelName(sistema, table)];
  return model?.columns.find((c) => c.source === rawColumn)?.name ?? rawColumn;
}

/** Descrições atuais de todas as colunas do modelo Bronze desta tabela, lidas
 *  do _properties.yml de verdade (não do manifesto JSON, que só guarda o
 *  mapeamento origem->padronizado — a descrição pode ter sido editada depois
 *  de gerado). Chave: nome PADRONIZADO da coluna. */
export function readBronzeColumnDescriptions(sistema: string, table: string): Map<string, string> {
  const result = new Map<string, string>();
  const path = propertiesPath(sistema);
  if (!existsSync(path)) return result;

  const doc = parseDocument(readFileSync(path, 'utf8'));
  const models = doc.get('models');
  if (!isSeq(models)) return result;

  const modelName = bronzeModelName(sistema, table);
  const modelItem = models.items.find((item) => isMap(item) && item.get('name') === modelName);
  if (!modelItem || !isMap(modelItem)) return result;

  const columns = modelItem.get('columns');
  if (!isSeq(columns)) return result;

  for (const colItem of columns.items) {
    if (!isMap(colItem)) continue;
    const name = colItem.get('name');
    const description = colItem.get('description');
    if (typeof name === 'string' && typeof description === 'string') result.set(name, description);
  }
  return result;
}

/**
 * Grava a descrição de uma coluna raw no _properties.yml Bronze do sistema —
 * localiza o modelo `bronze_<sistema>_<table>` e, dentro dele, a coluna
 * padronizada correspondente. Se a coluna ainda não estiver documentada ali
 * (colunas de controle do Airbyte, ou raw não selecionadas para a Bronze),
 * cria a entrada — TODA coluna do Dicionário de Dados deve poder ganhar uma
 * descrição, não só as que a Bronze já padronizou. Quando a coluna já existe,
 * muta o Scalar do `description` (em vez de reconstruir o mapa) para
 * preservar o resto do arquivo praticamente byte-a-byte — é um arquivo
 * comitado e também regenerado por inteiro sempre que a integração é
 * recriada/resincronizada.
 */
export function writeBronzeColumnDescription(
  sistema: string,
  table: string,
  rawColumn: string,
  description: string,
): { standardizedName: string } {
  const standardizedName = standardizedColumnName(sistema, table, rawColumn);

  const path = propertiesPath(sistema);
  if (!existsSync(path)) {
    throw new Error(`_properties.yml não encontrado para o sistema "${sistema}" (${path}).`);
  }

  const doc = parseDocument(readFileSync(path, 'utf8'));
  const models = doc.get('models');
  if (!isSeq(models)) throw new Error(`_properties.yml do sistema "${sistema}" não tem a estrutura esperada (models: [...]).`);

  const modelName = bronzeModelName(sistema, table);
  const modelItem = models.items.find((item) => isMap(item) && item.get('name') === modelName);
  if (!modelItem || !isMap(modelItem)) {
    throw new Error(`Modelo "${modelName}" não encontrado em ${path} — gere os modelos da integração antes de documentar suas colunas.`);
  }

  const existingColumns = modelItem.get('columns');
  const columns: YAMLSeq = isSeq(existingColumns) ? existingColumns : new YAMLSeq(doc.schema);
  if (!isSeq(existingColumns)) modelItem.set('columns', columns);

  const columnItem = columns.items.find((item) => isMap(item) && item.get('name') === standardizedName);
  if (columnItem && isMap(columnItem)) {
    const descNode = columnItem.get('description', true);
    if (isScalar(descNode)) {
      descNode.value = description;
    } else {
      columnItem.set('description', description);
    }
  } else {
    columns.items.push(doc.createNode({ name: standardizedName, description }));
  }

  // flowCollectionPadding: false casa com o estilo já usado no arquivo gerado
  // (`data_tests: [unique, not_null]`, sem espaço após "[").  Sem isso, o
  // stringifier da lib `yaml` reformata TODA sequência flow do arquivo
  // (`[ unique, not_null ]`) mesmo fora do campo editado — um diff enorme e
  // irrelevante num arquivo comitado só porque uma descrição mudou.
  writeFileSync(path, doc.toString({ flowCollectionPadding: false }), 'utf8');
  return { standardizedName };
}

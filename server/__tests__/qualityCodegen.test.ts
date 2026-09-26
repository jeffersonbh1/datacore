// Testes do gerador da Silver com regras de qualidade (fase 1).
// Rodar: npm run server:test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { renderSilverRejeitadosSql, renderSilverSql, type SilverModelInput } from '../dbtCodegen';
import {
  motivosArraySql, normalizeRuleParams, parseRuleIdFromMotivo, ruleViolationSql, sqlStringLiteral,
  validateQualityRule, type ColumnKind, type QualityRuleSpec,
} from '../qualityRules';

const SILVER_DIR = join(import.meta.dirname, '..', '..', 'dbt', 'models', 'medallion', 'silver');
const readModel = (path: string) => readFileSync(join(SILVER_DIR, path), 'utf8').replace(/\r\n/g, '\n');

const agendamentos: SilverModelInput = {
  sistema: 'arena fahel beach', table: 'agendamentos', pk: ['id_agendamento'], incremental: false, regras: [],
};
const usuarios: SilverModelInput = {
  sistema: 'salesforce', table: 'usuarios', pk: ['id_usuario'], incremental: true, regras: [],
};

const regras: QualityRuleSpec[] = [
  { id: 1, coluna: 'dat_agendamento', tipo: 'not_null', parametros: {}, tipoColuna: 'date' },
  { id: 2, coluna: 'vlr_total', tipo: 'range', parametros: { min: 0 }, tipoColuna: 'number' },
  { id: 3, coluna: 'des_status_pagamento', tipo: 'accepted_values', parametros: { valores: ['PAGO', "D'ÁGUA"] }, tipoColuna: 'string' },
];

const columns = new Map<string, ColumnKind>([
  ['dat_agendamento', 'date'], ['vlr_total', 'number'], ['des_status_pagamento', 'string'], ['ind_ativo', 'boolean'],
]);

test('sem regras: Silver table idêntica ao modelo já gerado hoje', () => {
  assert.equal(renderSilverSql(agendamentos), readModel('arena_fahel_beach/silver_arena_fahel_beach_agendamentos.sql'));
});

test('sem regras: Silver incremental idêntica ao modelo já gerado hoje', () => {
  assert.equal(renderSilverSql(usuarios), readModel('salesforce/silver_salesforce_usuarios.sql'));
});

test('com regras (table): Silver só com linhas sem motivo e mesmas colunas', () => {
  const sql = renderSilverSql({ ...agendamentos, regras });
  assert.match(sql, /materialized = 'table'/);
  assert.match(sql, /SELECT \* EXCEPT \(_motivos_rejeicao\)\nFROM validado\nWHERE ARRAY_LENGTH\(_motivos_rejeicao\) = 0/);
  assert.match(sql, /IF\(`dat_agendamento` IS NULL, \['r1: dat_agendamento obrigatório'\], \[\]\)/);
  assert.match(sql, /IF\(`vlr_total` < 0, \['r2: vlr_total abaixo do mínimo 0'\], \[\]\)/);
  assert.match(sql, /`des_status_pagamento` NOT IN \('PAGO', 'D\\'ÁGUA'\)/);
  assert.doesNotMatch(sql, /post_hook/);
  assert.doesNotMatch(sql, /max_dat_carga_qualidade/);
});

test('com regras (table): quarentena append, sem full refresh, com retenção de 90 dias', () => {
  const sql = renderSilverRejeitadosSql({ ...agendamentos, regras });
  assert.match(sql, /materialized = 'incremental'/);
  assert.match(sql, /alias = 'silver_arena_fahel_beach_agendamentos_rejeitados'/);
  assert.match(sql, /full_refresh = false/);
  assert.match(sql, /INTERVAL 90 DAY/);
  assert.match(sql, /'\{\{ invocation_id \}\}' AS _id_execucao/);
  assert.match(sql, /WHERE ARRAY_LENGTH\(_motivos_rejeicao\) > 0/);
  // Silver table revalida a Bronze inteira a cada execução: sem marca d'água.
  assert.doesNotMatch(sql, /v_max_dat_carga/);
});

test('com regras (incremental): marca d\'água soma a quarentena e post_hook remove chaves rejeitadas', () => {
  const sql = renderSilverSql({ ...usuarios, regras: [{ id: 9, coluna: 'des_email', tipo: 'not_null', parametros: {}, tipoColuna: 'string' }] });
  assert.match(sql, /-- depends_on: \{\{ ref\('silver_salesforce_usuarios_rejeitados'\) \}\}/);
  assert.match(sql, /max_dat_carga_qualidade\(this, ref\('silver_salesforce_usuarios_rejeitados'\)\)/);
  assert.match(sql, /post_hook = \["DELETE FROM \{\{ this \}\} AS s WHERE EXISTS .*r\.id_usuario = s\.id_usuario\)"\]/);
  assert.match(sql, /WHERE _dat_carga > TIMESTAMP/);

  const rej = renderSilverRejeitadosSql({ ...usuarios, regras: [{ id: 9, coluna: 'des_email', tipo: 'not_null', parametros: {}, tipoColuna: 'string' }] });
  assert.match(rej, /\{% if not flags\.FULL_REFRESH %\}/);
  assert.match(rej, /adapter\.get_relation\(this\.database, this\.schema, 'silver_salesforce_usuarios'\)/);
});

test('PK composta no post_hook da Silver incremental', () => {
  const sql = renderSilverSql({ ...usuarios, pk: ['id_a', 'id_b'], regras: [{ id: 1, coluna: 'x', tipo: 'not_null', parametros: {}, tipoColuna: 'string' }] });
  assert.match(sql, /r\.id_a = s\.id_a AND r\.id_b = s\.id_b/);
});

test('semântica de NULL: só not_null testa IS NULL', () => {
  assert.equal(ruleViolationSql(regras[0]), '`dat_agendamento` IS NULL');
  assert.equal(ruleViolationSql(regras[1]), '`vlr_total` < 0');
  assert.equal(ruleViolationSql({ ...regras[1], parametros: { min: 0, max: 100 } }), '(`vlr_total` < 0 OR `vlr_total` > 100)');
  assert.equal(
    ruleViolationSql({ id: 4, coluna: 'dat_agendamento', tipo: 'range', parametros: { min: '2020-01-01' }, tipoColuna: 'date' }),
    "`dat_agendamento` < DATE '2020-01-01'",
  );
});

test('escape de literal do BigQuery', () => {
  assert.equal(sqlStringLiteral("D'ÁGUA"), "'D\\'ÁGUA'");
  assert.equal(sqlStringLiteral('a\\b'), "'a\\\\b'");
});

test('validação: coluna inexistente, tipo incompatível, valores inválidos', () => {
  assert.equal(validateQualityRule({ coluna: 'dat_agendamento', tipo: 'not_null' }, columns), null);
  assert.match(validateQualityRule({ coluna: 'nao_existe', tipo: 'not_null' }, columns)!, /não existe/);
  assert.match(validateQualityRule({ coluna: 'x; DROP', tipo: 'not_null' }, columns)!, /Coluna inválida/);
  assert.match(validateQualityRule({ coluna: 'ind_ativo', tipo: 'range', parametros: { min: 0 } }, columns)!, /não se aplica/);
  assert.match(validateQualityRule({ coluna: 'vlr_total', tipo: 'range', parametros: {} }, columns)!, /mínimo, o máximo/);
  assert.match(validateQualityRule({ coluna: 'vlr_total', tipo: 'range', parametros: { min: 'abc' } }, columns)!, /não é um número/);
  assert.match(validateQualityRule({ coluna: 'vlr_total', tipo: 'range', parametros: { min: 10, max: 1 } }, columns)!, /mínimo é maior/);
  assert.match(validateQualityRule({ coluna: 'dat_agendamento', tipo: 'range', parametros: { min: '01/02/2020' } }, columns)!, /AAAA-MM-DD/);
  assert.match(validateQualityRule({ coluna: 'des_status_pagamento', tipo: 'accepted_values', parametros: { valores: [] } }, columns)!, /ao menos um/);
});

test('validação: bloqueia Jinja e quebra de linha em valores', () => {
  const jinja = validateQualityRule({ coluna: 'des_status_pagamento', tipo: 'accepted_values', parametros: { valores: ["{{ run_query('x') }}"] } }, columns);
  assert.match(jinja!, /sequência não permitida/);
  const newline = validateQualityRule({ coluna: 'des_status_pagamento', tipo: 'accepted_values', parametros: { valores: ['a\n-- x'] } }, columns);
  assert.match(newline!, /quebra de linha/);
});

test('motivo: id da regra recuperável do texto gravado na quarentena', () => {
  assert.equal(parseRuleIdFromMotivo('r42: vlr_total abaixo do mínimo 0'), 42);
  assert.equal(parseRuleIdFromMotivo('outra coisa'), null);
  assert.match(motivosArraySql(regras), /^ {8}ARRAY_CONCAT\(\n/);
});

test('normalização dos parâmetros', () => {
  assert.deepEqual(normalizeRuleParams('range', 'number', { min: '5', max: '' }), { min: 5, max: null });
  assert.deepEqual(normalizeRuleParams('accepted_values', 'string', { valores: ['A', 'A', 'B'] }), { valores: ['A', 'B'] });
  assert.deepEqual(normalizeRuleParams('not_null', 'string', { valores: ['x'] }), {});
});

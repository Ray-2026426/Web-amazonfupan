import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../utils/metrics.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { metricValue, METRICS } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const current = { gross_profit: 240, sales_amount: 1200, ad_spend: 180, ad_sales: 600, refund_cost: 36, sales_quantity: 12, sessions: 240 };

test('core ratios use the shared definitions', () => {
  assert.equal(metricValue('gross_margin', { current }), 0.2);
  assert.equal(metricValue('ad_share', { current }), 0.15);
  assert.equal(metricValue('acos', { current }), 0.3);
  assert.equal(metricValue('refund_rate', { current }), 0.03);
  assert.equal(metricValue('conversion_rate', { current }), 0.05);
  assert.equal(metricValue('avg_ticket', { current }), 100);
});

test('missing denominators remain unknown rather than zero', () => {
  const empty = { ...current, sales_amount: 0, ad_sales: 0, sessions: 0 };
  assert.equal(metricValue('gross_margin', { current: empty }), null);
  assert.equal(metricValue('acos', { current: empty }), null);
  assert.equal(metricValue('conversion_rate', { current: empty }), null);
});

test('aged inventory share uses costs over 180 days', () => {
  const inventory = { fba_total_cost: 1000, age_181_270_cost: 100, age_271_330_cost: 50, age_331_365_cost: 25, age_365_plus_cost: 25 };
  assert.equal(metricValue('aged_inventory_share', { current, inventory }), 0.2);
  assert.match(METRICS.acos.definition, /广告销售额/);
});

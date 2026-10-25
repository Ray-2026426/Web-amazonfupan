import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../utils/diagnosticRadar.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { buildRadarReport } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

/** 造一个只含用到的字段的聚合结果 */
const agg = (patch = {}) => ({
  sales_quantity: 1000,
  sales_amount: 100000,
  gross_profit: 20000,
  sessions: 20000,
  ad_spend: 10000,
  ad_sales: 30000,
  ad_orders: 300,
  natural_orders: 700,
  natural_clicks: 3000,
  impressions: 500000,
  clicks: 5000,
  first_mile_cost: 8000,
  procurement_cost: 30000,
  storage_fee: 2000,
  fba_fee: 10000,
  refund_cost: 3000,
  platform_commission: 15000,
  fba_sellable_qty: 5000,
  average_rating: 4.5,
  review_count: 200,
  ...patch,
});

const target = { gross_profit: 20000, sales_amount: 100000 };

test('毛利额达成、同比、环比都正常时不出诊断', () => {
  const report = buildRadarReport({
    current: agg(),
    last: agg({ gross_profit: 19500 }),
    year: agg({ gross_profit: 19000 }),
    target,
  });
  assert.equal(report.core.anomalous, false);
  assert.equal(report.findings.length, 0);
  assert.ok(report.normalNotes.length > 0);
});

test('达成率不足 90% 时触发诊断，并能定位到销量下滑', () => {
  // 销量 -30%，Sessions -30%，转化率保持不变 → 应判为「流量驱动」
  const report = buildRadarReport({
    current: agg({ gross_profit: 12000, sales_quantity: 700, sessions: 14000 }),
    last: agg(),
    year: null,
    target,
  });
  assert.equal(report.core.anomalous, true);
  const traffic = report.findings.find((item) => item.id === 'volume-traffic');
  assert.ok(traffic, '应识别出流量驱动的销量下滑');
  assert.equal(traffic.dimension, 'volume');
  assert.match(traffic.path.join(' › '), /销量/);
  assert.ok(traffic.action.length > 10);
});

test('毛利率下滑时按成本占比排序，采购占比上升能定位到采购', () => {
  const report = buildRadarReport({
    current: agg({ gross_profit: 12000, procurement_cost: 40000 }),
    last: agg(),
    year: null,
    target,
  });
  const margin = report.findings.filter((item) => item.dimension === 'margin');
  assert.ok(margin.length > 0);
  assert.equal(margin[0].id, 'margin-procurement_cost');
  assert.match(margin[0].title, /采购成本/);
});

test('没有上期与去年同期时不做同比/环比判断', () => {
  const report = buildRadarReport({ current: agg({ gross_profit: 5000 }), last: null, year: null, target: null });
  assert.equal(report.core.yoy, null);
  assert.equal(report.core.mom, null);
  assert.equal(report.core.attainment, null);
});

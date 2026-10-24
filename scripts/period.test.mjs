import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../utils.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const utils = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const emptyFilters = {
  startDate: '',
  endDate: '',
  countries: [],
  shops: [],
  brands: [],
  managers: [],
  subCategories: [],
  parentAsins: [],
  childAsins: [],
  productNames: [],
};

const target = (month, sales) => ({
  month,
  country: '美国',
  brand: 'B',
  manager: 'M',
  shop_name: 'S',
  sub_category: '',
  parent_asin: '',
  child_asin: '',
  product_name: '',
  sales_quantity_target: 0,
  sales_amount_target: sales,
  gross_profit_target: 0,
  ad_spend_target: 0,
});

test('periodKeyOf buckets a date by the selected granularity', () => {
  assert.equal(utils.periodKeyOf('2026-10-23', 'day'), '2026-10-23');
  assert.equal(utils.periodKeyOf('2026-10-23', 'week'), '2026-W43');
  assert.equal(utils.periodKeyOf('2026-10-23', 'month'), '2026-10');
  // 同一天在各粒度下必须落在同一个桶，日粒度不能被截断成月
  assert.equal(utils.periodKeyOf('2026-10-01', 'day'), '2026-10-01');
  assert.equal(utils.periodKeyOf('2026-10-31', 'day'), '2026-10-31');
});

test('period labels describe the unit used by the dashboard', () => {
  assert.equal(utils.periodUnitLabel('day'), '天');
  assert.equal(utils.periodUnitLabel('week'), '周');
  assert.equal(utils.periodUnitLabel('month'), '个月');
  assert.equal(utils.periodModeName('day'), '日度');
  assert.equal(utils.periodModeShort('week'), '周');
  assert.equal(utils.periodCompareLabel('day', 'mom'), '日环');
  assert.equal(utils.periodCompareLabel('day', 'yoy'), '日同');
  assert.equal(utils.periodCompareLabel('month', 'mom'), '环');
});

test('a single day gets its share of the monthly target', () => {
  // 2026-10 有 31 天，月目标 310 → 单日目标 10
  const oneDay = utils.getDailyAllocatedTarget([target('2026-10', 310)], new Date(2026, 9, 23), new Date(2026, 9, 23), emptyFilters);
  assert.equal(oneDay.sales_amount, 10);
});

test('a day range spanning two months prorates each month separately', () => {
  // 10-31 一天（10 月 31 天，310/31 = 10）+ 11-01（11 月 30 天，300/30 = 10）
  const rows = utils.getDailyAllocatedTarget(
    [target('2026-10', 310), target('2026-11', 300)],
    new Date(2026, 9, 31),
    new Date(2026, 10, 1),
    emptyFilters,
  );
  assert.equal(rows.sales_amount, 20);
});

test('a month range still returns the whole monthly target', () => {
  const targets = [target('2026-10', 310)];
  const month = utils.getTargetForSelection(targets, new Date(2026, 9, 1), new Date(2026, 9, 31), emptyFilters, 1);
  assert.equal(month.sales_amount, 310);
});

test('daily target grouping gives each date its own share', () => {
  const targets = [target('2026-10', 310)];
  const byDate = utils.groupAllocatedTargetsByDimension(
    targets,
    ['year_month'],
    new Date(2026, 9, 22),
    new Date(2026, 9, 23),
    'day',
  );
  assert.equal(byDate.get('2026-10-22').sales_amount, 10);
  assert.equal(byDate.get('2026-10-23').sales_amount, 10);
  // 键必须与业绩行的聚合键一致，否则明细里目标列会消失
  assert.equal(utils.periodKeyOf('2026-10-23', 'day'), '2026-10-23');
});

test('daily target grouping without a date dimension sums the whole range', () => {
  const targets = [target('2026-10', 310)];
  const total = utils.groupAllocatedTargetsByDimension(
    targets,
    ['country'],
    new Date(2026, 9, 22),
    new Date(2026, 9, 23),
    'day',
  );
  assert.equal(total.get('美国').sales_amount, 20);
});

test('weekly target grouping still allocates by natural week', () => {
  const targets = [target('2026-10', 310)];
  const byWeek = utils.groupAllocatedTargetsByDimension(
    targets,
    ['year_month'],
    new Date(2026, 9, 19),
    new Date(2026, 9, 25),
    'week',
  );
  // 2026-10-19 起的自然周跨 7 天，每天 10
  const week = byWeek.get(utils.periodKeyOf('2026-10-19', 'week'));
  assert.equal(week.sales_amount, 70);
});

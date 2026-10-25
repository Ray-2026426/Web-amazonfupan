import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../dailyExport.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { DAILY_EXPORT_COLUMNS, dailyCsvHeader, dailyCsvRows, dailyExportMatrix } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

/** 业务方《项目业绩-月维度.xlsx》第 3~49 列，顺序也必须一致 */
const REFERENCE_FIELDS = [
  'ASIN', '父ASIN', '店铺', '国家', '负责人', '品名', '二级分类', '品牌',
  '销量', '销售额', '订单量', '退款金额', '评分', '评论数', '订单毛利润',
  'FBA-可售', 'Sessions-Total', 'CVR', '销量CVR',
  '广告花费', 'SP广告费', 'SD广告费', 'SB广告费', 'SBV广告费',
  '广告销售额', 'SP广告销售额', 'SD广告销售额', 'SB广告销售额', 'SBV广告销售额',
  '广告订单量', '展示', '点击', 'CTR', '广告CVR', 'CPC', 'ROAS', 'ACOS', 'ACoAS', 'ASoAS',
  '自然点击量', '自然订单量', '自然CVR',
  '头程费用', 'FBA费用', '仓储费用', '采购费用', '佣金费用',
];

const titles = DAILY_EXPORT_COLUMNS.map(([, title]) => title);

test('导出列与参考表字段名、顺序一致', () => {
  // 日期/年份/月份 是日粒度下的时间前缀，其余 47 列必须逐字对齐参考表
  assert.deepEqual(titles.slice(3, 50), REFERENCE_FIELDS);
  assert.deepEqual(titles.slice(0, 3), ['日期', '年份', '月份']);
  // 参考表没有的列放在最后，不影响前面的位置
  assert.deepEqual(titles.slice(50), ['FBA国际运费', '修正后毛利', '店铺ID', '币种']);
  assert.equal(titles.length, 54);
});

test('时间列由日期派生，写法与参考表一致', () => {
  const rows = [{ date: '2026-01-05', asin: 'B0001' }];
  const matrix = dailyExportMatrix(rows);
  assert.deepEqual(matrix[0].slice(0, 3), ['日期', '年份', '月份']);
  assert.deepEqual(matrix[1].slice(0, 3), ['2026-01-05', '2026年', '1月']);
});

test('比率列按当日分子分母现算，分母为 0 时留空', () => {
  const rows = [{
    date: '2026-10-23', sessions: 800, order_quantity: 100, sales_quantity: 120,
    impressions: 10000, clicks: 200, ad_orders: 20, ad_spend: 60, ad_sales: 300,
    sales_amount: 1200, natural_clicks: 50, natural_orders: 5,
  }];
  const header = dailyExportMatrix(rows)[0];
  const values = dailyExportMatrix(rows)[1];
  const get = (name) => values[header.indexOf(name)];
  assert.equal(get('CVR'), 0.125);
  assert.equal(get('销量CVR'), 0.15);
  assert.equal(get('CTR'), 0.02);
  assert.equal(get('广告CVR'), 0.1);
  assert.equal(get('CPC'), 0.3);
  assert.equal(get('ROAS'), 5);
  assert.equal(get('ACOS'), 0.2);
  assert.equal(get('ACoAS'), 0.05);
  assert.equal(get('ASoAS'), 0.25);
  assert.equal(get('自然CVR'), 0.1);

  const empty = dailyExportMatrix([{ date: '2026-10-23', sessions: 0 }])[1];
  const emptyGet = (name) => empty[header.indexOf(name)];
  assert.equal(emptyGet('CVR'), '');
  assert.equal(emptyGet('CPC'), '');
});

test('CSV 表头与行顺序和 Excel 一致', () => {
  const header = dailyCsvHeader().trim().split(',');
  assert.deepEqual(header, titles);
  const csv = dailyCsvRows([{ date: '2026-10-23', asin: 'B0001', sales_amount: 100, sessions: 10, order_quantity: 2 }]).trim();
  const cells = csv.split(',');
  assert.equal(cells[0], '2026-10-23');
  assert.equal(cells[1], '2026年');
  assert.equal(cells[2], '10月');
  assert.equal(cells[header.indexOf('销售额')], '100');
  assert.equal(cells[header.indexOf('CVR')], '0.2');
});

test('修正后毛利 = 原毛利 + FBA 国际运费绝对值', () => {
  const matrix = dailyExportMatrix([{ date: '2026-10-01', gross_profit: 100, fba_international_fee: -20 }]);
  const header = matrix[0];
  const row = matrix[1];
  assert.equal(row[header.indexOf('订单毛利润')], 100);
  assert.equal(row[header.indexOf('FBA国际运费')], -20);
  assert.equal(row[header.indexOf('修正后毛利')], 120);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { toDataRow, validateSnapshot } from './mapper.mjs';
import { authorized, isValidDate, rowsForRange, splitRange } from '../../serverless/supabase.js';

test('Lingxing product name comes from price_list, not Amazon title', () => {
  const row = toDataRow({
    date: '2026-10-18', shop: { id: 1, name: '店铺', country: '美国' },
    row: {
      asin: 'B001', item_name: 'Long Amazon listing title',
      price_list: [{ volume: 1, local_name: '小号' }, { volume: 5, local_name: '大号' }],
      categories: ['B-GJ工具\\A戒指尺\\戒指测量'], amount: 100,
    },
  });
  assert.equal(row.product_name, '大号');
  assert.equal(row.sub_category, 'A戒指尺');
  assert.equal(row.sales_amount, 100);
});

test('failed shop queries reject a publishable snapshot', () => {
  const result = validateSnapshot({
    dailyRows: [{ shop_name: '店铺', sales_amount: 100, gross_profit: 20 }],
    rawPPRows: 1, shops: [{ id: 1 }], dates: ['2026-10-18'], currency: 'USD', failedShopCalls: 1,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(','), /店铺查询失败/);
});

test('long ranges keep partial months at daily grain', () => {
  assert.deepEqual(splitRange('2026-01-15', '2026-03-20'), [
    { granularity: 'day', from: '2026-01-15', to: '2026-01-31' },
    { granularity: 'month', from: '2026-02-01', to: '2026-02-28' },
    { granularity: 'day', from: '2026-03-01', to: '2026-03-20' },
  ]);
  assert.equal(isValidDate('2026-02-30'), false);
});

test('cloud read queries use bounded dates and keep the database key server-side', async () => {
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SECRET_KEY;
  const oldToken = process.env.DASHBOARD_READ_TOKEN;
  const calls = [];
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test-only';
  process.env.DASHBOARD_READ_TOKEN = 'read-only-token-long-enough';
  globalThis.fetch = async (url, options) => {
    calls.push({ url: new URL(url), options });
    return { ok: true, json: async () => [] };
  };
  try {
    assert.equal(authorized({ headers: { authorization: 'Bearer read-only-token-long-enough' } }), true);
    assert.equal(authorized({ headers: { authorization: 'Bearer wrong' } }), false);
    await rowsForRange('2026-10-01', '2026-10-18');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].url.searchParams.getAll('date'), ['gte.2026-10-01', 'lte.2026-10-18']);
    assert.equal(calls[0].options.headers.apikey, 'sb_secret_test-only');
    assert.equal(calls[0].options.headers.Authorization, undefined);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = oldKey;
    if (oldToken === undefined) delete process.env.DASHBOARD_READ_TOKEN; else process.env.DASHBOARD_READ_TOKEN = oldToken;
  }
});

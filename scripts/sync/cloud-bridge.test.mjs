import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FIELD_PATHS, mergeOrderProfit, resolveField, toDataRow, validateSnapshot } from './mapper.mjs';
import { authorized, isValidDate, rowsForRange, splitRange } from '../../serverless/supabase.js';
import adminHandler from '../../api/admin.js';
import exportHandler from '../../api/export.js';
import targetsHandler from '../../api/targets.js';

test('默认字段映射：品名取 price_list 里销量最大的 local_name，二级分类取第 2 段', () => {
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

test('映射路径解析支持数组、下标、层级与按销量取最大', () => {
  const row = {
    asin: 'B001',
    brands: ['品牌A'],
    parent_asins: [{ parent_asin: 'B0PARENT' }],
    seller_store_countries: [{ seller_name: '美国店', country: '美国' }],
    price_list: [{ volume: 1, local_name: '小号' }, { volume: 9, local_name: '大号' }],
    categories: ['B-工具\\A分类\\细分'],
  };
  assert.equal(resolveField(row, 'brands[]'), '品牌A');
  assert.equal(resolveField(row, 'parent_asins[].parent_asin'), 'B0PARENT');
  assert.equal(resolveField(row, 'seller_store_countries[0].country'), '美国');
  assert.equal(resolveField(row, 'price_list[].local_name@max(volume)'), '大号');
  assert.equal(resolveField(row, 'categories[]@level(2)'), 'A分类');
  assert.equal(resolveField(row, 'not_exists[]'), '');
  // 默认映射覆盖 8 个字段，且引用的正是上面这些路径
  assert.deepEqual(Object.keys(DEFAULT_FIELD_PATHS).sort(), ['asin', 'brand', 'country', 'manager', 'parent_asin', 'product_name', 'shop_name', 'sub_category']);
});

test('云端字段映射改变下一次同步的取值', () => {
  const fieldMap = new Map([
    ['product_name', 'item_name'],
    ['brand', 'brands[]'],
  ]);
  const data = toDataRow({
    date: '2026-10-18', shop: { id: 7, name: '店铺' },
    row: {
      asin: 'B007', item_name: '用 Amazon 标题当品名', brands: ['新品牌'],
      price_list: [{ volume: 1, local_name: '原来的品名' }], amount: 50,
    },
    fieldMap,
  });
  assert.equal(data.product_name, '用 Amazon 标题当品名');
  assert.equal(data.brand, '新品牌');
});

test('成本按 sid|asin 归并，不再依赖已下线的成本匹配规则', () => {
  const costs = mergeOrderProfit([{
    sids: [7], price_list: [{ local_sku: 'SKU-1', asin: 'B000000007' }], gross_profit: 23,
  }]);
  assert.equal(costs.get('7|B000000007').gross_profit, 23);
  const data = toDataRow({
    date: '2026-10-18', shop: { id: 7, name: '店铺' },
    row: { asin: 'B000000007', amount: 50 }, cost: costs.get('7|B000000007'),
  });
  assert.equal(data.gross_profit, 23);
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

test('admin API requires its own password and saves a field mapping server-side', async () => {
  const oldFetch = globalThis.fetch;
  const oldAdmin = process.env.DASHBOARD_ADMIN_TOKEN;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SECRET_KEY;
  const calls = [];
  process.env.DASHBOARD_ADMIN_TOKEN = 'separate-admin-token-long-enough';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test-only';
  globalThis.fetch = async (url, options) => {
    calls.push({ url: new URL(url), options });
    return { ok: true, status: 204, text: async () => '' };
  };
  const response = () => ({
    code: 200, body: null,
    setHeader() { return this; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  });
  try {
    const denied = response();
    await adminHandler({ method: 'POST', headers: { authorization: 'Bearer wrong' }, body: { action: 'settings' } }, denied);
    assert.equal(denied.code, 401);
    assert.equal(calls.length, 0);
    const allowed = response();
    await adminHandler({ method: 'POST', headers: { authorization: 'Bearer separate-admin-token-long-enough' }, body: { action: 'field_mapping', web_field: 'product_name', export_label: '品名', lingxing_field: 'item_name' } }, allowed);
    assert.equal(allowed.code, 200);
    assert.equal(calls[0].url.pathname, '/rest/v1/field_mappings');
    assert.equal(calls[0].options.headers.apikey, 'sb_secret_test-only');
    assert.equal(JSON.parse(calls[0].options.body).lingxing_field, 'item_name');
    const rejected = response();
    await adminHandler({ method: 'POST', headers: { authorization: 'Bearer separate-admin-token-long-enough' }, body: { action: 'field_mapping', web_field: 'not_a_field', export_label: 'x', lingxing_field: 'y' } }, rejected);
    assert.equal(rejected.code, 400);
  } finally {
    globalThis.fetch = oldFetch;
    for (const [name, value] of [['DASHBOARD_ADMIN_TOKEN', oldAdmin], ['SUPABASE_URL', oldUrl], ['SUPABASE_SECRET_KEY', oldKey]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test('target upload remains staged until all rows are received and activation is requested', async () => {
  const oldFetch = globalThis.fetch;
  const oldAdmin = process.env.DASHBOARD_ADMIN_TOKEN;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SECRET_KEY;
  const calls = [];
  process.env.DASHBOARD_ADMIN_TOKEN = 'separate-admin-token-long-enough';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test-only';
  globalThis.fetch = async (url, options = {}) => {
    const target = new URL(url);
    calls.push({ target, options });
    if (target.pathname.endsWith('/target_imports') && options.method !== 'POST') {
      const rows = target.searchParams.get('offset') === '0' ? [{ id: target.searchParams.get('id')?.slice(3), status: 'staging', expected_rows: 1 }] : [];
      return { ok: true, json: async () => rows };
    }
    return { ok: true, status: 204, text: async () => '' };
  };
  const response = () => ({ code: 200, body: null, setHeader() { return this; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
  const auth = { authorization: 'Bearer separate-admin-token-long-enough' };
  try {
    const start = response();
    await adminHandler({ method: 'POST', headers: auth, body: { action: 'targets_start', source_filename: '目标.xlsx', expected_rows: 1 } }, start);
    assert.equal(start.code, 200);
    assert.match(start.body.import_id, /^[0-9a-f-]{36}$/);
    const batch = response();
    await adminHandler({ method: 'POST', headers: auth, body: { action: 'targets_batch', import_id: start.body.import_id, rows: [{ row_no: 0, payload: { month: '2026-10', shop_name: '店铺', sales_amount_target: 100 } }] } }, batch);
    assert.equal(batch.code, 200);
    assert.equal(calls.find(call => call.target.pathname.endsWith('/target_rows')).options.method, 'POST');
    const activate = response();
    await adminHandler({ method: 'POST', headers: auth, body: { action: 'targets_activate', import_id: start.body.import_id } }, activate);
    assert.equal(activate.code, 200);
    assert.equal(calls.at(-1).target.pathname, '/rest/v1/rpc/activate_target_import');
  } finally {
    globalThis.fetch = oldFetch;
    for (const [name, value] of [['DASHBOARD_ADMIN_TOKEN', oldAdmin], ['SUPABASE_URL', oldUrl], ['SUPABASE_SECRET_KEY', oldKey]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test('daily export and target reads require separate passwords and paginate by date', async () => {
  const oldFetch = globalThis.fetch;
  const oldAdmin = process.env.DASHBOARD_ADMIN_TOKEN;
  const oldRead = process.env.DASHBOARD_READ_TOKEN;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SECRET_KEY;
  const calls = [];
  process.env.DASHBOARD_ADMIN_TOKEN = 'separate-admin-token-long-enough';
  process.env.DASHBOARD_READ_TOKEN = 'read-only-token-long-enough';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test-only';
  globalThis.fetch = async (url) => {
    const target = new URL(url);
    calls.push(target);
    if (target.pathname.endsWith('/target_imports')) return { ok: true, json: async () => target.searchParams.get('offset') === '0' ? [{ id: '00000000-0000-4000-8000-000000000001' }] : [] };
    if (target.pathname.endsWith('/target_rows')) return { ok: true, json: async () => [{ payload: { month: '2026-10', sales_amount_target: 100 } }] };
    return { ok: true, json: async () => [{ date: '2026-10-19', sales_amount: 50 }] };
  };
  const response = () => ({ code: 200, body: null, setHeader() { return this; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
  try {
    const invalid = response();
    await exportHandler({ method: 'GET', headers: { authorization: 'Bearer separate-admin-token-long-enough' }, url: '/api/export?from=2026-09-01&to=2026-10-19' }, invalid);
    assert.equal(invalid.code, 400);
    assert.equal(calls.length, 0);
    const daily = response();
    await exportHandler({ method: 'GET', headers: { authorization: 'Bearer separate-admin-token-long-enough' }, url: '/api/export?from=2026-10-19&to=2026-10-19' }, daily);
    assert.equal(daily.code, 200);
    assert.equal(daily.body.rows.length, 1);
    assert.deepEqual(calls[0].searchParams.getAll('date'), ['gte.2026-10-19', 'lte.2026-10-19']);
    const targets = response();
    await targetsHandler({ method: 'GET', headers: { authorization: 'Bearer read-only-token-long-enough' }, url: '/api/targets?from=2026-10&to=2026-10&offset=0' }, targets);
    assert.equal(targets.code, 200);
    assert.equal(targets.body.rows[0].sales_amount_target, 100);
  } finally {
    globalThis.fetch = oldFetch;
    for (const [name, value] of [['DASHBOARD_ADMIN_TOKEN', oldAdmin], ['DASHBOARD_READ_TOKEN', oldRead], ['SUPABASE_URL', oldUrl], ['SUPABASE_SECRET_KEY', oldKey]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

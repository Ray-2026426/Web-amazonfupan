import { respond } from '../serverless/supabase.js';

/**
 * 区间聚合（服务端算好再返回），支持维度筛选条件下推。
 *
 * GET /api/aggregate?from=2026-10-01&to=2026-10-31
 *      &compareFrom=…&compareTo=…&yearFrom=…&yearTo=…
 *      &brand=A,B&shop=店1&country=美国&manager=张三&sub=厨房&pasin=B0…&pname=品名
 *
 * 返回 { current, last, year }，每个是 fact_daily 的合计值（几十字节）。
 */
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const FILTER_KEYS = {
  country: 'countries',
  shop: 'shops',
  brand: 'brands',
  manager: 'managers',
  sub: 'subCategories',
  pasin: 'parentAsins',
  pname: 'productNames',
};

function parseFilters(url) {
  const filters = {};
  for (const [param, field] of Object.entries(FILTER_KEYS)) {
    const raw = url.searchParams.get(param);
    if (!raw) continue;
    const values = raw.split(',').map(item => item.trim()).filter(Boolean);
    if (values.length) filters[field] = values;
  }
  return filters;
}

async function rpcAggregate(from, to, filters) {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!base || !key) throw new Error('缺少 Supabase 配置');
  const response = await fetch(`${base}/rest/v1/rpc/aggregate_range_f`, {
    method: 'POST',
    headers: {
      apikey: key,
      'Content-Type': 'application/json',
      ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({ p_from: from, p_to: to, p_filters: filters }),
  });
  if (!response.ok) {
    const text = (await response.text()).slice(0, 200);
    throw Object.assign(new Error(`聚合失败（请确认已执行最新 db/schema.sql）：${text}`), { status: 400 });
  }
  const payload = await response.json();
  return payload && typeof payload === 'object' ? payload : null;
}

export default function handler(req, res) {
  return respond(req, res, async () => {
    const url = new URL(req.url || '/', 'https://localhost');
    const from = url.searchParams.get('from') || '';
    const to = url.searchParams.get('to') || '';
    if (!ISO.test(from) || !ISO.test(to)) {
      return res.status(400).json({ error: 'invalid_range', message: 'from/to 需要 YYYY-MM-DD' });
    }
    const compareFrom = url.searchParams.get('compareFrom') || '';
    const compareTo = url.searchParams.get('compareTo') || '';
    const yearFrom = url.searchParams.get('yearFrom') || '';
    const yearTo = url.searchParams.get('yearTo') || '';
    const filters = parseFilters(url);

    const [current, last, year] = await Promise.all([
      rpcAggregate(from, to, filters),
      ISO.test(compareFrom) && ISO.test(compareTo) ? rpcAggregate(compareFrom, compareTo, filters).catch(() => null) : null,
      ISO.test(yearFrom) && ISO.test(yearTo) ? rpcAggregate(yearFrom, yearTo, filters).catch(() => null) : null,
    ]);

    if (!current) return res.status(502).json({ error: 'aggregate_unavailable' });
    return res.status(200).json({ from, to, current, last, year, filters });
  });
}

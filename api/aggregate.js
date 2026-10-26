import { respond } from '../serverless/supabase.js';

/**
 * 区间聚合（服务端算好再返回）。
 *
 * GET /api/aggregate?from=2026-10-01&to=2026-10-31
 *      &compareFrom=2026-09-01&compareTo=2026-09-30
 *      &yearFrom=2025-10-01&yearTo=2025-10-31
 *
 * 返回 { current, last, year }，每个是 fact_daily 的合计值（几十字节）。
 * 首屏用它在 100ms 内画出 KPI，明细再慢慢拉——这就是「服务端聚合」的意义。
 */
const ISO = /^\d{4}-\d{2}-\d{2}$/;

async function rpcAggregate(from, to) {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!base || !key) throw new Error('缺少 Supabase 配置');
  const response = await fetch(`${base}/rest/v1/rpc/aggregate_range`, {
    method: 'POST',
    headers: {
      apikey: key,
      'Content-Type': 'application/json',
      ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({ p_from: from, p_to: to }),
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

    const [current, last, year] = await Promise.all([
      rpcAggregate(from, to),
      ISO.test(compareFrom) && ISO.test(compareTo) ? rpcAggregate(compareFrom, compareTo).catch(() => null) : null,
      ISO.test(yearFrom) && ISO.test(yearTo) ? rpcAggregate(yearFrom, yearTo).catch(() => null) : null,
    ]);

    if (!current) return res.status(502).json({ error: 'aggregate_unavailable' });
    return res.status(200).json({ from, to, current, last, year });
  });
}

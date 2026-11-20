import { respond, fetchTable } from '../serverless/supabase.js';

/**
 * 趋势数据（服务端按月/周聚合）。
 * 为什么不复用 /api/data：趋势要看 12 个月甚至更久，明细是几十万行；
 * 这里直接读 v_fact_month / v_fact_week，聚合后只返回几十行。
 *
 * GET /api/trend?mode=month&periods=12
 * GET /api/trend?mode=week&periods=26
 */
const SUM_FIELDS = [
  'sales_quantity', 'order_quantity', 'sales_amount', 'gross_profit', 'sessions',
  'first_mile_cost', 'procurement_cost', 'storage_fee', 'fba_fee', 'refund_cost', 'platform_commission',
  'ad_spend', 'ad_sales', 'ad_orders', 'sp_spend', 'sp_sales', 'sd_spend', 'sd_sales',
  'sb_spend', 'sb_sales', 'sbv_spend', 'sbv_sales', 'impressions', 'clicks',
  'natural_orders', 'natural_clicks', 'fba_international_fee',
];

export default function handler(req, res) {
  return respond(req, res, async () => {
    const url = new URL(req.url || '/', 'https://localhost');
    const rawMode = url.searchParams.get('mode');
    const mode = rawMode === 'week' ? 'week' : rawMode === 'day' ? 'day' : 'month';

    if (mode === 'day') {
      // 日粒度：直接读 daily_series（数据库按天聚合），最多 180 天
      const requestedDays = Number(url.searchParams.get('periods') || url.searchParams.get('days')) || 90;
      const days = Math.max(1, Math.min(requestedDays, 180));
      const to = url.searchParams.get('to') || new Date().toISOString().slice(0, 10);
      const from = url.searchParams.get('from')
        || new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * 86400000).toISOString().slice(0, 10);
      const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
      const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
      if (!base || !key) throw new Error('缺少 Supabase 配置');
      const filters = {};
      for (const [param, field] of Object.entries({ country: 'countries', shop: 'shops', brand: 'brands', manager: 'managers', sub: 'subCategories', pasin: 'parentAsins', pname: 'productNames' })) {
        const raw = url.searchParams.get(param);
        if (!raw) continue;
        const values = raw.split(',').map(item => item.trim()).filter(Boolean);
        if (values.length) filters[field] = values;
      }
      const response = await fetch(`${base}/rest/v1/rpc/daily_series`, {
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
        throw new Error(`日趋势读取失败（请确认已执行最新 db/schema.sql）：${text}`);
      }
      const series = await response.json();
      const rows = (Array.isArray(series) ? series : []).map(row => ({
        ...row,
        country: '', shop_name: '', brand: '', manager: '', sub_category: '',
        parent_asin: '', child_asin: '', product_name: '',
        rating: 0, review_count: 0,
      }));
      return res.status(200).json({ mode, periods: rows.length, rows });
    }

    const requested = Number(url.searchParams.get('periods')) || (mode === 'month' ? 12 : 26);
    const periods = Math.max(1, Math.min(requested, mode === 'month' ? 24 : 52));
    const table = mode === 'month' ? 'v_fact_month' : 'v_fact_week';
    const keyColumn = mode === 'month' ? 'period' : 'week_start';
    const currency = process.env.LINGXING_CURRENCY || 'USD';

    // 只选数值列 + 时间键，体积缩减 70%，避免 Vercel Serverless 超时
    const selectCols = [keyColumn, ...SUM_FIELDS, 'rating', 'review_count', 'fba_sellable_qty'].join(',');
    const queryParams = [
      ['select', selectCols],
      ['currency', `eq.${currency}`],
      ['order', `${keyColumn}.asc`],
    ];

    // 按所需期数限制时间起点，防止全表扫描超时
    const now = new Date();
    if (mode === 'month') {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - periods, 1));
      queryParams.push(['period', `gte.${start.toISOString().slice(0, 7)}`]);
    } else {
      const start = new Date(now.getTime() - (periods + 2) * 7 * 86400000);
      queryParams.push(['week_start', `gte.${start.toISOString().slice(0, 10)}`]);
    }

    // 维度筛选下推到数据库，让筛选后的趋势图也自动跟着变
    const DIM_MAP = {
      country: 'country',
      shop: 'shop_name',
      brand: 'brand',
      manager: 'manager',
      sub: 'sub_category',
      pasin: 'parent_asin',
      casin: 'asin',
      pname: 'product_name',
    };
    for (const [param, col] of Object.entries(DIM_MAP)) {
      const raw = url.searchParams.get(param);
      if (!raw) continue;
      const values = raw.split(',').map(s => s.trim()).filter(Boolean);
      if (values.length) {
        const quoted = values.map(v => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',');
        queryParams.push([col, `in.(${quoted})`]);
      }
    }

    const rows = await fetchTable(table, queryParams, 120000);
    const buckets = new Map();
    for (const row of rows) {
      const key = row[keyColumn];
      if (!key) continue;
      const bucket = buckets.get(key) || { date: mode === 'month' ? `${String(key).slice(0, 7)}-01` : String(key), ratingWeight: 0, ratingSum: 0 };
      for (const field of SUM_FIELDS) bucket[field] = (bucket[field] || 0) + Number(row[field] || 0);
      const reviews = Number(row.review_count || 0);
      if (reviews > 0) {
        bucket.ratingWeight += reviews;
        bucket.ratingSum += Number(row.rating || 0) * reviews;
      }
      if (Number(row.fba_sellable_qty || 0) > bucket.fba_sellable_qty || bucket.fba_sellable_qty === undefined) {
        bucket.fba_sellable_qty = Number(row.fba_sellable_qty || 0);
      }
      buckets.set(key, bucket);
    }

    const list = [...buckets.values()]
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .slice(-periods)
      .map(bucket => ({
        ...bucket,
        country: '',
        shop_name: '',
        brand: '',
        manager: '',
        sub_category: '',
        parent_asin: '',
        child_asin: '',
        product_name: '',
        rating: bucket.ratingWeight > 0 ? bucket.ratingSum / bucket.ratingWeight : 0,
        review_count: bucket.ratingWeight,
      }));

    return res.status(200).json({ mode, periods: list.length, rows: list });
  });
}

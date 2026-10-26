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
    const mode = url.searchParams.get('mode') === 'week' ? 'week' : 'month';
    const requested = Number(url.searchParams.get('periods')) || (mode === 'month' ? 12 : 26);
    const periods = Math.max(1, Math.min(requested, mode === 'month' ? 24 : 52));
    const table = mode === 'month' ? 'v_fact_month' : 'v_fact_week';
    const keyColumn = mode === 'month' ? 'period' : 'week_start';

    const rows = await fetchTable(table, { select: '*', order: `${keyColumn}.asc` }, 60000);
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

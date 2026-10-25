import { adminAuthorized, fetchTable, isValidDate } from '../serverless/supabase.js';

/**
 * 每日数据覆盖：一天一行。
 * 数据来自视图 v_fact_daily_coverage（见 db/schema.sql），只经服务端读取。
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  if (!adminAuthorized(req)) return res.status(401).json({ error: 'unauthorized', message: '管理密码不正确' });

  const url = new URL(req.url || '/', 'https://localhost');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!isValidDate(from) || !isValidDate(to) || from > to) {
    return res.status(400).json({ error: 'invalid_range', message: '日期范围无效' });
  }
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
  if (days > 400) {
    return res.status(400).json({ error: 'range_too_large', message: '单次最多查看 400 天' });
  }

  try {
    const [rows, checks] = await Promise.all([
      fetchTable('v_fact_daily_coverage', [
        ['select', 'date,rows,sales_amount,gross_profit,updated_at'],
        ['date', `gte.${from}`],
        ['date', `lte.${to}`],
        ['order', 'date.asc'],
      ], days + 5),
      // 对账差异：还没建表时忽略，不影响覆盖本身
      fetchTable('daily_checks', [
        ['select', 'date,diff_ratio'],
        ['date', `gte.${from}`],
        ['date', `lte.${to}`],
      ], days + 5).catch(() => []),
    ]);
    const diffByDate = new Map(checks.map((item) => [item.date, item.diff_ratio]));
    return res.status(200).json({
      from,
      to,
      days: rows.map((row) => ({ ...row, diff_ratio: diffByDate.get(row.date) ?? null })),
    });
  } catch (error) {
    console.error('[coverage]', error);
    return res.status(502).json({
      error: 'coverage_unavailable',
      message: '读取数据覆盖失败：请确认已在 Supabase 执行最新 db/schema.sql（含 v_fact_daily_coverage 视图）',
    });
  }
}

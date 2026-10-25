import { adminAuthorized, fetchPage, isValidDate } from '../serverless/supabase.js';

/**
 * 每日/每月明细下载（管理密码保护）。
 *
 *   GET /api/export?from=2026-10-01&to=2026-10-31                  → fact_daily 日明细，单次 ≤31 天
 *   GET /api/export?from=2026-01-01&to=2026-09-30&granularity=month → v_fact_month 月汇总，单次 ≤60 个月
 *
 * 月汇总行的 date 用 period（YYYY-MM），前端列映射会据此派生「年份 / 月份」。
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  if (!adminAuthorized(req)) return res.status(401).json({ error: 'unauthorized' });

  const url = new URL(req.url || '/', 'https://localhost');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const offset = Number(url.searchParams.get('offset') || '0');
  const granularity = url.searchParams.get('granularity') === 'month' ? 'month' : 'day';

  if (!isValidDate(from) || !isValidDate(to) || from > to ||
      !Number.isInteger(offset) || offset < 0 || offset > 100000) {
    return res.status(400).json({ error: 'invalid_export_range', message: '日期范围无效' });
  }

  try {
    if (granularity === 'month') {
      const fromMonth = from.slice(0, 7);
      const toMonth = to.slice(0, 7);
      const months = (Number(toMonth.slice(0, 4)) - Number(fromMonth.slice(0, 4))) * 12
        + (Number(toMonth.slice(5, 7)) - Number(fromMonth.slice(5, 7))) + 1;
      if (months > 60) {
        return res.status(400).json({ error: 'range_too_large', message: '按月汇总单次最多 60 个月' });
      }
      const rows = await fetchPage('v_fact_month', [
        ['select', '*'], ['period', `gte.${fromMonth}`], ['period', `lte.${toMonth}`],
        ['order', 'period.asc,sid.asc,asin.asc'],
      ], 1000, offset);
      // 统一成日明细的结构：date = period，前端列映射即可派生年份/月份
      const normalized = rows.map((row) => ({ ...row, date: row.period }));
      return res.status(200).json({ rows: normalized, nextOffset: rows.length === 1000 ? offset + 1000 : null });
    }

    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
    if (days > 31) {
      return res.status(400).json({ error: 'invalid_export_range', message: '日明细每次最多下载连续 31 天' });
    }
    const rows = await fetchPage('fact_daily', [
      ['select', '*'], ['date', `gte.${from}`], ['date', `lte.${to}`],
      ['order', 'date.asc,sid.asc,asin.asc'],
    ], 1000, offset);
    return res.status(200).json({ rows, nextOffset: rows.length === 1000 ? offset + 1000 : null });
  } catch (error) {
    console.error('[export]', error);
    return res.status(502).json({ error: 'export_unavailable', message: '下载暂时不可用：请确认已在 Supabase 执行最新 schema（v_fact_month 视图）' });
  }
}

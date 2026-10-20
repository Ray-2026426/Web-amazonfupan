import { adminAuthorized, fetchPage, isValidDate } from '../serverless/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  if (!adminAuthorized(req)) return res.status(401).json({ error: 'unauthorized' });
  const url = new URL(req.url || '/', 'https://localhost');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const offset = Number(url.searchParams.get('offset') || '0');
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
  if (!isValidDate(from) || !isValidDate(to) || from > to || days > 31 ||
      !Number.isInteger(offset) || offset < 0 || offset > 100000) {
    return res.status(400).json({ error: 'invalid_export_range', message: '每次最多下载连续 31 天；请选择有效日期' });
  }
  try {
    const rows = await fetchPage('fact_daily', [
      ['select', '*'], ['date', `gte.${from}`], ['date', `lte.${to}`],
      ['order', 'date.asc,sid.asc,asin.asc'],
    ], 1000, offset);
    return res.status(200).json({ rows, nextOffset: rows.length === 1000 ? offset + 1000 : null });
  } catch (error) {
    console.error('[export]', error);
    return res.status(502).json({ error: 'export_unavailable', message: '下载暂时不可用，请稍后重试' });
  }
}

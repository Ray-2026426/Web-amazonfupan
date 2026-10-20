import { respond, isValidDate, rowsForRange } from '../serverless/supabase.js';

export default function handler(req, res) {
  return respond(req, res, async () => {
    const url = new URL(req.url || '/', 'https://localhost');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!isValidDate(from) || !isValidDate(to) || from > to) {
      return res.status(400).json({ error: 'invalid_date_range', message: '日期范围无效' });
    }
    const days = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
    if (days > 366) return res.status(400).json({ error: 'range_too_large', message: '单次最多查询 366 天' });
    const rows = await rowsForRange(from, to);
    return res.status(200).json({ rows });
  });
}

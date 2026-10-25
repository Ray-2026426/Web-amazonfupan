import { respond, fetchTable } from '../serverless/supabase.js';

/**
 * 每日库存快照（只读）。
 * GET /api/inventory            → 最新一天
 * GET /api/inventory?date=YYYY-MM-DD
 */
export default function handler(req, res) {
  return respond(req, res, async () => {
    const url = new URL(req.url || '/', 'https://localhost');
    let date = url.searchParams.get('date');
    if (!date) {
      const latest = await fetchTable('fact_inventory', { select: 'date', order: 'date.desc' }, 1);
      date = latest[0]?.date || null;
    }
    if (!date) return res.status(200).json({ date: null, count: 0, rows: [] });
    const rows = await fetchTable('fact_inventory', {
      select: '*',
      date: `eq.${date}`,
      order: 'total_onhand.desc',
    }, 20000);
    return res.status(200).json({ date, count: rows.length, rows });
  });
}

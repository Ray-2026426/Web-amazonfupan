import { fetchPage, fetchTable, respond } from '../serverless/supabase.js';

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

export default function handler(req, res) {
  return respond(req, res, async () => {
    const url = new URL(req.url || '/', 'https://localhost');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const offset = Number(url.searchParams.get('offset') || '0');
    if (!monthPattern.test(from || '') || !monthPattern.test(to || '') || from > to ||
        !Number.isInteger(offset) || offset < 0 || offset > 100000) {
      return res.status(400).json({ error: 'invalid_target_range' });
    }
    const active = await fetchTable('target_imports', {
      select: 'id,source_filename,expected_rows,activated_at', active: 'eq.true',
    }, 1);
    if (!active.length) return res.status(200).json({ active: false, rows: [], nextOffset: null });
    const page = await fetchPage('target_rows', [
      ['select', 'payload'], ['import_id', `eq.${active[0].id}`],
      ['month', `gte.${from}`], ['month', `lte.${to}`], ['order', 'row_no.asc'],
    ], 1000, offset);
    return res.status(200).json({
      active: true,
      rows: page.map((item) => item.payload),
      nextOffset: page.length === 1000 ? offset + 1000 : null,
      source: active[0].source_filename,
    });
  });
}

import { respond, fetchTable } from '../serverless/supabase.js';

export default function handler(req, res) {
  return respond(req, res, async () => {
    const [latest, first, firstMonth, runs] = await Promise.all([
      fetchTable('fact_daily', { select: 'date', order: 'date.desc' }, 1),
      fetchTable('fact_daily', { select: 'date', order: 'date.asc' }, 1),
      fetchTable('fact_month', { select: 'period', order: 'period.asc' }, 1).catch(() => []),
      fetchTable('sync_runs', { select: 'range_to,status,finished_at,error', order: 'started_at.desc' }, 1),
    ]);
    const last = runs[0];
    const dailyFirst = first[0]?.date || null;
    const monthFirst = firstMonth[0]?.period ? `${firstMonth[0].period}-01` : null;
    const firstDate = monthFirst && (!dailyFirst || monthFirst < dailyFirst) ? monthFirst : dailyFirst;
    return res.status(200).json({
      first_date: firstDate,
      latest_date: latest[0]?.date || null,
      latestRun: last ? { status: last.status === 'ok' ? 'success' : last.status, business_date: last.range_to, finished_at: last.finished_at, error_message: last.error } : null,
    });
  });
}

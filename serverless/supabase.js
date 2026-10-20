import { timingSafeEqual } from 'node:crypto';

const numberFields = [
  'sales_quantity', 'order_quantity', 'sales_amount', 'gross_profit', 'fba_sellable_qty', 'sessions',
  'first_mile_cost', 'procurement_cost', 'storage_fee', 'fba_fee', 'refund_cost',
  'platform_commission', 'ad_spend', 'ad_sales', 'ad_orders', 'sp_spend', 'sp_sales',
  'sd_spend', 'sd_sales', 'sb_spend', 'sb_sales', 'sbv_spend', 'sbv_sales',
  'impressions', 'clicks', 'natural_orders', 'natural_clicks', 'rating', 'review_count',
];

export function authorized(req) {
  return tokenMatches(req, process.env.DASHBOARD_READ_TOKEN || '');
}

export function adminAuthorized(req) {
  return tokenMatches(req, process.env.DASHBOARD_ADMIN_TOKEN || '');
}

function tokenMatches(req, configured) {
  const supplied = String(req.headers.authorization || '').replace(/^Bearer /i, '');
  if (configured.length < 24 || supplied.length !== configured.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(configured));
}

export async function writeTable(path, method, body, query = {}, upsert = false) {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!base || !key) throw new Error('Supabase server credentials are missing');
  const url = new URL(`${base}/rest/v1/${path}`);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  const response = await fetch(url, {
    method,
    headers: {
      apikey: key,
      ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}),
      'Content-Type': 'application/json',
      Prefer: upsert ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`Supabase ${path}: HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
}

export function respond(req, res, work) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });
  return Promise.resolve().then(work).catch((error) => {
    console.error('[cloud-data]', error);
    return res.status(error.status || 502).json({ error: 'cloud_data_error', message: error.publicMessage || '云端数据暂时不可用，请稍后重试' });
  });
}

export async function fetchTable(table, params, maxRows = 60000) {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!base || !key) throw new Error('Supabase server credentials are missing');
  const rows = [];
  const pageSize = Math.min(1000, maxRows);
  for (let offset = 0; offset <= maxRows; offset += pageSize) {
    const query = new URLSearchParams(params);
    query.set('limit', String(Math.min(pageSize, maxRows - offset + 1)));
    query.set('offset', String(offset));
    const response = await fetch(`${base}/rest/v1/${table}?${query}`, {
      headers: {
        apikey: key,
        ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}),
      },
    });
    if (!response.ok) throw new Error(`Supabase ${table}: HTTP ${response.status}`);
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error(`Supabase ${table}: invalid response`);
    rows.push(...page);
    if (rows.length > maxRows) {
      const error = new Error('too many rows');
      error.status = 413;
      error.publicMessage = '所选范围数据量过大，请缩短日期范围';
      throw error;
    }
    if (page.length < pageSize) break;
  }
  return rows;
}

export async function fetchPage(table, params, limit = 1000, offset = 0) {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!base || !key) throw new Error('Supabase server credentials are missing');
  const query = new URLSearchParams(params);
  query.set('limit', String(limit));
  query.set('offset', String(offset));
  const response = await fetch(`${base}/rest/v1/${table}?${query}`, {
    headers: { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}) },
  });
  if (!response.ok) throw new Error(`Supabase ${table}: HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error(`Supabase ${table}: invalid response`);
  return rows;
}

export function asDataRow(row, granularity) {
  const date = granularity === 'month' ? `${row.period}-01` : row.date;
  const data = { ...row, id: `${row.sid}|${row.asin}|${date}`, date, child_asin: row.asin };
  for (const key of numberFields) data[key] = Number(row[key] ?? 0);
  return data;
}

export function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const nextMonth = (date) => {
  const [year, month] = date.slice(0, 7).split('-').map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
};
const monthEnd = (date) => new Date(Date.parse(`${nextMonth(date)}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

/** At most two partial months use daily rows; whole months use the database's month view. */
export function splitRange(from, to) {
  const parts = [];
  let cursor = from;
  if (!from.endsWith('-01')) {
    const end = monthEnd(from) < to ? monthEnd(from) : to;
    parts.push({ granularity: 'day', from, to: end });
    cursor = nextMonth(from);
  }
  if (cursor > to) return parts;
  const lastMonthStart = `${to.slice(0, 7)}-01`;
  const monthlyEnd = to === monthEnd(to) ? to : new Date(Date.parse(`${lastMonthStart}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  if (cursor <= monthlyEnd) parts.push({ granularity: 'month', from: cursor, to: monthlyEnd });
  if (to !== monthEnd(to) && lastMonthStart >= cursor) parts.push({ granularity: 'day', from: lastMonthStart, to });
  return parts;
}

export async function rowsForRange(from, to) {
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
  const parts = days <= 45 ? [{ granularity: 'day', from, to }] : splitRange(from, to);
  const currency = process.env.LINGXING_CURRENCY || 'USD';
  const segments = [];
  for (const part of parts) {
    const monthly = part.granularity === 'month';
    const table = monthly ? 'v_fact_month' : 'fact_daily';
    const field = monthly ? 'period' : 'date';
    const low = monthly ? part.from.slice(0, 7) : part.from;
    const high = monthly ? part.to.slice(0, 7) : part.to;
    const rows = await fetchTable(table, [
      ['select', '*'], [field, `gte.${low}`], [field, `lte.${high}`], ['currency', `eq.${currency}`],
      ['order', monthly ? 'period.asc,sid.asc,asin.asc' : 'date.asc,sid.asc,asin.asc'],
    ]);
    segments.push(...rows.map((row) => asDataRow(row, part.granularity)));
  }
  return segments;
}

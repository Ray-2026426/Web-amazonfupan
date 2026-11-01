import { timingSafeEqual } from 'node:crypto';

const numberFields = [
  'sales_quantity', 'order_quantity', 'sales_amount', 'gross_profit', 'fba_sellable_qty', 'sessions',
  'first_mile_cost', 'procurement_cost', 'storage_fee', 'fba_fee', 'refund_cost',
  'platform_commission', 'ad_spend', 'ad_sales', 'ad_orders', 'sp_spend', 'sp_sales',
  'sd_spend', 'sd_sales', 'sb_spend', 'sb_sales', 'sbv_spend', 'sbv_sales',
  'impressions', 'clicks', 'natural_orders', 'natural_clicks', 'rating', 'review_count',
  'fba_international_fee',
];

/** 明细只取看板真正用到的列：select=* 会多传一堆用不上的字段，几万行时体积和解析都翻倍 */
const DIMENSION_COLUMNS = [
  'sid', 'asin', 'country', 'shop_name', 'brand', 'manager',
  'sub_category', 'parent_asin', 'product_name', 'currency',
];

export const dataColumns = (monthly) =>
  [...(monthly ? ['period'] : ['date']), ...DIMENSION_COLUMNS, ...numberFields].join(',');

/** 并发取的页数窗口：Supabase 单页上限 1000 行，窗口越大首屏越快、但别把连接打满 */
const PAGE_CONCURRENCY = 6;

function overflowError() {
  const error = new Error('too many rows');
  error.status = 413;
  error.publicMessage = '所选范围数据量过大，请缩短日期范围';
  return error;
}

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

/**
 * 拉一页或多页数据。
 *
 * @param {number} maxRows 最多返回多少行
 * @param {{rejectIfOverflow?: boolean}} [options]
 *   rejectIfOverflow=true 时，若实际数据超过 maxRows 会抛 413（给 /api/data 用：
 *   "这段日期太大了，请缩小范围"）。默认 false —— 取到 maxRows 就截断返回。
 *
 * 为什么必须区分：`fetchTable(t, p, 1)` 的调用方（freshness / admin）语义是
 * "取第一条"，表里本来就有成千上万行，如果默认做超限判定，它会立刻 413。
 * 旧实现正是把这两件事混在一起，导致 /api/freshness 永久 413。
 */
export async function fetchTable(table, params, maxRows = 60000, options = {}) {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!base || !key) throw new Error('Supabase server credentials are missing');

  const { rejectIfOverflow = false } = options;
  // 需要判超限时多取 1 行，用来区分「刚好 maxRows 行」和「超过 maxRows 行」
  const target = rejectIfOverflow ? maxRows + 1 : maxRows;
  const pageSize = Math.max(1, Math.min(1000, target));
  const headers = { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}) };

  const loadPage = async (offset, limit, extraHeaders) => {
    const query = new URLSearchParams(params);
    query.set('limit', String(limit));
    query.set('offset', String(offset));
    const response = await fetch(`${base}/rest/v1/${table}?${query}`, {
      headers: { ...headers, ...extraHeaders },
    });
    if (!response.ok) throw new Error(`Supabase ${table}: HTTP ${response.status}`);
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error(`Supabase ${table}: invalid response`);
    // 有些 fetch 实现/测试桩没有 headers，取不到总数时按 null 处理（回退到短页即止）
    const contentRange = typeof response.headers?.get === 'function' ? response.headers.get('content-range') : null;
    return { page, total: parseTotal(contentRange) };
  };

  // 第一页顺便问一次总数（Prefer: count=exact → Content-Range: 0-999/12345），
  // 这样后面只需并发取真正存在的页，也能在超限时立刻 413、不必把几万行拉完再报错。
  const first = await loadPage(0, pageSize, { Prefer: 'count=exact' });
  const rows = first.page.slice();
  const total = first.total;

  if (rejectIfOverflow && total !== null && total > maxRows) throw overflowError();
  if (rows.length < pageSize) {
    if (rejectIfOverflow && rows.length > maxRows) throw overflowError();
    return rows.slice(0, maxRows);
  }

  /**
   * 多页数据：之前是一页一页串行取，几万行就是几十次串行往返，首屏全被这里拖住。
   * 页与页之间没有依赖（offset 是确定的），改成固定窗口并发取。
   */
  const hardLimit = total === null ? target : Math.min(target, total);
  let nextOffset = pageSize;
  let done = false;
  while (!done && nextOffset < hardLimit) {
    const batch = [];
    for (let i = 0; i < PAGE_CONCURRENCY; i += 1) {
      const offset = nextOffset + i * pageSize;
      const limit = Math.min(pageSize, hardLimit - offset);
      if (offset >= hardLimit || limit <= 0) break;
      batch.push({ offset, limit });
    }
    if (!batch.length) break;
    const pages = await Promise.all(batch.map((chunk) => loadPage(chunk.offset, chunk.limit)));
    for (let i = 0; i < pages.length; i += 1) {
      rows.push(...pages[i].page);
      // 数据在半路变少（同步写库）时以实际返回为准，避免把空页当数据
      if (pages[i].page.length < batch[i].limit) { done = true; break; }
    }
    nextOffset += batch.length * pageSize;
  }

  if (rejectIfOverflow && rows.length > maxRows) throw overflowError();
  return rows.slice(0, maxRows);
}

/** Content-Range 形如 "0-999/12345"；拿不到或为 "*" 时返回 null */
function parseTotal(contentRange) {
  if (!contentRange) return null;
  const slash = contentRange.lastIndexOf('/');
  if (slash < 0) return null;
  const value = Number(contentRange.slice(slash + 1));
  return Number.isFinite(value) ? value : null;
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
    // 这里才需要"超限就报错"的语义：日期区间太大时提示用户缩短范围
    const rows = await fetchTable(
      table,
      [
        ['select', dataColumns(monthly)], [field, `gte.${low}`], [field, `lte.${high}`], ['currency', `eq.${currency}`],
        ['order', monthly ? 'period.asc,sid.asc,asin.asc' : 'date.asc,sid.asc,asin.asc'],
      ],
      60000,
      { rejectIfOverflow: true }
    );
    segments.push(...rows.map((row) => asDataRow(row, part.granularity)));
  }
  return segments;
}

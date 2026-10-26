import type { DataRow, TargetRow } from './types';
import { calculatePeriodDates, formatDate } from './utils';

export const CLOUD_API_URL = (import.meta.env.VITE_CLOUD_API_URL || '').replace(/\/$/, '');
export const CLOUD_ENABLED = import.meta.env.VITE_CLOUD_SYNC_ENABLED === 'true' || Boolean(CLOUD_API_URL);
const TOKEN_KEY = 'amazon-dashboard-read-token';

export const getCloudToken = () => localStorage.getItem(TOKEN_KEY) || '';
export const saveCloudToken = (token: string) => localStorage.setItem(TOKEN_KEY, token.trim());
export const clearCloudToken = () => localStorage.removeItem(TOKEN_KEY);

async function request<T>(path: string, token: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${CLOUD_API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (response.status === 401) throw new Error('云端访问密码不正确');
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || `云端接口错误 ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export interface CloudFreshness {
  first_date: string | null;
  latest_date: string | null;
  days: number;
  latestRun: { status: string; business_date: string; finished_at: string | null; error_message: string | null } | null;
}

export const fetchCloudFreshness = (token: string, signal?: AbortSignal) =>
  request<CloudFreshness>('/api/freshness', token, signal);

export type CloudAggregate = {
  rows: number;
  sales_quantity: number;
  order_quantity: number;
  sales_amount: number;
  gross_profit: number;
  sessions: number;
  first_mile_cost: number;
  procurement_cost: number;
  storage_fee: number;
  fba_fee: number;
  refund_cost: number;
  platform_commission: number;
  ad_spend: number;
  ad_sales: number;
  ad_orders: number;
  sp_spend: number;
  sp_sales: number;
  sd_spend: number;
  sd_sales: number;
  sb_spend: number;
  sb_sales: number;
  sbv_spend: number;
  sbv_sales: number;
  impressions: number;
  clicks: number;
  natural_orders: number;
  natural_clicks: number;
  fba_international_fee: number;
  rating: number;
  review_count: number;
  fba_sellable_qty: number;
};

/** 服务端聚合：首屏 KPI 用这个，几百字节，不必等十几万行明细（支持维度筛选） */
export async function fetchCloudAggregate(
  startDate: string,
  endDate: string,
  token: string,
  signal?: AbortSignal,
  filters?: Record<string, string[]>,
): Promise<{ current: CloudAggregate; last: CloudAggregate | null; year: CloudAggregate | null }> {
  const periods = calculatePeriodDates(startDate, endDate);
  const query = [
    `from=${formatDate(periods.current.start)}`,
    `to=${formatDate(periods.current.end)}`,
    `compareFrom=${formatDate(periods.last.start)}`,
    `compareTo=${formatDate(periods.last.end)}`,
    `yearFrom=${formatDate(periods.year.start)}`,
    `yearTo=${formatDate(periods.year.end)}`,
  ];
  const PARAM_OF: Record<string, string> = {
    countries: 'country', shops: 'shop', brands: 'brand', managers: 'manager',
    subCategories: 'sub', parentAsins: 'pasin', productNames: 'pname',
  };
  if (filters) {
    for (const [field, param] of Object.entries(PARAM_OF)) {
      const values = filters[field];
      if (Array.isArray(values) && values.length) query.push(`${param}=${encodeURIComponent(values.join(','))}`);
    }
  }
  return request<{ current: CloudAggregate; last: CloudAggregate | null; year: CloudAggregate | null }>(`/api/aggregate?${query.join('&')}`, token, signal);
}

export async function fetchCloudRows(startDate: string, endDate: string, token: string, signal?: AbortSignal): Promise<DataRow[]> {
  const periods = calculatePeriodDates(startDate, endDate);
  const ranges = [periods.current, periods.last, periods.year];
  const responses = await Promise.all(ranges.map(({ start, end }) => {
    const from = formatDate(start);
    const to = formatDate(end);
    return request<{ rows: DataRow[] }>(`/api/data?from=${from}&to=${to}`, token, signal);
  }));
  const seen = new Map<string, DataRow>();
  for (const response of responses) {
    for (const row of response.rows) seen.set(`${row.date}|${row.id}`, row);
  }
  return [...seen.values()];
}

export async function fetchCloudTargets(startDate: string, endDate: string, token: string, signal?: AbortSignal): Promise<{ active: boolean; rows: TargetRow[] }> {
  const from = startDate.slice(0, 7);
  const to = endDate.slice(0, 7);
  const rows: TargetRow[] = [];
  let offset = 0;
  for (let page = 0; page < 101; page++) {
    const result = await request<{ active: boolean; rows: TargetRow[]; nextOffset: number | null }>(
      `/api/targets?from=${from}&to=${to}&offset=${offset}`, token, signal,
    );
    if (!result.active) return { active: false, rows: [] };
    rows.push(...result.rows);
    if (result.nextOffset === null) return { active: true, rows };
    offset = result.nextOffset;
  }
  throw new Error('目标表数据量超出单次读取上限，请缩短日期范围');
}

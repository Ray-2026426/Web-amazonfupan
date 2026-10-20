import type { DataRow } from './types';
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

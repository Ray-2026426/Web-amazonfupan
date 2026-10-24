import React, { useEffect, useMemo, useState } from 'react';
import { parseTargetData } from '../dataLoader';
import { enrichTargetData } from '../utils';
import { dailyCsvHeader, dailyCsvRows, dailyExportMatrix, type ExportLabels } from '../dailyExport';
import { FIELD_GROUPS, FIELD_MAPPINGS } from '../shared/field-mapping.mjs';
import { useEscClose } from './useEscClose';
import { AlertCircle, Database, Download, RefreshCw, RotateCcw, Save, Search, Settings2, Table2, Upload, X } from 'lucide-react';

type FieldMapping = { web_field: string; export_label: string; lingxing_field: string };
type Run = { id: number; started_at: string; range_from: string; range_to: string; status: string; rows_daily: number; error: string | null };
type Sample = { date: string; sid: string; asin: string; shop_name: string; product_name: string; sales_amount: number; gross_profit: number; ad_spend: number };
type AdminData = {
  settings: { enabled: boolean; lookback_days: number } | null;
  fieldMappings: FieldMapping[];
  /** false = 云端还没建 field_mappings 表，当前显示的是内置默认值 */
  fieldMappingReady?: boolean;
  runs: Run[];
  sampleDate: string | null;
  data: Sample[];
  targetImport: { id: string; source_filename: string; expected_rows: number; activated_at: string } | null;
};

const TOKEN_KEY = 'amazon-dashboard-admin-token';

/** 映射表字段较多，按分组展示，并支持关键字过滤 */
type Tab = 'overview' | 'fields' | 'targets' | 'data';
const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'overview', label: '概览', icon: <Settings2 className="h-3.5 w-3.5" /> },
  { key: 'fields', label: '字段映射', icon: <Table2 className="h-3.5 w-3.5" /> },
  { key: 'targets', label: '目标表', icon: <Database className="h-3.5 w-3.5" /> },
  { key: 'data', label: '数据下载', icon: <Download className="h-3.5 w-3.5" /> },
];

export const CloudAdminPanel: React.FC<{ onClose: () => void; onTargetsUpdated?: () => void }> = ({ onClose, onTargetsUpdated }) => {
  useEscClose(true, onClose);
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || '');
  const [password, setPassword] = useState('');
  const [data, setData] = useState<AdminData | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [targetFile, setTargetFile] = useState<File | null>(null);
  const [progress, setProgress] = useState('');
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [exportMode, setExportMode] = useState<'day' | 'range'>('range');
  const [draft, setDraft] = useState<Record<string, { export_label: string; lingxing_field: string }>>({});
  const [query, setQuery] = useState('');

  const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  useEffect(() => {
    if (exportFrom) return;
    const today = localDate(new Date());
    setExportFrom(today);
    setExportTo(today);
  }, [exportFrom]);

  const request = async (method: 'GET' | 'POST', body?: object, requestedDate = date) => {
    const response = await fetch(`/api/admin${method === 'GET' && requestedDate ? `?date=${encodeURIComponent(requestedDate)}` : ''}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) {
      sessionStorage.removeItem(TOKEN_KEY);
      setToken('');
      throw new Error('管理密码不正确');
    }
    if (!response.ok) throw new Error(result.message || `请求失败：${response.status}`);
    return result;
  };

  const load = async (requestedDate = date) => {
    setBusy(true);
    try {
      const result = await request('GET', undefined, requestedDate) as AdminData;
      setData(result);
      setMessage('');
    } catch (error) {
      setMessage(String(error instanceof Error ? error.message : error));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { if (token) void load(); }, [token]);

  /** 服务端数据回来后刷新映射草稿；保存后也会走一遍，等于「已保存」的确认 */
  useEffect(() => {
    if (!data) return;
    const next: Record<string, { export_label: string; lingxing_field: string }> = {};
    for (const item of FIELD_MAPPINGS) {
      const row = data.fieldMappings.find(saved => saved.web_field === item.web_field);
      next[item.web_field] = { export_label: row?.export_label ?? item.export_label, lingxing_field: row?.lingxing_field ?? item.lingxing_field };
    }
    setDraft(next);
  }, [data]);

  const exportLabels = useMemo<ExportLabels>(() => {
    const labels: ExportLabels = {};
    for (const item of data?.fieldMappings || []) labels[item.web_field] = item.export_label;
    return labels;
  }, [data]);

  const save = async (body: object, success: string) => {
    setBusy(true);
    try {
      await request('POST', body);
      const refreshed = await request('GET') as AdminData;
      setData(refreshed);
      setMessage(success);
    } catch (error) {
      setMessage(String(error instanceof Error ? error.message : error));
    } finally {
      setBusy(false);
    }
  };

  const uploadTargets = async () => {
    if (!targetFile) return;
    setBusy(true);
    setMessage('');
    setProgress('正在解析目标表…');
    try {
      const parsed = await parseTargetData(targetFile);
      if (!parsed.debug.mappedColumns.child_asin || !parsed.debug.mappedColumns.wide_format_indicator) {
        throw new Error('目标表缺少“子ASIN”或横向月份目标列，请使用提供的目标表格式');
      }
      const rows = enrichTargetData(parsed.data, []).filter(row =>
        [row.sales_quantity_target, row.sales_amount_target, row.gross_profit_target, row.ad_spend_target].some(value => Number(value) !== 0),
      );
      if (!rows.length) throw new Error('目标表中没有非零目标数据');
      const started = await request('POST', { action: 'targets_start', source_filename: targetFile.name, expected_rows: rows.length }) as { import_id: string };
      const size = 400;
      for (let offset = 0; offset < rows.length; offset += size) {
        await request('POST', {
          action: 'targets_batch', import_id: started.import_id,
          rows: rows.slice(offset, offset + size).map((payload, index) => ({ row_no: offset + index, payload })),
        });
        setProgress(`已上传 ${Math.min(offset + size, rows.length)} / ${rows.length} 行`);
      }
      await request('POST', { action: 'targets_activate', import_id: started.import_id });
      const refreshed = await request('GET') as AdminData;
      setData(refreshed);
      setTargetFile(null);
      setProgress('');
      setMessage(`目标表已保存到云端，共 ${rows.length} 行；以后打开看板会自动读取。`);
      onTargetsUpdated?.();
    } catch (error) {
      setProgress('');
      setMessage(String(error instanceof Error ? error.message : error));
    } finally {
      setBusy(false);
    }
  };

  /** 服务端单次最多 31 天，按 31 天窗口切片后逐段拉取 */
  const buildChunks = (from: string, to: string) => {
    const chunks: { from: string; to: string }[] = [];
    let cursor = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    while (cursor.getTime() <= end.getTime()) {
      const chunkEnd = new Date(cursor);
      chunkEnd.setDate(chunkEnd.getDate() + 30);
      if (chunkEnd.getTime() > end.getTime()) chunkEnd.setTime(end.getTime());
      chunks.push({ from: localDate(cursor), to: localDate(chunkEnd) });
      cursor = new Date(chunkEnd);
      cursor.setDate(cursor.getDate() + 1);
    }
    return chunks;
  };

  const fetchRangeRows = async (from: string, to: string) => {
    const rows: Record<string, unknown>[] = [];
    let offset = 0;
    for (let page = 0; page < 501; page++) {
      const response = await fetch(`/api/export?from=${from}&to=${to}&offset=${offset}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || `下载失败：${response.status}`);
      rows.push(...(result.rows as Record<string, unknown>[]));
      if (result.nextOffset === null) return rows;
      offset = result.nextOffset;
    }
    throw new Error('单段数据量超过下载上限，请缩短日期范围');
  };

  const downloadDaily = async (format: 'csv' | 'xlsx') => {
    const from = exportFrom;
    const to = exportMode === 'day' ? exportFrom : exportTo;
    if (!from || !to || from > to) {
      setMessage('请先选择有效的下载日期');
      return;
    }
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
    if (format === 'xlsx' && days > 92) {
      setMessage('Excel 单次最多 92 天（约 8 万行）；更长的区间请用 CSV');
      return;
    }
    setBusy(true);
    setMessage('');
    setProgress('正在准备每日明细…');
    try {
      const chunks = buildChunks(from, to);
      const fileBase = days === 1 ? `亚马逊每日业绩_${from}` : `亚马逊每日业绩_${from}_${to}`;

      if (format === 'csv') {
        const parts: BlobPart[] = ['\uFEFF', dailyCsvHeader(exportLabels)];
        let count = 0;
        for (let i = 0; i < chunks.length; i++) {
          const rows = await fetchRangeRows(chunks[i].from, chunks[i].to);
          parts.push(dailyCsvRows(rows));
          count += rows.length;
          setProgress(`已读取 ${count} 行（第 ${i + 1}/${chunks.length} 段）…`);
        }
        const url = URL.createObjectURL(new Blob(parts, { type: 'text/csv;charset=utf-8' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${fileBase}.csv`;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setMessage(`已下载 ${count} 行每日明细（共 ${days} 天）。`);
      } else {
        const all: Record<string, unknown>[] = [];
        for (let i = 0; i < chunks.length; i++) {
          const rows = await fetchRangeRows(chunks[i].from, chunks[i].to);
          all.push(...rows);
          setProgress(`已读取 ${all.length} 行（第 ${i + 1}/${chunks.length} 段）…`);
        }
        const XLSX = await import('xlsx');
        const worksheet = XLSX.utils.aoa_to_sheet(dailyExportMatrix(all, exportLabels));
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, '每日明细');
        XLSX.writeFile(workbook, `${fileBase}.xlsx`);
        setMessage(`已下载 ${all.length} 行每日明细（共 ${days} 天）。`);
      }
    } catch (error) {
      setMessage(String(error instanceof Error ? error.message : error));
    } finally {
      setProgress('');
      setBusy(false);
    }
  };

  const cardClass = 'rounded-2xl border border-slate-200/70 bg-white p-5';
  const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100';
  const primaryClass = 'inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40';
  const ghostClass = 'inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-40';
  const sectionTitle = 'text-sm font-semibold text-slate-900';
  const sectionHint = 'mt-1 text-xs leading-relaxed text-slate-500';

  const statusPill = (status: string) => (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${status === 'ok' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200/70' : 'bg-rose-50 text-rose-700 ring-rose-200/70'}`}>
      {status === 'ok' ? '成功' : '失败'}
    </span>
  );

  const latestRun = data?.runs?.[0];

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/50 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="云端数据管理">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-slate-50 shadow-2xl ring-1 ring-slate-900/5">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200/70 bg-white px-6 py-5">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-slate-900">云端数据</h2>
            <p className="mt-1 text-xs text-slate-500">同步设置、字段映射、目标表与明细下载</p>
          </div>
          <div className="flex items-center gap-2">
            {latestRun && (
              <span className="hidden items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-600 sm:inline-flex">
                最近同步 {new Date(latestRun.started_at).toLocaleString('zh-CN')}
              </span>
            )}
            <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="关闭">
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {!token ? (
          <form className="mx-auto w-full max-w-sm space-y-3 px-6 py-12" onSubmit={event => { event.preventDefault(); const value = password.trim(); if (value) { sessionStorage.setItem(TOKEN_KEY, value); setToken(value); setPassword(''); } }}>
            <p className="text-sm text-slate-600">输入单独的管理密码。它与看板只读密码不同。</p>
            <input className={inputClass} type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="管理密码" aria-label="管理密码" />
            <button className={`${primaryClass} w-full justify-center`} type="submit">进入</button>
            {message && <p className="text-sm text-rose-600" role="alert">{message}</p>}
          </form>
        ) : <>
          <nav className="flex flex-wrap items-center gap-1 border-b border-slate-200/70 bg-white px-4 py-2">
            {TABS.map(item => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition ${tab === item.key ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2">
              <button className={ghostClass} onClick={() => void load()} disabled={busy}><RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />刷新</button>
              <button className={ghostClass} onClick={() => { sessionStorage.removeItem(TOKEN_KEY); setToken(''); setData(null); }}>退出</button>
            </div>
          </nav>

          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
            {message && <p className="rounded-xl border border-sky-100 bg-sky-50 px-4 py-2.5 text-xs text-sky-900" role="status">{message}</p>}
            {progress && <p className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-600" role="status">{progress}</p>}
            {!data ? <p className="p-8 text-center text-sm text-slate-500">{busy ? '正在读取云端配置…' : '暂无数据，请检查数据库配置。'}</p> : <>

              {tab === 'overview' && <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <section className={cardClass}>
                    <h3 className={sectionTitle}>自动同步</h3>
                    <p className={sectionHint}>每天定时把领星数据写进云端；回补天数越大，越能自动补上失败的日期。</p>
                    <div className="mt-4 space-y-4">
                      <label className="flex items-center justify-between gap-3 text-sm text-slate-700">
                        <span>启用每日自动同步</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={data.settings?.enabled ?? true}
                          onClick={() => setData({ ...data, settings: { enabled: !(data.settings?.enabled ?? true), lookback_days: data.settings?.lookback_days ?? 3 } })}
                          className={`relative h-6 w-11 rounded-full transition ${(data.settings?.enabled ?? true) ? 'bg-emerald-500' : 'bg-slate-300'}`}
                        >
                          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${(data.settings?.enabled ?? true) ? 'left-[22px]' : 'left-0.5'}`} />
                        </button>
                      </label>
                      <label className="flex items-center justify-between gap-3 text-sm text-slate-700">
                        <span>每天回补最近</span>
                        <span className="flex items-center gap-2">
                          <input
                            className="w-16 rounded-lg border border-slate-200 px-2 py-1.5 text-center text-sm outline-none focus:border-sky-400"
                            type="number" min="1" max="14"
                            value={data.settings?.lookback_days ?? 3}
                            onChange={event => setData({ ...data, settings: { enabled: data.settings?.enabled ?? true, lookback_days: Number(event.target.value) } })}
                          />
                          <span className="text-xs text-slate-500">天</span>
                        </span>
                      </label>
                      <button className={`${primaryClass} w-full justify-center`} disabled={busy} onClick={() => save({ action: 'settings', ...data.settings }, '同步设置已保存')}>保存设置</button>
                    </div>
                  </section>

                  <section className={cardClass}>
                    <h3 className={sectionTitle}>数据现状</h3>
                    <p className={sectionHint}>云端日明细的最新日期与最近一次运行结果。</p>
                    <dl className="mt-4 space-y-3 text-sm">
                      <div className="flex items-center justify-between"><dt className="text-slate-500">最新数据日</dt><dd className="font-mono text-slate-900">{data.sampleDate || '—'}</dd></div>
                      <div className="flex items-center justify-between"><dt className="text-slate-500">最近状态</dt><dd>{latestRun ? statusPill(latestRun.status) : '—'}</dd></div>
                      <div className="flex items-center justify-between"><dt className="text-slate-500">最近写入行数</dt><dd className="font-mono text-slate-900">{latestRun?.rows_daily ?? '—'}</dd></div>
                    </dl>
                  </section>
                </div>

                <section className={cardClass}>
                  <h3 className={sectionTitle}>最近同步记录</h3>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="text-[11px] uppercase tracking-wide text-slate-400">
                        <tr><th className="py-2 pr-3 font-medium">开始时间</th><th className="py-2 pr-3 font-medium">数据日期</th><th className="py-2 pr-3 font-medium">状态</th><th className="py-2 font-medium">日明细行数</th></tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.runs.map(run => (
                          <tr key={run.id} className="text-slate-700">
                            <td className="py-2.5 pr-3">{new Date(run.started_at).toLocaleString('zh-CN')}</td>
                            <td className="py-2.5 pr-3 font-mono">{run.range_from} ～ {run.range_to}</td>
                            <td className="py-2.5 pr-3">{statusPill(run.status)}</td>
                            <td className="py-2.5 font-mono">{run.rows_daily ?? 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!data.runs.length && <p className="py-6 text-center text-xs text-slate-400">尚无同步记录</p>}
                  </div>
                </section>
              </div>}

              {tab === 'fields' && <section className={cardClass}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className={sectionTitle}>字段映射（37 个字段）</h3>
                    <p className={sectionHint}>
                      左边是下载表格里的列名，中间是看板实际展示的字段，右边是领星返回的取值路径。
                      <span className="font-mono text-slate-600">pp.</span> 取自产品表现，<span className="font-mono text-slate-600">op.</span> 取自订单利润。
                      改右边跟随领星字段变化，改左边自定义下载列名；保存后对下一次同步 / 下载生效。
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                      <input
                        className="w-44 rounded-xl border border-slate-200 bg-white py-2 pl-8 pr-2.5 text-xs text-slate-700 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                        placeholder="搜索字段 / 路径"
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                        aria-label="搜索字段"
                      />
                    </div>
                    <button className={ghostClass} disabled={busy} onClick={() => save({ action: 'field_mapping_reset' }, '已全部恢复默认映射')}>
                      <RotateCcw className="h-3.5 w-3.5" />全部恢复默认
                    </button>
                  </div>
                </div>

                <div className="mt-5 max-h-[52vh] overflow-auto rounded-xl border border-slate-100">
                  {data.fieldMappingReady === false && (
                    <p className="sticky top-0 z-10 flex items-start gap-2 border-b border-amber-200/70 bg-amber-50 px-3.5 py-2.5 text-[11px] leading-relaxed text-amber-800">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      云端还没有字段映射表，下面是内置默认值。请先在 Supabase SQL Editor 执行 db/migrate-field-mappings.sql，保存才会生效。
                    </p>
                  )}
                  <table className="w-full min-w-[760px] text-left text-xs">
                    <thead className="sticky top-0 z-[5] bg-white text-[11px] uppercase tracking-wide text-slate-400 shadow-[0_1px_0_0_rgba(226,232,240,1)]">
                      <tr>
                        <th className="w-[26%] px-3 py-2.5 font-medium">下载表格字段名</th>
                        <th className="w-[20%] px-3 py-2.5 font-medium">Web 展示字段</th>
                        <th className="w-[38%] px-3 py-2.5 font-medium">领星字段名（路径）</th>
                        <th className="px-3 py-2.5 font-medium" />
                      </tr>
                    </thead>
                    <tbody>
                      {FIELD_GROUPS.map(group => {
                        const keyword = query.trim().toLowerCase();
                        const rows = FIELD_MAPPINGS.filter(item => item.group === group.key).filter(item => {
                          if (!keyword) return true;
                          const row = draft[item.web_field];
                          return [item.web_label, row?.export_label, row?.lingxing_field]
                            .filter(Boolean)
                            .some(text => String(text).toLowerCase().includes(keyword));
                        });
                        if (!rows.length) return null;
                        return (
                          <React.Fragment key={group.key}>
                            <tr className="bg-slate-50/80">
                              <td colSpan={4} className="px-3 py-1.5 text-[11px] font-semibold text-slate-500">{group.label}</td>
                            </tr>
                            {rows.map(item => {
                              const key = item.web_field;
                              const row = draft[key] || { export_label: item.export_label, lingxing_field: item.lingxing_field };
                              const saved = data.fieldMappings.find(entry => entry.web_field === key);
                              const changed = !saved || saved.export_label !== row.export_label || saved.lingxing_field !== row.lingxing_field;
                              return (
                                <tr key={key} className="border-t border-slate-100 align-middle hover:bg-slate-50/60">
                                  <td className="px-3 py-2">
                                    <input
                                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                                      value={row.export_label}
                                      onChange={event => setDraft(prev => ({ ...prev, [key]: { ...row, export_label: event.target.value } }))}
                                      aria-label={`${item.web_label} 的下载列名`}
                                    />
                                  </td>
                                  <td className="px-3 py-2">
                                    <div className="flex flex-col">
                                      <span className="font-medium text-slate-800">{item.web_label}</span>
                                      <span className="font-mono text-[10px] text-slate-400">{key}</span>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2">
                                    <input
                                      className="w-full rounded-lg border border-slate-200 bg-slate-50/60 px-2.5 py-1.5 font-mono text-[11px] text-slate-700 outline-none transition focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-100"
                                      value={row.lingxing_field}
                                      onChange={event => setDraft(prev => ({ ...prev, [key]: { ...row, lingxing_field: event.target.value } }))}
                                      spellCheck={false}
                                      aria-label={`${item.web_label} 的领星字段路径`}
                                    />
                                  </td>
                                  <td className="px-3 py-2">
                                    <div className="flex items-center justify-end gap-1.5">
                                      <button
                                        className={ghostClass}
                                        disabled={busy || !changed}
                                        onClick={() => save({ action: 'field_mapping', web_field: key, export_label: row.export_label, lingxing_field: row.lingxing_field }, `${item.web_label} 映射已保存`)}
                                      >
                                        <Save className="h-3.5 w-3.5" />保存
                                      </button>
                                      <button
                                        className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                                        disabled={busy}
                                        title="恢复该字段默认值"
                                        onClick={() => save({ action: 'field_mapping_reset', web_field: key }, `${item.web_label} 已恢复默认`)}
                                      >
                                        <RotateCcw className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-[11px] leading-relaxed text-slate-500">
                  路径写法：<code className="font-mono text-slate-700">brands[]</code> 取数组第一个非空值 ·
                  <code className="ml-1 font-mono text-slate-700">parent_asins[].parent_asin</code> 取子字段 ·
                  <code className="ml-1 font-mono text-slate-700">seller_store_countries[0].country</code> 指定下标 ·
                  <code className="ml-1 font-mono text-slate-700">price_list[].local_name@max(volume)</code> 取销量最大的一条 ·
                  <code className="ml-1 font-mono text-slate-700">categories[]@level(2)</code> 按分隔符取第 2 段。<br />
                  比率列（CVR、销量CVR、CTR、广告CVR、CPC、ROAS、ACOS、ACoAS、ASoAS、自然CVR）由分子分母现算，不参与映射；成本与广告金额自动取绝对值。
                </div>
              </section>}

              {tab === 'targets' && <div className="space-y-4">
                <section className={cardClass}>
                  <h3 className={sectionTitle}>当前生效的目标表</h3>
                  {data.targetImport ? (
                    <p className={`${sectionHint} text-slate-700`}>{data.targetImport.source_filename} · {data.targetImport.expected_rows} 行 · {new Date(data.targetImport.activated_at).toLocaleString('zh-CN')} 上传</p>
                  ) : <p className={sectionHint}>尚未上传目标表。</p>}
                </section>
                <section className={cardClass}>
                  <h3 className={sectionTitle}>上传或替换</h3>
                  <p className={sectionHint}>支持“年份 × 月份”横向目标模板；零目标行不会存入云端。完整上传成功后才会替换当前版本。</p>
                  <input className={`${inputClass} mt-4 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700`} type="file" accept=".xlsx,.xls,.csv" onChange={event => setTargetFile(event.target.files?.[0] || null)} />
                  <button className={`${primaryClass} mt-3`} disabled={busy || !targetFile} onClick={() => void uploadTargets()}>
                    <Upload className="h-3.5 w-3.5" />上传并启用
                  </button>
                </section>
              </div>}

              {tab === 'data' && <div className="space-y-4">
                <section className={cardClass}>
                  <h3 className={sectionTitle}>抽查明细</h3>
                  <p className={sectionHint}>看某一天销售额最高的前 100 条，用来核对数字是否合理。</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input className={`${inputClass} w-auto`} type="date" value={date || data.sampleDate || ''} onChange={event => setDate(event.target.value)} />
                    <button className={primaryClass} disabled={busy} onClick={() => void load(date || data.sampleDate || '')}>查询</button>
                  </div>
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="text-[11px] uppercase tracking-wide text-slate-400">
                        <tr><th className="py-2 pr-3 font-medium">店铺</th><th className="py-2 pr-3 font-medium">ASIN</th><th className="py-2 pr-3 font-medium">品名</th><th className="py-2 pr-3 font-medium text-right">销售额</th><th className="py-2 pr-3 font-medium text-right">毛利</th><th className="py-2 font-medium text-right">广告花费</th></tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.data.map(row => (
                          <tr key={`${row.date}|${row.sid}|${row.asin}`} className="text-slate-700">
                            <td className="py-2.5 pr-3">{row.shop_name}</td>
                            <td className="py-2.5 pr-3 font-mono text-[11px]">{row.asin}</td>
                            <td className="max-w-[240px] truncate py-2.5 pr-3">{row.product_name}</td>
                            <td className="py-2.5 pr-3 text-right font-mono">{Number(row.sales_amount).toFixed(2)}</td>
                            <td className="py-2.5 pr-3 text-right font-mono">{Number(row.gross_profit).toFixed(2)}</td>
                            <td className="py-2.5 text-right font-mono">{Number(row.ad_spend).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!data.data.length && <p className="py-6 text-center text-xs text-slate-400">这一天没有明细</p>}
                  </div>
                </section>

                <section className={cardClass}>
                  <h3 className={sectionTitle}>下载每日明细</h3>
                  <p className={sectionHint}>列名与《项目业绩》表一致；列名可在「字段映射」里改。CSV 支持任意长度区间，Excel 单次最多 92 天。</p>
                  <div className="mt-4 inline-flex rounded-xl bg-slate-100 p-0.5 text-xs">
                    {([['day', '单日'], ['range', '时间段']] as const).map(([mode, label]) => (
                      <button key={mode} type="button" onClick={() => setExportMode(mode)} className={`rounded-lg px-3 py-1.5 font-medium transition ${exportMode === mode ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>{label}</button>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input className={`${inputClass} w-auto`} type="date" value={exportFrom} onChange={event => setExportFrom(event.target.value)} aria-label={exportMode === 'day' ? '下载日期' : '下载起始日期'} />
                    {exportMode === 'range' && <><span className="text-xs text-slate-400">至</span><input className={`${inputClass} w-auto`} type="date" value={exportTo} onChange={event => setExportTo(event.target.value)} aria-label="下载结束日期" /></>}
                    <button className={primaryClass} disabled={busy} onClick={() => void downloadDaily('csv')}><Download className="h-3.5 w-3.5" />CSV</button>
                    <button className={ghostClass} disabled={busy} onClick={() => void downloadDaily('xlsx')}><Download className="h-3.5 w-3.5" />Excel</button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {([['昨天', 1], ['近7天', 7], ['近30天', 30], ['全部（2025-01-01 起）', 0]] as const).map(([label, nights]) => (
                      <button
                        key={label}
                        type="button"
                        className="rounded-lg px-2 py-1 text-[11px] text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                        onClick={() => {
                          const end = new Date();
                          end.setDate(end.getDate() - (nights === 1 ? 1 : 0));
                          const start = new Date(end);
                          if (nights === 0) {
                            setExportFrom('2025-01-01');
                            setExportTo(localDate(end));
                            setExportMode('range');
                          } else if (nights === 1) {
                            setExportFrom(localDate(end));
                            setExportMode('day');
                          } else {
                            start.setDate(end.getDate() - (nights - 1));
                            setExportFrom(localDate(start));
                            setExportTo(localDate(end));
                            setExportMode('range');
                          }
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </section>
              </div>}

            </>}
          </div>
        </>}
      </div>
    </div>
  );
};

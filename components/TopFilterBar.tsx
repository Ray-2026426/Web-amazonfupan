import React, { useMemo, useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Check, Search, SlidersHorizontal, X } from 'lucide-react';
import { DataRow, FilterState, PeriodMode } from '../types';
import {
  formatDate,
  formatBusinessWeekFromDateStr,
  getBusinessWeekRangeFromYearWeek,
  startOfSundayWeekForDate,
} from '../utils';
import { SegmentedControl } from './ui/SegmentedControl';

interface TopFilterBarProps {
  data: DataRow[];
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  periodMode: PeriodMode;
  cloudConnected: boolean;
  onChangePeriodMode: (mode: PeriodMode) => void;
  onStepPeriod: (delta: -1 | 1) => void;
  onOpenMoreFilters: () => void;
}

const parseLocalDate = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

export function stepDateRange(
  startDate: string,
  endDate: string,
  mode: PeriodMode,
  delta: -1 | 1
): { startDate: string; endDate: string } {
  const start = parseLocalDate(startDate || formatDate(new Date()));
  if (mode === 'month') {
    const nextStart = new Date(start.getFullYear(), start.getMonth() + delta, 1);
    const nextEnd = new Date(nextStart.getFullYear(), nextStart.getMonth() + 1, 0);
    return { startDate: formatDate(nextStart), endDate: formatDate(nextEnd) };
  }
  if (mode === 'week') {
    const sun = startOfSundayWeekForDate(start);
    sun.setDate(sun.getDate() + delta * 7);
    const sat = new Date(sun);
    sat.setDate(sun.getDate() + 6);
    return { startDate: formatDate(sun), endDate: formatDate(sat) };
  }
  const end = parseLocalDate(endDate || startDate || formatDate(new Date()));
  const spanDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  const nextStart = new Date(start);
  nextStart.setDate(start.getDate() + delta * spanDays);
  const nextEnd = new Date(end);
  nextEnd.setDate(end.getDate() + delta * spanDays);
  return { startDate: formatDate(nextStart), endDate: formatDate(nextEnd) };
}

export function formatPeriodStepperLabel(startDate: string, endDate: string, mode: PeriodMode): string {
  if (!startDate) return '选择周期';
  if (mode === 'month') {
    const [y, m] = startDate.split('-');
    if (endDate && endDate.slice(0, 7) !== startDate.slice(0, 7)) {
      return `${startDate.slice(0, 7)} ~ ${endDate.slice(0, 7)}`;
    }
    return `${y} 年 ${Number(m)} 月`;
  }
  if (mode === 'week') {
    const wk = formatBusinessWeekFromDateStr(startDate);
    const match = wk.match(/^(\d{4})-W(\d+)$/);
    if (match) {
      const { end } = getBusinessWeekRangeFromYearWeek(Number(match[1]), Number(match[2]));
      const endIso = formatDate(end);
      if (endDate && endDate > endIso) {
        return `${wk} ~ ${formatBusinessWeekFromDateStr(endDate)}`;
      }
      return `第 ${Number(match[2])} 周`;
    }
    return wk;
  }
  if (endDate && endDate !== startDate) {
    return `${startDate.slice(5)} ~ ${endDate.slice(5)}`;
  }
  const [, m, d] = startDate.split('-');
  return `${Number(m)} 月 ${Number(d)} 日`;
}

const QuickDropdown: React.FC<{
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}> = ({ label, options, selected, onChange }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  const activeCount = selected.includes('__NONE__') ? 0 : selected.length;
  const summary =
    selected.length === 0
      ? '全部'
      : selected.includes('__NONE__')
      ? '0 项'
      : selected.length === 1
      ? selected[0]
      : `${selected.length} 项`;

  const toggle = (opt: string) => {
    if (selected.includes('__NONE__')) {
      onChange([opt]);
      return;
    }
    if (selected.length === 0) {
      onChange([opt]);
      return;
    }
    const next = selected.includes(opt) ? selected.filter((x) => x !== opt) : [...selected, opt];
    onChange(next.length === options.length ? [] : next);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[13px] transition ${
          activeCount > 0
            ? 'border-indigo-500/30 bg-[#eef2ff] text-[#4f46e5] dark:border-indigo-400/30 dark:bg-indigo-500/15 dark:text-indigo-300'
            : 'border-black/[0.06] bg-white text-[#424245] hover:border-black/[0.14] dark:border-white/[0.08] dark:bg-[#191c24] dark:text-[#c7c9d1]'
        }`}
      >
        <span className="text-[#86868b] dark:text-[#a7abb8]">{label}</span>
        <span className="max-w-[110px] truncate font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{summary}</span>
        <ChevronDown className="h-3.5 w-3.5 text-[#86868b]" />
      </button>

      {open && (
        <div className="absolute left-0 top-11 z-40 w-64 rounded-2xl border border-black/[0.08] bg-white p-2 shadow-[0_20px_48px_-16px_rgba(15,23,42,0.22)] dark:border-white/[0.1] dark:bg-[#191c24]">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[#86868b]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`搜索${label}…`}
              className="w-full rounded-xl border border-black/[0.06] bg-[#f5f5f7] py-1.5 pl-8 pr-2.5 text-xs text-[#1d1d1f] outline-none focus:border-indigo-500 dark:border-white/[0.08] dark:bg-[#151821] dark:text-[#f5f5f7]"
            />
          </div>
          <div className="mb-1.5 flex items-center justify-between px-1 text-[11px] text-[#86868b]">
            <button type="button" onClick={() => onChange([])} className="hover:text-[#4f46e5]">
              全部 ({options.length})
            </button>
            {selected.length > 0 && (
              <button type="button" onClick={() => onChange([])} className="text-[#4f46e5] hover:underline">
                重置
              </button>
            )}
          </div>
          <div className="max-h-56 overflow-y-auto custom-scroll">
            {filtered.length === 0 ? (
              <div className="py-4 text-center text-xs text-[#86868b]">无匹配项</div>
            ) : (
              filtered.map((opt) => {
                const checked = selected.length > 0 && !selected.includes('__NONE__') && selected.includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => toggle(opt)}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                      checked
                        ? 'bg-[#eef2ff] font-semibold text-[#4f46e5] dark:bg-indigo-500/20 dark:text-indigo-200'
                        : 'text-[#1d1d1f] hover:bg-black/[0.04] dark:text-[#e5e7eb] dark:hover:bg-white/[0.06]'
                    }`}
                  >
                    <span className="truncate">{opt}</span>
                    {checked && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const FILTER_LABELS: Array<{ key: keyof FilterState; label: string }> = [
  { key: 'countries', label: '国家' },
  { key: 'shops', label: '店铺' },
  { key: 'brands', label: '品牌' },
  { key: 'managers', label: '负责人' },
  { key: 'subCategories', label: '类目' },
  { key: 'parentAsins', label: '父ASIN' },
  { key: 'childAsins', label: '子ASIN' },
  { key: 'productNames', label: '品名' },
];

export const TopFilterBar: React.FC<TopFilterBarProps> = ({
  data,
  filters,
  setFilters,
  periodMode,
  cloudConnected,
  onChangePeriodMode,
  onStepPeriod,
  onOpenMoreFilters,
}) => {
  const { shopOptions, brandOptions } = useMemo(() => {
    const shops = new Set<string>();
    const brands = new Set<string>();
    for (const r of data) {
      if (r.shop_name) shops.add(r.shop_name);
      if (r.brand) brands.add(r.brand);
    }
    return {
      shopOptions: Array.from(shops).sort(),
      brandOptions: Array.from(brands).sort(),
    };
  }, [data]);

  const activeChips = useMemo(() => {
    const list: Array<{ key: keyof FilterState; label: string; text: string }> = [];
    for (const { key, label } of FILTER_LABELS) {
      const vals = filters[key];
      if (!Array.isArray(vals) || vals.length === 0) continue;
      const clean = vals.filter((v) => v !== '__NONE__');
      const text = clean.length === 0 ? '0 项' : clean.length === 1 ? clean[0] : `${clean.length} 项`;
      list.push({ key, label, text });
    }
    return list;
  }, [filters]);

  const extraFilterCount = activeChips.filter((c) => c.key !== 'shops' && c.key !== 'brands').length;

  const clearAllFilters = () => {
    setFilters((prev) => ({
      ...prev,
      countries: [],
      shops: [],
      brands: [],
      managers: [],
      subCategories: [],
      parentAsins: [],
      childAsins: [],
      productNames: [],
    }));
  };

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <SegmentedControl
        value={periodMode}
        onChange={onChangePeriodMode}
        options={[
          { value: 'month', label: '月' },
          { value: 'week', label: '周' },
          {
            value: 'day',
            label: '日',
            disabled: !cloudConnected,
            title: !cloudConnected ? '日度视图需要连接云端数据' : undefined,
          },
        ]}
      />

      {/* 周期步进器 */}
      <div className="inline-flex h-9 items-center gap-0.5 rounded-xl border border-black/[0.06] bg-white px-1 dark:border-white/[0.08] dark:bg-[#191c24]">
        <button
          type="button"
          onClick={() => onStepPeriod(-1)}
          title="上一期（快捷键 ←）"
          aria-label="上一期"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[#86868b] transition hover:bg-[#eef2ff] hover:text-[#4f46e5] dark:hover:bg-indigo-500/15"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onOpenMoreFilters}
          title="点击打开自定义日期区间"
          className="px-2 text-[13px] font-semibold text-[#1d1d1f] num-tabular dark:text-[#f5f5f7]"
        >
          {formatPeriodStepperLabel(filters.startDate, filters.endDate, periodMode)}
        </button>
        <button
          type="button"
          onClick={() => onStepPeriod(1)}
          title="下一期（快捷键 →）"
          aria-label="下一期"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[#86868b] transition hover:bg-[#eef2ff] hover:text-[#4f46e5] dark:hover:bg-indigo-500/15"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <QuickDropdown
        label="店铺"
        options={shopOptions}
        selected={filters.shops}
        onChange={(next) => setFilters((prev) => ({ ...prev, shops: next }))}
      />

      <QuickDropdown
        label="品牌"
        options={brandOptions}
        selected={filters.brands}
        onChange={(next) => setFilters((prev) => ({ ...prev, brands: next }))}
      />

      <button
        type="button"
        onClick={onOpenMoreFilters}
        className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[13px] font-medium transition ${
          extraFilterCount > 0
            ? 'border-indigo-500/30 bg-[#eef2ff] text-[#4f46e5] dark:border-indigo-400/30 dark:bg-indigo-500/15 dark:text-indigo-300'
            : 'border-black/[0.06] bg-white text-[#424245] hover:border-black/[0.14] dark:border-white/[0.08] dark:bg-[#191c24] dark:text-[#c7c9d1]'
        }`}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        <span>更多筛选</span>
        {extraFilterCount > 0 && (
          <span className="ml-0.5 rounded-full bg-[#4f46e5] px-1.5 py-0.2 text-[10px] font-bold text-white">
            {extraFilterCount}
          </span>
        )}
      </button>

      {activeChips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => setFilters((prev) => ({ ...prev, [chip.key]: [] }))}
          className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[#eef2ff] px-2.5 text-xs font-medium text-[#4f46e5] transition hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300"
        >
          <span>
            {chip.label}：{chip.text}
          </span>
          <X className="h-3 w-3" />
        </button>
      ))}

      {activeChips.length > 0 && (
        <button
          type="button"
          onClick={clearAllFilters}
          className="px-1.5 text-xs font-medium text-[#4f46e5] hover:underline dark:text-indigo-400"
        >
          清除全部
        </button>
      )}
    </div>
  );
};

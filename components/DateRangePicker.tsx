import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';
import type { PeriodMode } from '../types';
import { formatBusinessWeekFromDateStr, formatDate, getISOWeekDateRange } from '../utils';
import { useEscClose } from './useEscClose';

interface DateRangePickerProps {
    startDate: string;
    endDate: string;
    periodMode: PeriodMode;
    onChange: (start: string, end: string, mode: PeriodMode) => void;
}

const DAY_MS = 86400000;

const toDate = (text: string) => {
    const [y, m, d] = text.split('-').map(Number);
    return new Date(y || 1970, (m || 1) - 1, d || 1);
};

const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);

const presetRanges = (mode: PeriodMode): { label: string; start: Date; end: Date }[] => {
    const today = new Date();
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const shift = (base: Date, days: number) => new Date(base.getTime() + days * DAY_MS);
    const weekRange = (anchor: Date) => getISOWeekDateRange(anchor);

    if (mode === 'day') {
        return [
            { label: '今天', start: t, end: t },
            { label: '昨天', start: shift(t, -1), end: shift(t, -1) },
            { label: '前 7 天', start: shift(t, -7), end: shift(t, -1) },
            { label: '前 30 天', start: shift(t, -30), end: shift(t, -1) },
            { label: '近 7 天', start: shift(t, -6), end: t },
            { label: '近 30 天', start: shift(t, -29), end: t },
        ];
    }
    if (mode === 'week') {
        const current = weekRange(t);
        const last = weekRange(shift(t, -7));
        const four = weekRange(shift(t, -7 * 3));
        const eight = weekRange(shift(t, -7 * 7));
        return [
            { label: '本周', start: current.start, end: current.end },
            { label: '上周', start: last.start, end: last.end },
            { label: '近 4 周', start: four.start, end: current.end },
            { label: '近 8 周', start: eight.start, end: current.end },
        ];
    }
    const monthStart = startOfMonth(t);
    const lastMonthStart = new Date(t.getFullYear(), t.getMonth() - 1, 1);
    const lastMonthEnd = new Date(t.getFullYear(), t.getMonth(), 0);
    const minus = (n: number) => new Date(t.getFullYear(), t.getMonth() - n, 1);
    const thisMonthEnd = new Date(t.getFullYear(), t.getMonth() + 1, 0);
    return [
        { label: '本月', start: monthStart, end: thisMonthEnd },
        { label: '上月', start: lastMonthStart, end: lastMonthEnd },
        { label: '近 3 个月', start: minus(2), end: thisMonthEnd },
        { label: '近 6 个月', start: minus(5), end: thisMonthEnd },
    ];
};

/** 把某一天扩成「该粒度的完整周期」 */
const wrapToMode = (day: Date, mode: PeriodMode): { start: Date; end: Date } => {
    if (mode === 'week') return getISOWeekDateRange(day);
    if (mode === 'month') {
        return {
            start: new Date(day.getFullYear(), day.getMonth(), 1),
            end: new Date(day.getFullYear(), day.getMonth() + 1, 0),
        };
    }
    return { start: day, end: day };
};

const formatByMode = (date: Date, mode: PeriodMode) => {
    if (mode === 'week') return formatBusinessWeekFromDateStr(formatDate(date));
    if (mode === 'month') return formatDate(date).slice(0, 7);
    return formatDate(date);
};

export const DateRangePicker: React.FC<DateRangePickerProps> = ({ startDate, endDate, periodMode, onChange }) => {
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState<PeriodMode>(periodMode);
    const [pendingStart, setPendingStart] = useState<Date | null>(null);
    const [viewMonth, setViewMonth] = useState<Date>(() => startOfMonth(toDate(startDate)));
    const rootRef = useRef<HTMLDivElement>(null);

    useEscClose(open, () => setOpen(false));

    useEffect(() => {
        if (!open) return;
        setMode(periodMode);
        setPendingStart(null);
        setViewMonth(startOfMonth(toDate(startDate)));
    }, [open, periodMode, startDate]);

    // 点击外部关闭
    useEffect(() => {
        if (!open) return;
        const handler = (event: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const apply = (start: Date, end: Date, nextMode: PeriodMode = mode) => {
        const [a, b] = start.getTime() <= end.getTime() ? [start, end] : [end, start];
        onChange(formatDate(a), formatDate(b), nextMode);
        setPendingStart(null);
        setOpen(false);
    };

    const handleDayClick = (day: Date) => {
        if (!pendingStart) {
            setPendingStart(day);
            return;
        }
        const first = wrapToMode(pendingStart, mode);
        const second = wrapToMode(day, mode);
        apply(first.start, second.end);
    };

    const months = useMemo(() => {
        const first = startOfMonth(viewMonth);
        const second = new Date(first.getFullYear(), first.getMonth() + 1, 1);
        return [first, second];
    }, [viewMonth]);

    const rangeStart = toDate(startDate);
    const rangeEnd = toDate(endDate);
    const startIso = formatDate(rangeStart);
    const endIso = formatDate(rangeEnd);

    const triggerText = `${formatByMode(rangeStart, periodMode)} → ${formatByMode(rangeEnd, periodMode)}`;

    return (
        <div className="relative" ref={rootRef}>
            <button
                type="button"
                onClick={() => setOpen(value => !value)}
                className="flex w-full items-center justify-between gap-2 rounded-2xl border border-slate-700 bg-slate-900/70 px-3 py-2.5 text-left transition hover:border-sky-500/60"
            >
                <span className="flex min-w-0 items-center gap-2">
                    <CalendarRange className="h-3.5 w-3.5 shrink-0 text-sky-300" />
                    <span className="truncate font-mono text-xs font-semibold text-slate-100">{triggerText}</span>
                </span>
                <span className="shrink-0 rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                    {mode === 'day' ? '按天' : mode === 'week' ? '按周' : '按月'}
                </span>
            </button>

            {open && (
                <div className="absolute bottom-full left-0 z-[60] mb-2 flex w-[280px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl sm:w-[520px] sm:flex-row">
                    {/* 左栏：粒度 + 快捷区间 */}
                    <div className="flex shrink-0 gap-1 border-b border-slate-100 p-2 sm:w-32 sm:flex-col sm:border-b-0 sm:border-r">
                        <div className="flex gap-1 sm:flex-col sm:gap-0.5">
                            {([['day', '按天'], ['week', '按周'], ['month', '按月']] as const).map(([value, label]) => (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() => { setMode(value); setPendingStart(null); }}
                                    className={`flex-1 rounded-lg px-2 py-1.5 text-left text-xs font-medium transition sm:flex-none ${mode === value ? 'bg-sky-50 text-sky-700' : 'text-slate-600 hover:bg-slate-50'}`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                        <div className="flex flex-1 flex-wrap gap-1 sm:mt-2 sm:flex-col sm:flex-nowrap">
                            {presetRanges(mode).map(preset => (
                                <button
                                    key={preset.label}
                                    type="button"
                                    onClick={() => apply(preset.start, preset.end)}
                                    className="rounded-lg px-2 py-1 text-left text-[11px] text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                                >
                                    {preset.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 右栏：双月日历 */}
                    <div className="flex-1 p-3">
                        <div className="mb-2 flex items-center justify-between">
                            <button type="button" onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))} className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="上个月">
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <div className="flex-1 text-center text-xs font-semibold text-slate-700">
                                {months.map(m => `${m.getFullYear()} 年 ${m.getMonth() + 1} 月`).join('  /  ')}
                            </div>
                            <button type="button" onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))} className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="下个月">
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            {months.map(month => {
                                const lead = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
                                const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
                                const cells: (Date | null)[] = Array.from({ length: lead }, () => null);
                                for (let day = 1; day <= daysInMonth; day += 1) {
                                    cells.push(new Date(month.getFullYear(), month.getMonth(), day));
                                }
                                return (
                                    <div key={`${month.getFullYear()}-${month.getMonth()}`}>
                                        <div className="mb-1 grid grid-cols-7 text-center text-[10px] text-slate-400">
                                            {['日', '一', '二', '三', '四', '五', '六'].map(label => <span key={label}>{label}</span>)}
                                        </div>
                                        <div className="grid grid-cols-7 gap-0.5 text-center">
                                            {cells.map((date, index) => {
                                                if (!date) return <span key={`blank-${index}`} />;
                                                const iso = formatDate(date);
                                                const inRange = iso >= startIso && iso <= endIso;
                                                const isEdge = iso === startIso || iso === endIso;
                                                const isPending = pendingStart ? formatDate(wrapToMode(pendingStart, mode).start) === iso || formatDate(wrapToMode(pendingStart, mode).end) === iso : false;
                                                return (
                                                    <button
                                                        key={iso}
                                                        type="button"
                                                        onClick={() => handleDayClick(date)}
                                                        className={`h-7 rounded-md text-[11px] transition ${
                                                            isEdge
                                                                ? 'bg-sky-600 font-semibold text-white'
                                                                : isPending
                                                                    ? 'bg-sky-100 text-sky-800'
                                                                    : inRange
                                                                        ? 'bg-sky-50 text-sky-800'
                                                                        : 'text-slate-700 hover:bg-slate-100'
                                                        }`}
                                                    >
                                                        {date.getDate()}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
                            {pendingStart ? '再点一天作为区间结束' : mode === 'day' ? '点两天选择区间；同一天即单日' : mode === 'week' ? '点任意一天选中整周，再点另一天选结束周' : '点任意一天选中整月，再点另一天选结束月'}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};

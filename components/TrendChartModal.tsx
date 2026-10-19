import React, { useMemo, useState, useEffect, useRef } from 'react';
import { X, TrendingUp } from 'lucide-react';
import { DataRow, TargetRow } from '../types';
import {
    aggregateData,
    formatMoney,
    formatMoneyNoDecimals,
    formatNumber,
    formatPercent,
    formatBusinessWeekFromDateStr,
    getBusinessWeekRangeFromYearWeek,
    allocateWeeklyTargetsLegacy,
} from '../utils';
import {
    Area,
    CartesianGrid,
    ComposedChart,
    Line,
    ReferenceDot,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { useEscClose } from './useEscClose';
import { getTrendMetricsSelection, setTrendMetricsSelection } from './trendSelection';
import {
    buildAxisTickLabels,
    compactTick,
    formatDelta,
    formatPeriodLabel,
    seriesColor,
    useChartTheme,
} from './chartTheme';
import { ChartTooltipCard, TooltipRow } from './ChartTooltip';

export interface TrendColumn {
    title: string;
    shortLabel?: string;
    dataKey?: string;
    key?: string;
    calculator?: (d: any) => number;
    isPercent: boolean;
    isMoney: boolean;
    metricGroup?: 'result' | 'process' | 'target';
}

export type TrendChartScope =
    | { mode: 'dimensions'; dimensions: Record<string, string> }
    | {
          mode: 'total';
          dimFilters: Record<string, string[]>;
          selectedDimensions: string[];
          visibleGroupKeys: string[];
      };

interface TrendChartModalProps {
    isOpen: boolean;
    onClose: () => void;
    rawMonthly: DataRow[];
    rawWeekly: DataRow[];
    scope: TrendChartScope;
    sidebarWeeklyMode: boolean;
    columns: TrendColumn[];
    targetRows?: TargetRow[];
}

const DEFAULT_METRIC_TITLES = ['销量', '毛利率', '广告占比', '退款占比', '头程占比'];

/** 跨趋势图共享的指标选择，仅在用户手动切换后写入；更新数据源时重置 */
const getDefaultMetrics = (columns: TrendColumn[]): string[] => {
    const preferred = DEFAULT_METRIC_TITLES.filter(t => columns.some(c => c.title === t));
    return preferred.length > 0 ? preferred : columns.slice(0, Math.min(5, columns.length)).map(c => c.title);
};

const resolveInitialMetrics = (columns: TrendColumn[]): string[] => {
    if (getTrendMetricsSelection()) {
        const valid = getTrendMetricsSelection()!.filter(t => columns.some(c => c.title === t));
        if (valid.length > 0) return valid;
    }
    return getDefaultMetrics(columns);
};

/** 指标分组：单选一组展示，避免三行 9px 小标签挤在一起 */
const METRIC_GROUPS: { key: 'result' | 'process' | 'target'; label: string }[] = [
    { key: 'result', label: '结果' },
    { key: 'process', label: '过程' },
    { key: 'target', label: '目标' },
];

const RANGE_OPTIONS = [6, 12, 0] as const;

const weekKeysForMonth = (monthKey: string): string[] => {
    const [y, m] = monthKey.split('-').map(Number);
    if (!y || !m) return [];
    const dim = new Date(y, m, 0).getDate();
    const keys = new Set<string>();
    for (let d = 1; d <= dim; d++) {
        const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        keys.add(formatBusinessWeekFromDateStr(dateStr));
    }
    return Array.from(keys);
};

const rowPassesDimFilters = (row: DataRow, dimFilters: Record<string, string[]>, sidebarWeekly: boolean) => {
    return Object.entries(dimFilters).every(([dimKey, selectedVals]) => {
        const vals = selectedVals as string[];
        if (vals.length === 0) return true;
        let rowVal = '';
        if (dimKey === 'year_month') {
            rowVal = sidebarWeekly ? formatBusinessWeekFromDateStr(row.date) : row.date.substring(0, 7);
        } else {
            rowVal = String((row as any)[dimKey] ?? '');
        }
        return vals.includes(rowVal);
    });
};

const compositeKeyForRow = (row: DataRow, selectedDimensions: string[], sidebarWeekly: boolean) =>
    selectedDimensions
        .map(d => {
            if (d === 'year_month') return sidebarWeekly ? formatBusinessWeekFromDateStr(row.date) : row.date.substring(0, 7);
            return String((row as any)[d] || 'Unknown');
        })
        .join('|||');

const compositeKeyForTargetRow = (t: TargetRow, selectedDimensions: string[], sidebarWeekly: boolean) =>
    selectedDimensions
        .map(d => {
            if (d === 'year_month') return sidebarWeekly ? formatBusinessWeekFromDateStr(`${t.month}-15`) : t.month;
            return String((t as any)[d] || 'Unknown');
        })
        .join('|||');

const targetRowPassesDimFilters = (t: TargetRow, dimFilters: Record<string, string[]>, sidebarWeekly: boolean) =>
    Object.entries(dimFilters).every(([dimKey, selectedVals]) => {
        const vals = selectedVals as string[];
        if (vals.length === 0) return true;
        let rowVal = '';
        if (dimKey === 'year_month') {
            rowVal = sidebarWeekly ? formatBusinessWeekFromDateStr(`${t.month}-15`) : t.month;
        } else {
            rowVal = String((t as any)[dimKey] ?? '');
        }
        return vals.includes(rowVal);
    });

/** 列头筛选里对「年月/年周」的过滤只作用于业绩行；目标行按其它维度筛，避免未来月目标被挡掉 */
const dimFiltersForTargets = (dimFilters: Record<string, string[]>): Record<string, string[]> => {
    const { year_month: _ym, ...rest } = dimFilters;
    return rest;
};

/** 子表按「时间+其它维度」拆行时：业绩仍按可见行；目标则匹配「同一组非时间维度」下所有月份/周的目标 */
const targetMatchesVisibleGroupLoose = (
    t: TargetRow,
    scope: Extract<TrendChartScope, { mode: 'total' }>,
    sidebarWeekly: boolean
): boolean => {
    const dims = scope.selectedDimensions;
    const ymIdx = dims.indexOf('year_month');
    if (ymIdx < 0) {
        const k = compositeKeyForTargetRow(t, dims, sidebarWeekly);
        return scope.visibleGroupKeys.includes(k);
    }
    const tParts = compositeKeyForTargetRow(t, dims, sidebarWeekly).split('|||');
    if (tParts.length !== dims.length) return false;
    return scope.visibleGroupKeys.some(vk => {
        const vParts = vk.split('|||');
        if (vParts.length !== tParts.length) return false;
        for (let i = 0; i < tParts.length; i++) {
            if (i === ymIdx) continue;
            if (vParts[i] !== tParts[i]) return false;
        }
        return true;
    });
};

type TgAcc = { sq: number; sa: number; gp: number; ad: number };

export const TrendChartModal: React.FC<TrendChartModalProps> = ({
    isOpen,
    onClose,
    rawMonthly,
    rawWeekly,
    scope,
    sidebarWeeklyMode,
    columns,
    targetRows = []
}) => {
    const [selectedMetrics, setSelectedMetrics] = useState<string[]>([]);
    const [chartWeekly, setChartWeekly] = useState(false);
    const [metricGroup, setMetricGroup] = useState<'result' | 'process' | 'target'>('result');
    const [rangeCount, setRangeCount] = useState<number>(12);
    const wasTrendOpenRef = useRef(false);
    const theme = useChartTheme();

    /** 仅在趋势弹窗从关→开时同步指标，避免父组件重渲染导致 columns 引用变化而把已选指标冲掉 */
    useEffect(() => {
        if (isOpen && !wasTrendOpenRef.current) {
            const initial = resolveInitialMetrics(columns);
            setSelectedMetrics(initial);
            // 打开时落在「有已选指标」的分组，避免默认停在空分组上
            const firstSelectedCol = columns.find(c => c.title === initial[0]);
            if (firstSelectedCol?.metricGroup) setMetricGroup(firstSelectedCol.metricGroup);
        }
        wasTrendOpenRef.current = isOpen;
    }, [isOpen, columns]);

    /** 弹窗打开期间跟随侧栏月/周切换 */
    useEffect(() => {
        if (isOpen) setChartWeekly(sidebarWeeklyMode);
    }, [isOpen, sidebarWeeklyMode]);

    const toggleMetric = (title: string) => {
        setSelectedMetrics(prev => {
            let next: string[];
            if (prev.includes(title)) {
                if (prev.length === 1) return prev;
                next = prev.filter(m => m !== title);
            } else if (prev.length >= 7) {
                return prev;
            } else {
                next = [...prev, title];
            }
            setTrendMetricsSelection(next);
            return next;
        });
    };

    const baseRaw = chartWeekly ? rawWeekly : rawMonthly;

    const chartData = useMemo(() => {
        if (!isOpen || !baseRaw || baseRaw.length === 0) return [];

        let filteredData: DataRow[];
        if (scope.mode === 'dimensions') {
            const { dimensions } = scope;
            filteredData = baseRaw.filter(row => {
                return Object.entries(dimensions).every(([dimKey, dimVal]) => {
                    if (dimKey === 'year_month') return true;
                    return String((row as any)[dimKey]) === String(dimVal);
                });
            });
        } else {
            const keySet = new Set(scope.visibleGroupKeys);
            filteredData = baseRaw.filter(row => {
                if (!rowPassesDimFilters(row, scope.dimFilters, sidebarWeeklyMode)) return false;
                const k = compositeKeyForRow(row, scope.selectedDimensions, sidebarWeeklyMode);
                return keySet.has(k);
            });
        }

        const timeGroups: Record<string, DataRow[]> = {};
        filteredData.forEach(row => {
            const timeKey = chartWeekly ? formatBusinessWeekFromDateStr(row.date) : row.date.substring(0, 7);
            if (!timeGroups[timeKey]) timeGroups[timeKey] = [];
            timeGroups[timeKey].push(row);
        });

        let filteredTargets: TargetRow[] = targetRows;
        if (scope.mode === 'dimensions') {
            const { dimensions } = scope;
            filteredTargets = targetRows.filter(t =>
                Object.entries(dimensions).every(([dimKey, dimVal]) => {
                    if (dimKey === 'year_month') return true;
                    return String((t as any)[dimKey]) === String(dimVal);
                })
            );
        } else {
            const keySet = new Set(scope.visibleGroupKeys);
            const tgtDimFilters = dimFiltersForTargets(scope.dimFilters);
            filteredTargets = targetRows.filter(t => {
                if (!targetRowPassesDimFilters(t, tgtDimFilters, sidebarWeeklyMode)) return false;
                if (scope.selectedDimensions.includes('year_month')) {
                    return targetMatchesVisibleGroupLoose(t, scope, sidebarWeeklyMode);
                }
                const k = compositeKeyForTargetRow(t, scope.selectedDimensions, sidebarWeeklyMode);
                return keySet.has(k);
            });
        }

        const targetByMonth: Record<string, TgAcc> = {};
        filteredTargets.forEach(t => {
            const cur = targetByMonth[t.month] || { sq: 0, sa: 0, gp: 0, ad: 0 };
            cur.sq += t.sales_quantity_target;
            cur.sa += t.sales_amount_target;
            cur.gp += t.gross_profit_target;
            cur.ad += t.ad_spend_target;
            targetByMonth[t.month] = cur;
        });

        /** 仅当勾选了「目标」类指标时，才把有目标但尚无业绩的月份/周补进横轴 */
        const extendAxisForTargets = selectedMetrics.some(title =>
            columns.some(c => c.title === title && c.metricGroup === 'target')
        );

        const allTimeKeys = new Set(Object.keys(timeGroups));
        if (extendAxisForTargets) {
            Object.keys(targetByMonth).forEach(monthKey => {
                if (chartWeekly) {
                    weekKeysForMonth(monthKey).forEach(wk => allTimeKeys.add(wk));
                } else {
                    allTimeKeys.add(monthKey);
                }
            });
        }

        const aggregated = Array.from(allTimeKeys).sort().map(timeKey => {
            const agg = aggregateData(timeGroups[timeKey] || []);
            const rowData: any = { time: timeKey };

            columns.forEach(col => {
                if (col.metricGroup === 'target') return;
                if (col.calculator) {
                    rowData[col.title] = col.calculator(agg);
                } else if (col.key) {
                    rowData[col.title] = (agg as any)[col.key] || 0;
                }
            });

            return rowData;
        });

        const withTargets = aggregated.map(row => {
            const tg = chartWeekly
                ? allocateWeeklyTargetsLegacy(row.time, targetByMonth)
                : targetByMonth[row.time] || { sq: 0, sa: 0, gp: 0, ad: 0 };
            const gm = tg.sa > 0 ? tg.gp / tg.sa : 0;
            const ar = tg.sa > 0 ? tg.ad / tg.sa : 0;
            return {
                ...row,
                tg_sales_quantity: tg.sq,
                tg_sales_amount: tg.sa,
                tg_gross_profit: tg.gp,
                tg_gross_margin: gm,
                tg_ad_spend: tg.ad,
                tg_ad_ratio: ar
            };
        });

        /** 期数裁剪：只留最近 N 期（含未来目标月），横轴才不会被 3 年历史压成一团 */
        const sliced = rangeCount > 0 && withTargets.length > rangeCount
            ? withTargets.slice(-rangeCount)
            : withTargets;

        const tickLabels = buildAxisTickLabels(sliced.map(r => r.time), chartWeekly);
        return sliced.map(row => ({ ...row, __tick: tickLabels[row.time] }));
    }, [isOpen, baseRaw, scope, chartWeekly, sidebarWeeklyMode, columns, targetRows, selectedMetrics, rangeCount]);

    useEscClose(isOpen, onClose);

    if (!isOpen) return null;

    const title =
        scope.mode === 'dimensions'
            ? Object.entries(scope.dimensions)
                  .filter(([k]) => k !== 'year_month')
                  .map(([_, v]) => v)
                  .join(' > ') || '全局'
            : '子表总计（当前筛选与可见分组）';

    const canWeekly = rawWeekly.length > 0;
    const canMonthly = rawMonthly.length > 0;

    const seriesKeyOf = (col: TrendColumn) => col.dataKey || col.title;

    const formatSeriesValue = (col: TrendColumn | undefined, value: number) => {
        if (!col) return formatNumber(value);
        if (col.isPercent) return formatPercent(value);
        if (col.isMoney) {
            return Math.abs(value) >= 100 ? formatMoneyNoDecimals(value) : formatMoney(value);
        }
        if (col.title === 'CPC') return `$${value.toFixed(2)}`;
        if (col.title === '评分') return value.toFixed(1);
        return formatNumber(value);
    };

    const chipLabel = (col: TrendColumn) => {
        if (col.metricGroup === 'target') return `${col.shortLabel || col.title.replace('（目标）', '')}目标`;
        return col.shortLabel || col.title;
    };

    const selectedCols = selectedMetrics
        .map(t => columns.find(c => c.title === t))
        .filter((c): c is TrendColumn => Boolean(c));

    const hasAbsolute = selectedCols.some(c => !c.isPercent);
    const hasPercent = selectedCols.some(c => c.isPercent);
    const allAbsoluteAreMoney = selectedCols.filter(c => !c.isPercent).every(c => c.isMoney);
    const singleSeries = selectedCols.length === 1;

    const lastRow = chartData[chartData.length - 1];

    const groupColumns = columns.filter(c => (c.metricGroup || 'result') === metricGroup);
    const rangeLabel = (n: number) => (n === 0 ? '全部' : `近${n}${chartWeekly ? '周' : '月'}`);

    const renderTooltip = ({ active, payload, label }: any) => {
        if (!active || !payload || payload.length === 0) return null;
        const index = chartData.findIndex(d => d.time === label);
        if (index < 0) return null;
        const row: any = chartData[index];
        const prev: any = index > 0 ? chartData[index - 1] : undefined;
        const period = formatPeriodLabel(String(label), getBusinessWeekRangeFromYearWeek);

        const rows: TooltipRow[] = selectedCols.map((col, idx) => {
            const seriesKey = seriesKeyOf(col);
            const value = Number(row[seriesKey] ?? 0);
            const delta = prev ? formatDelta(value, Number(prev[seriesKey] ?? 0)) : null;
            return {
                key: col.title,
                color: seriesColor(theme, idx),
                label: chipLabel(col),
                value: formatSeriesValue(col, value),
                hollow: col.metricGroup === 'target',
                muted: col.metricGroup === 'target',
                delta: delta ?? undefined,
            };
        });

        const single = rows.length === 1;
        return (
            <ChartTooltipCard
                theme={theme}
                title={period.title}
                subtitle={period.subtitle}
                delta={single ? rows[0].delta : undefined}
                rows={rows.map(r => (single ? { ...r, delta: undefined } : r))}
            />
        );
    };

    return (
        <div role="dialog" aria-modal="true" aria-label="趋势图" tabIndex={-1} className="fixed inset-0 z-[110] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="flex h-[88vh] w-full max-w-[min(96vw,86.4rem)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10">
                {/* 顶栏：与「详细数据分析」保持同一套深色头部 */}
                <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-700/50 bg-gradient-to-r from-slate-800 to-slate-700 px-4 py-2.5 text-white">
                    <div className="flex min-w-0 items-center gap-2.5">
                        <div className="flex-shrink-0 rounded-lg bg-white/10 p-1.5 ring-1 ring-white/15">
                            <TrendingUp className="h-4 w-4 text-sky-300" />
                        </div>
                        <div className="min-w-0">
                            <h2 className="truncate text-sm font-semibold tracking-tight">趋势 · {title}</h2>
                            <p className="truncate text-[10px] text-slate-300/80">实线为实际、虚线为目标 · 最多同时对比 7 项</p>
                        </div>
                    </div>
                    <button type="button" onClick={onClose} className="flex-shrink-0 rounded-full p-1.5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50">
                    {/* 指标选择：分组切换 + 单行 chips，替代原来的三行 9px 小标签 */}
                    <div className="flex-shrink-0 border-b border-slate-200/90 bg-white px-3 py-2">
                        <div className="flex items-center gap-2">
                            <div className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5">
                                {METRIC_GROUPS.map(g => {
                                    const active = metricGroup === g.key;
                                    const count = columns.filter(
                                        c => (c.metricGroup || 'result') === g.key && selectedMetrics.includes(c.title)
                                    ).length;
                                    return (
                                        <button
                                            key={g.key}
                                            type="button"
                                            onClick={() => setMetricGroup(g.key)}
                                            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${
                                                active
                                                    ? 'bg-white text-slate-800 shadow-sm ring-1 ring-slate-200/70'
                                                    : 'text-slate-500 hover:text-slate-700'
                                            }`}
                                        >
                                            {g.label}
                                            {count > 0 && (
                                                <span className={`ml-1 font-mono text-[9px] ${active ? 'text-sky-600' : 'text-slate-400'}`}>
                                                    {count}
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="h-4 w-px shrink-0 bg-slate-200" aria-hidden />
                            <div className="custom-scroll flex min-w-0 flex-1 gap-1 overflow-x-auto pb-0.5">
                                {groupColumns.map(col => {
                                    const selectedIdx = selectedMetrics.indexOf(col.title);
                                    const isSelected = selectedIdx >= 0;
                                    const color = isSelected
                                        ? seriesColor(theme, selectedIdx)
                                        : col.metricGroup === 'target'
                                          ? theme.target
                                          : theme.textSubtle;
                                    return (
                                        <button
                                            key={col.title}
                                            type="button"
                                            onClick={() => toggleMetric(col.title)}
                                            title={col.title}
                                            className="flex flex-shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-all hover:-translate-y-px"
                                            style={{
                                                borderColor: isSelected ? `${color}66` : 'transparent',
                                                backgroundColor: isSelected ? `${color}14` : 'rgba(148,163,184,0.10)',
                                                color: isSelected ? theme.text : theme.textMuted,
                                            }}
                                        >
                                            <span
                                                aria-hidden
                                                className="h-1.5 w-1.5 rounded-full"
                                                style={{ backgroundColor: color, opacity: isSelected ? 1 : 0.45 }}
                                            />
                                            {chipLabel(col)}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    <div className="min-h-0 flex-1 overflow-hidden p-3">
                        {chartData.length === 0 ? (
                            <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl border border-slate-200/90 bg-white">
                                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" className="text-slate-300" aria-hidden>
                                    <path d="M4 19V5M4 19h16" strokeLinecap="round" />
                                    <path d="M7 15l3.5-4 3 2.4L19 7" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
                                </svg>
                                <p className="text-sm text-slate-400">暂无历史趋势数据</p>
                                <p className="text-[11px] text-slate-300">上传月度或周度业绩表后即可查看趋势</p>
                            </div>
                        ) : (
                            <div className="flex h-full flex-col rounded-xl border border-slate-200/90 bg-white shadow-sm">
                                {/* 图例 + 当前值（同时充当范围/粒度控制条） */}
                                <div className="flex flex-shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-slate-100 px-3 py-2">
                                    <div className="custom-scroll flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-0.5">
                                        {selectedCols.map((col, idx) => {
                                            const color = seriesColor(theme, idx);
                                            const lastValue = lastRow ? Number((lastRow as any)[seriesKeyOf(col)] ?? 0) : 0;
                                            return (
                                                <button
                                                    key={col.title}
                                                    type="button"
                                                    onClick={() => toggleMetric(col.title)}
                                                    title="点击从图表中移除"
                                                    className="group inline-flex flex-shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10.5px] font-medium transition-colors"
                                                    style={{
                                                        borderColor: `${color}40`,
                                                        backgroundColor: `${color}0d`,
                                                        color: theme.text,
                                                    }}
                                                >
                                                    <span
                                                        aria-hidden
                                                        className="shrink-0 rounded-full"
                                                        style={
                                                            col.metricGroup === 'target'
                                                                ? { width: 7, height: 7, border: `2px solid ${color}` }
                                                                : { width: 7, height: 7, backgroundColor: color }
                                                        }
                                                    />
                                                    <span className="whitespace-nowrap">{chipLabel(col)}</span>
                                                    <span
                                                        className="whitespace-nowrap font-mono tabular-nums"
                                                        style={{ color: theme.textMuted }}
                                                    >
                                                        {formatSeriesValue(col, lastValue)}
                                                    </span>
                                                    <X
                                                        className="h-2.5 w-2.5 opacity-0 transition-opacity group-hover:opacity-50"
                                                        aria-hidden
                                                    />
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <div className="flex flex-shrink-0 items-center gap-2">
                                        <div className="inline-flex rounded-md bg-slate-100 p-0.5">
                                            <button
                                                type="button"
                                                disabled={!canMonthly}
                                                onClick={() => canMonthly && setChartWeekly(false)}
                                                className={`rounded px-2 py-0.5 text-[10.5px] font-medium transition-all ${
                                                    !chartWeekly ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                                                } disabled:cursor-not-allowed disabled:opacity-40`}
                                            >
                                                月
                                            </button>
                                            <button
                                                type="button"
                                                disabled={!canWeekly}
                                                onClick={() => canWeekly && setChartWeekly(true)}
                                                className={`rounded px-2 py-0.5 text-[10.5px] font-medium transition-all ${
                                                    chartWeekly ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                                                } disabled:cursor-not-allowed disabled:opacity-40`}
                                            >
                                                周
                                            </button>
                                        </div>
                                        <div className="inline-flex rounded-md bg-slate-100 p-0.5">
                                            {RANGE_OPTIONS.map(n => (
                                                <button
                                                    key={n}
                                                    type="button"
                                                    onClick={() => setRangeCount(n)}
                                                    className={`rounded px-2 py-0.5 text-[10.5px] font-medium transition-all ${
                                                        rangeCount === n ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                                                    }`}
                                                >
                                                    {rangeLabel(n)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="min-h-0 flex-1 px-1.5 pb-1 pt-2">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ComposedChart data={chartData} margin={{ top: 12, right: 14, left: 4, bottom: 2 }}>
                                            <defs>
                                                {selectedCols.map((col, idx) => {
                                                    const color = seriesColor(theme, idx);
                                                    return (
                                                        <linearGradient key={col.title} id={`trend-grad-${idx}`} x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="0%" stopColor={color} stopOpacity={0.18} />
                                                            <stop offset="100%" stopColor={color} stopOpacity={0} />
                                                        </linearGradient>
                                                    );
                                                })}
                                            </defs>
                                            <CartesianGrid
                                                horizontal
                                                vertical={false}
                                                stroke={theme.grid}
                                                strokeWidth={1}
                                            />
                                            <XAxis
                                                dataKey="time"
                                                tickFormatter={(v: string) => {
                                                    const found = chartData.find(d => d.time === v);
                                                    return found ? (found as any).__tick : v;
                                                }}
                                                tick={{ fontSize: 11, fill: theme.axisTick }}
                                                tickMargin={8}
                                                axisLine={false}
                                                tickLine={false}
                                                minTickGap={16}
                                                interval="preserveStartEnd"
                                            />

                                            {hasAbsolute && (
                                                <YAxis
                                                    yAxisId="left"
                                                    tickFormatter={(v: number) => compactTick(v, { isMoney: allAbsoluteAreMoney })}
                                                    tick={{ fontSize: 11, fill: theme.axisTick }}
                                                    axisLine={false}
                                                    tickLine={false}
                                                    width={54}
                                                    tickCount={5}
                                                />
                                            )}

                                            {hasPercent && (
                                                <YAxis
                                                    yAxisId="right"
                                                    orientation="right"
                                                    tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                                                    tick={{ fontSize: 11, fill: theme.axisTick }}
                                                    axisLine={false}
                                                    tickLine={false}
                                                    width={44}
                                                    tickCount={4}
                                                />
                                            )}

                                            <Tooltip
                                                content={renderTooltip}
                                                cursor={{ stroke: theme.cursor, strokeWidth: 1, strokeDasharray: '3 3' }}
                                                wrapperStyle={{ outline: 'none', zIndex: 40 }}
                                            />

                                            {/* 单指标时铺一层极淡渐变，给主指标一点视觉重量；多指标互相叠加会糊，故不加 */}
                                            {singleSeries && !selectedCols[0].isPercent && (
                                                <Area
                                                    yAxisId="left"
                                                    type="linear"
                                                    dataKey={seriesKeyOf(selectedCols[0])}
                                                    stroke="none"
                                                    fill="url(#trend-grad-0)"
                                                    isAnimationActive={false}
                                                    activeDot={false}
                                                />
                                            )}

                                            {selectedCols.map((col, idx) => {
                                                const color = seriesColor(theme, idx);
                                                const isTarget = col.metricGroup === 'target';
                                                return (
                                                    <Line
                                                        key={col.title}
                                                        yAxisId={col.isPercent ? 'right' : 'left'}
                                                        type="linear"
                                                        dataKey={seriesKeyOf(col)}
                                                        name={chipLabel(col)}
                                                        stroke={color}
                                                        strokeWidth={isTarget ? 1.6 : 2.25}
                                                        strokeDasharray={isTarget ? '4 4' : undefined}
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                        dot={false}
                                                        isAnimationActive={false}
                                                        activeDot={{ r: 4.5, strokeWidth: 3, stroke: theme.surface, fill: color }}
                                                    />
                                                );
                                            })}

                                            {/* 末端点：只标「最新一期」，避免每个点都带白心圆点 */}
                                            {selectedCols.map((col, idx) => {
                                                const seriesKey = seriesKeyOf(col);
                                                const lastValue = lastRow ? Number((lastRow as any)[seriesKey] ?? 0) : NaN;
                                                if (!lastRow || col.metricGroup === 'target' || !Number.isFinite(lastValue)) return null;
                                                return (
                                                    <ReferenceDot
                                                        key={`dot-${col.title}`}
                                                        yAxisId={col.isPercent ? 'right' : 'left'}
                                                        x={(lastRow as any).time}
                                                        y={lastValue}
                                                        r={3.4}
                                                        fill={seriesColor(theme, idx)}
                                                        stroke={theme.surface}
                                                        strokeWidth={2}
                                                        isFront
                                                    />
                                                );
                                            })}
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { X, TrendingUp, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { DataRow, TargetRow, PeriodMode } from '../types';
import {
    aggregateData,
    formatMoney,
    formatMoneyNoDecimals,
    formatNumber,
    formatPercent,
    formatBusinessWeekFromDateStr,
    getBusinessWeekRangeFromYearWeek,
    allocateWeeklyTargetsLegacy,
    periodKeyOf,
    periodUnitLabel,
} from '../utils';
import {
    Bar,
    CartesianGrid,
    Cell,
    ComposedChart,
    LabelList,
    Line,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { useEscClose } from './useEscClose';
import { getTrendMetricsSelection, setTrendMetricsSelection } from './trendSelection';
import {
    buildAxisTickLabels,
    buildNiceAxis,
    compactCount,
    compactNumber,
    compactTick,
    formatDelta,
    formatPeriodLabel,
    seriesColor,
    useChartTheme,
} from './chartTheme';
import { ChartTooltipCard, TooltipRow } from './ChartTooltip';
import { MetricSparkline } from './MetricSparkline';
import { buildTrendInsight, isCostMetric } from '../utils/trendInsight';

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
    /** 日粒度行（仅云端同步提供），没有时「日」按钮置灰 */
    rawDaily?: DataRow[];
    scope: TrendChartScope;
    /** 当前看板粒度，作为弹窗打开时的默认粒度 */
    periodMode: PeriodMode;
    columns: TrendColumn[];
    targetRows?: TargetRow[];
}

const DEFAULT_METRIC_TITLES = ['销量', '毛利率', '广告占比', '退款占比', '头程占比'];
const MAX_METRICS = 7;

/** 跨趋势图共享的指标选择，仅在用户手动切换后写入；更新数据源时重置 */
const getDefaultMetrics = (columns: TrendColumn[]): string[] => {
    const preferred = DEFAULT_METRIC_TITLES.filter(t => columns.some(c => c.title === t));
    return preferred.length > 0 ? preferred : columns.slice(0, Math.min(5, columns.length)).map(c => c.title);
};

const resolveInitialMetrics = (columns: TrendColumn[]): string[] => {
    const persisted = getTrendMetricsSelection();
    if (persisted) {
        const valid = persisted.filter(t => columns.some(c => c.title === t));
        if (valid.length > 0) return valid.slice(0, MAX_METRICS);
    }
    return getDefaultMetrics(columns);
};

/** 指标分组：单选一组展示，避免三行小标签挤在一起 */
const METRIC_GROUPS: { key: 'result' | 'process' | 'target'; label: string }[] = [
    { key: 'result', label: '结果' },
    { key: 'process', label: '过程' },
    { key: 'target', label: '目标' },
];

const RANGE_OPTIONS = [6, 12, 0] as const;
const DAILY_RANGE_OPTIONS = [7, 30, 0] as const;

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

const rowPassesDimFilters = (row: DataRow, dimFilters: Record<string, string[]>, mode: PeriodMode) => {
    return Object.entries(dimFilters).every(([dimKey, selectedVals]) => {
        const vals = selectedVals as string[];
        if (vals.length === 0) return true;
        let rowVal = '';
        if (dimKey === 'year_month') {
            rowVal = periodKeyOf(row.date, mode);
        } else {
            rowVal = String((row as any)[dimKey] ?? '');
        }
        return vals.includes(rowVal);
    });
};

const compositeKeyForRow = (row: DataRow, selectedDimensions: string[], mode: PeriodMode) =>
    selectedDimensions
        .map(d => {
            if (d === 'year_month') return periodKeyOf(row.date, mode);
            return String((row as any)[d] || 'Unknown');
        })
        .join('|||');

/** 目标行只有月粒度：月 → 当月；周/日 → 用月中那天折算到对应周/日键 */
const periodKeyForTargetMonth = (month: string, mode: PeriodMode) =>
    mode === 'month' ? month : periodKeyOf(`${month}-15`, mode);

const compositeKeyForTargetRow = (t: TargetRow, selectedDimensions: string[], mode: PeriodMode) =>
    selectedDimensions
        .map(d => {
            if (d === 'year_month') return periodKeyForTargetMonth(t.month, mode);
            return String((t as any)[d] || 'Unknown');
        })
        .join('|||');

const targetRowPassesDimFilters = (t: TargetRow, dimFilters: Record<string, string[]>, mode: PeriodMode) =>
    Object.entries(dimFilters).every(([dimKey, selectedVals]) => {
        const vals = selectedVals as string[];
        if (vals.length === 0) return true;
        let rowVal = '';
        if (dimKey === 'year_month') {
            rowVal = periodKeyForTargetMonth(t.month, mode);
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
    mode: PeriodMode
): boolean => {
    const dims = scope.selectedDimensions;
    const ymIdx = dims.indexOf('year_month');
    if (ymIdx < 0) {
        const k = compositeKeyForTargetRow(t, dims, mode);
        return scope.visibleGroupKeys.includes(k);
    }
    const tParts = compositeKeyForTargetRow(t, dims, mode).split('|||');
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
    rawDaily = [],
    scope,
    periodMode,
    columns,
    targetRows = []
}) => {
    const [selectedMetrics, setSelectedMetrics] = useState<string[]>([]);
    const [mode, setMode] = useState<'single' | 'multi'>('single');
    /** 弹窗内的粒度，可在日/周/月之间切换（不改变看板本身） */
    const [chartMode, setChartMode] = useState<PeriodMode>(periodMode);
    const [metricGroup, setMetricGroup] = useState<'result' | 'process' | 'target'>('result');
    const [rangeCount, setRangeCount] = useState<number>(12);
    const [hoverIndex, setHoverIndex] = useState<number | null>(null);
    const [tableExpanded, setTableExpanded] = useState(false);
    const [copyState, setCopyState] = useState<'idle' | 'ok' | 'err'>('idle');
    const wasTrendOpenRef = useRef(false);
    const theme = useChartTheme();

    /** 仅在趋势弹窗从关→开时同步指标，避免父组件重渲染导致 columns 引用变化而把已选指标冲掉 */
    useEffect(() => {
        if (isOpen && !wasTrendOpenRef.current) {
            const initial = resolveInitialMetrics(columns);
            setSelectedMetrics(initial);
            setMode(initial.length >= 2 ? 'multi' : 'single');
            const firstSelectedCol = columns.find(c => c.title === initial[0]);
            if (firstSelectedCol?.metricGroup) setMetricGroup(firstSelectedCol.metricGroup);
            setTableExpanded(false);
            setCopyState('idle');
            setHoverIndex(null);
        }
        wasTrendOpenRef.current = isOpen;
    }, [isOpen, columns]);

    /** 弹窗打开期间跟随侧栏粒度切换 */
    useEffect(() => {
        if (isOpen) {
            setChartMode(periodMode);
            setRangeCount(periodMode === 'day' ? 30 : 12);
        }
    }, [isOpen, periodMode]);

    const commitSelection = (next: string[]) => {
        setSelectedMetrics(next);
        setTrendMetricsSelection(next);
    };

    /** 单指标模式 = 单选；对比模式 = 多选（至少保留 1 项） */
    const pickMetric = (title: string) => {
        if (mode === 'single') {
            commitSelection([title]);
            return;
        }
        setSelectedMetrics(prev => {
            if (prev.includes(title)) {
                if (prev.length === 1) return prev;
                const next = prev.filter(m => m !== title);
                setTrendMetricsSelection(next);
                return next;
            }
            if (prev.length >= MAX_METRICS) return prev;
            const next = [...prev, title];
            setTrendMetricsSelection(next);
            return next;
        });
    };

    /** 从「对比」切回「单指标」时只保留第一个，避免图表与选中态不一致 */
    const switchMode = (next: 'single' | 'multi') => {
        setMode(next);
        if (next === 'single' && selectedMetrics.length > 1) {
            commitSelection(selectedMetrics.slice(0, 1));
        }
    };

    const baseRaw = chartMode === 'day' ? rawDaily : chartMode === 'week' ? rawWeekly : rawMonthly;

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
                if (!rowPassesDimFilters(row, scope.dimFilters, chartMode)) return false;
                const k = compositeKeyForRow(row, scope.selectedDimensions, chartMode);
                return keySet.has(k);
            });
        }

        const timeGroups: Record<string, DataRow[]> = {};
        filteredData.forEach(row => {
            const timeKey = periodKeyOf(row.date, chartMode);
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
                if (!targetRowPassesDimFilters(t, tgtDimFilters, chartMode)) return false;
                if (scope.selectedDimensions.includes('year_month')) {
                    return targetMatchesVisibleGroupLoose(t, scope, chartMode);
                }
                const k = compositeKeyForTargetRow(t, scope.selectedDimensions, chartMode);
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
                if (chartMode === 'week') {
                    weekKeysForMonth(monthKey).forEach(wk => allTimeKeys.add(wk));
                } else if (chartMode === 'month') {
                    allTimeKeys.add(monthKey);
                }
                // 日粒度不按月目标补横轴：一天一个点，把整月补进来会刷出几十个空点
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
            // 目标表是月粒度：只有月度图能直接对上；周度按天拆分；日度不画目标线（会误导成「当天目标」）
            const tg = chartMode === 'week'
                ? allocateWeeklyTargetsLegacy(row.time, targetByMonth)
                : chartMode === 'day'
                    ? { sq: 0, sa: 0, gp: 0, ad: 0 }
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

        /** 期数裁剪：只留最近 N 期（含未来目标月），横轴才不会被多年历史压成一团 */
        const sliced = rangeCount > 0 && withTargets.length > rangeCount
            ? withTargets.slice(-rangeCount)
            : withTargets;

        const tickLabels = buildAxisTickLabels(sliced.map(r => r.time), chartMode);
        return sliced.map(row => ({ ...row, __tick: tickLabels[row.time] }));
    }, [isOpen, baseRaw, scope, chartMode, columns, targetRows, selectedMetrics, rangeCount]);

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
    const canDaily = rawDaily.length > 0;
    const rangeOptions: readonly number[] = chartMode === 'day' ? DAILY_RANGE_OPTIONS : RANGE_OPTIONS;

    const seriesKeyOf = (col: TrendColumn) => col.dataKey || col.title;

    /** 目标列 → 对应的实际列（按 shortLabel / 去掉「（目标）」后的标题匹配） */
    const targetKeyByLabel = new Map<string, string>();
    columns
        .filter(c => c.metricGroup === 'target' && c.dataKey)
        .forEach(c => {
            const label = c.shortLabel || c.title.replace('（目标）', '');
            targetKeyByLabel.set(label, c.dataKey!);
        });

    const chipLabel = (col: TrendColumn) => {
        if (col.metricGroup === 'target') return `${col.shortLabel || col.title.replace('（目标）', '')}目标`;
        return col.shortLabel || col.title;
    };

    const unitOf = (col: TrendColumn) => (col.isPercent ? '%' : col.isMoney ? '美元' : '件');

    /** 大字/自然读法：金额与计数带千分位，比率 1~2 位小数 */
    const fmtKpi = (col: TrendColumn, v: number) => {
        if (!Number.isFinite(v)) return '—';
        if (col.isPercent) return `${(v * 100).toFixed(Math.abs(v * 100) < 10 ? 2 : 1)}%`;
        if (col.isMoney) return formatMoneyNoDecimals(v);
        return formatNumber(v);
    };

    /** 图内标注：尽量短（$412k / 1.2万 / 32.4%） */
    const fmtLabel = (col: TrendColumn, v: number) => {
        if (!Number.isFinite(v)) return '';
        if (col.isPercent) return `${(v * 100).toFixed(1)}%`;
        if (col.isMoney) return `$${compactNumber(v)}`;
        return compactCount(v);
    };

    const axisTick = (col: TrendColumn, v: number) =>
        compactTick(v, { isMoney: col.isMoney, isPercent: col.isPercent, isCount: !col.isMoney && !col.isPercent });

    const selectedCols = selectedMetrics
        .map(t => columns.find(c => c.title === t))
        .filter((c): c is TrendColumn => Boolean(c));

    const activeCol = selectedCols[0];
    const activeKey = activeCol ? seriesKeyOf(activeCol) : '';
    const activeTargetKey = activeCol ? targetKeyByLabel.get(activeCol.shortLabel || activeCol.title) : undefined;

    const lastRow: any = chartData[chartData.length - 1];
    const prevRow: any = chartData[chartData.length - 2];
    const lastValue = lastRow && activeCol ? Number(lastRow[activeKey] ?? 0) : 0;
    const prevValue = prevRow ? Number(prevRow[activeKey] ?? 0) : undefined;
    const lastTarget = activeTargetKey && lastRow ? Number(lastRow[activeTargetKey] ?? 0) : 0;

    const delta = formatDelta(lastValue, prevValue);
    const costMetric = activeCol ? isCostMetric(activeCol.title) : false;
    /** 环比颜色带语义：成本类指标「涨」为坏 */
    const deltaTone = !delta || delta.direction === 'flat'
        ? theme.textSubtle
        : (delta.direction === 'up') === !costMetric
          ? theme.positive
          : theme.negative;

    /**
     * 注意：这里不能用 useMemo —— 本组件由父级常驻挂载（isOpen 只是 prop），
     * 上面已有 `if (!isOpen) return null` 早退；在早退之后调用 hook 会让
     * 「关→开」时的 hook 数量变化，React 直接抛错并卸载整棵树（表现为白屏）。
     * 结论文案只有十几行，直接算即可。
     */
    const insight = activeCol
        ? buildTrendInsight({
              points: chartData.map((r: any) => ({ time: r.time, value: Number(r[activeKey] ?? 0) })),
              formatter: v => fmtKpi(activeCol, v),
              target: activeTargetKey ? lastTarget : undefined,
              higherIsBetter: !costMetric,
              periodLabel: t => {
                  const found = chartData.find((r: any) => r.time === t) as any;
                  return found?.__tick ?? t;
              },
          })
        : [];

    /** 单指标图：柱（量）或线（率），刻度取整数，柱顶直接标数值 */
    const singleAxis = (() => {
        if (!activeCol || chartData.length === 0) return buildNiceAxis(0, 1, 4);
        const values = chartData.map((r: any) => Number(r[activeKey] ?? 0)).filter((v: number) => Number.isFinite(v));
        const maxV = Math.max(...values, activeTargetKey ? lastTarget : 0);
        if (activeCol.isPercent) {
            const minV = Math.min(...values, activeTargetKey ? lastTarget : Infinity);
            const span = maxV - minV || Math.abs(maxV) * 0.1 || 0.01;
            return buildNiceAxis(Math.max(0, minV - span * 0.25), maxV + span * 0.25, 4);
        }
        return buildNiceAxis(0, maxV * 1.08, 4);
    })();

    const showValueLabels = chartData.length > 0 && chartData.length <= 14;

    const groupColumns = columns.filter(c => (c.metricGroup || 'result') === metricGroup);
    const rangeLabel = (n: number) => (n === 0 ? '全部' : `近${n}${periodUnitLabel(chartMode)}`);

    /** 单指标 tooltip */
    const renderSingleTooltip = ({ active, payload, label }: any) => {
        if (!active || !payload || payload.length === 0 || !activeCol) return null;
        const index = chartData.findIndex((d: any) => d.time === label);
        if (index < 0) return null;
        const row: any = chartData[index];
        const prev: any = index > 0 ? chartData[index - 1] : undefined;
        const value = Number(row[activeKey] ?? 0);
        const prevVal = prev ? Number(prev[activeKey] ?? 0) : undefined;
        const period = formatPeriodLabel(String(label), getBusinessWeekRangeFromYearWeek);
        const rowTarget = activeTargetKey ? Number(row[activeTargetKey] ?? 0) : 0;

        const rows: TooltipRow[] = [
            { key: 'value', color: seriesColor(theme, 0), label: chipLabel(activeCol), value: fmtKpi(activeCol, value) },
        ];
        if (rowTarget > 0) {
            rows.push({
                key: 'target',
                color: theme.target,
                label: '目标',
                value: fmtKpi(activeCol, rowTarget),
                hollow: true,
                muted: true,
            });
        }
        const achievement = rowTarget > 0 ? (value / rowTarget) * 100 : null;

        return (
            <ChartTooltipCard
                theme={theme}
                title={period.title}
                subtitle={period.subtitle}
                delta={prevVal === undefined ? null : formatDelta(value, prevVal)}
                rows={rows}
                footer={
                    achievement === null ? undefined : (
                        <span>
                            达成率{' '}
                            <span className="font-mono font-semibold" style={{ color: theme.textMuted }}>
                                {achievement.toFixed(1)}%
                            </span>
                        </span>
                    )
                }
            />
        );
    };

    /** 数据表：最新在上，默认 6 行（同上：不能用 useMemo，早退之后不能调 hook） */
    const tableRows = activeCol
        ? chartData
              .map((row: any, i: number) => {
                  const value = Number(row[activeKey] ?? 0);
                  const prev = i > 0 ? (chartData[i - 1] as any) : null;
                  const prevVal = prev ? Number(prev[activeKey] ?? 0) : undefined;
                  const target = activeTargetKey ? Number(row[activeTargetKey] ?? 0) : 0;
                  return {
                      time: row.time as string,
                      tick: (row as any).__tick as string,
                      value,
                      target,
                      achievement: target > 0 ? (value / target) * 100 : null,
                      delta: prevVal === undefined ? null : formatDelta(value, prevVal),
                  };
              })
              .reverse()
        : [];

    const visibleTableRows = tableExpanded ? tableRows : tableRows.slice(0, 6);

    const copyTable = async () => {
        if (!activeCol || tableRows.length === 0) return;
        const header = ['月份', chipLabel(activeCol), '目标', '达成率', '环比'].join('\t');
        const body = tableRows
            .map(r =>
                [
                    r.tick ?? r.time,
                    fmtKpi(activeCol, r.value),
                    r.target > 0 ? fmtKpi(activeCol, r.target) : '—',
                    r.achievement === null ? '—' : `${r.achievement.toFixed(1)}%`,
                    r.delta ? r.delta.text.replace(/\s/g, '') : '—',
                ].join('\t')
            )
            .join('\n');
        try {
            await navigator.clipboard.writeText(`${header}\n${body}`);
            setCopyState('ok');
        } catch {
            setCopyState('err');
        }
        window.setTimeout(() => setCopyState('idle'), 1600);
    };

    /** 对比模式：悬浮某一格 → 顶部条与所有格子对齐到同一期 */
    const focusIndex = hoverIndex !== null && hoverIndex < chartData.length ? hoverIndex : chartData.length - 1;
    const focusRow: any = chartData[focusIndex];

    return (
        <div role="dialog" aria-modal="true" aria-label="趋势图" tabIndex={-1} className="fixed inset-0 z-[110] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="flex max-h-[88vh] w-full max-w-[min(96vw,88rem)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10">
                {/* 顶栏 */}
                <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-700/50 bg-gradient-to-r from-slate-800 to-slate-700 px-4 py-2.5 text-white">
                    <div className="flex min-w-0 items-center gap-2.5">
                        <div className="flex-shrink-0 rounded-lg bg-white/10 p-1.5 ring-1 ring-white/15">
                            <TrendingUp className="h-4 w-4 text-sky-300" />
                        </div>
                        <div className="min-w-0">
                            <h2 className="truncate text-sm font-semibold tracking-tight">趋势 · {title}</h2>
                            <p className="truncate text-[10px] text-slate-300/80">
                                {mode === 'single'
                                    ? `柱 = 实际 · 虚线 = 目标 · 单位 ${activeCol ? unitOf(activeCol) : '—'}`
                                    : '每个指标独立缩放 · 悬浮任意一格，全部对齐到同一期'}
                            </p>
                        </div>
                    </div>
                    <button type="button" onClick={onClose} className="flex-shrink-0 rounded-full p-1.5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* 工具条：模式 / 分组 / 指标 / 粒度 / 期数 */}
                <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-slate-200/90 bg-white px-3 py-2">
                    <div className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5">
                        <button
                            type="button"
                            onClick={() => switchMode('single')}
                            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${
                                mode === 'single' ? 'bg-white text-slate-800 shadow-sm ring-1 ring-slate-200/70' : 'text-slate-500 hover:text-slate-700'
                            }`}
                        >
                            单指标
                        </button>
                        <button
                            type="button"
                            onClick={() => switchMode('multi')}
                            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${
                                mode === 'multi' ? 'bg-white text-slate-800 shadow-sm ring-1 ring-slate-200/70' : 'text-slate-500 hover:text-slate-700'
                            }`}
                        >
                            对比
                        </button>
                    </div>

                    <div className="h-4 w-px shrink-0 bg-slate-200" aria-hidden />

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
                                        active ? 'bg-white text-slate-800 shadow-sm ring-1 ring-slate-200/70' : 'text-slate-500 hover:text-slate-700'
                                    }`}
                                >
                                    {g.label}
                                    {count > 0 && (
                                        <span className={`ml-1 font-mono text-[9px] ${active ? 'text-sky-600' : 'text-slate-400'}`}>{count}</span>
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    <div className="h-4 w-px shrink-0 bg-slate-200" aria-hidden />

                    <div className="custom-scroll flex min-w-[8rem] flex-1 gap-1 overflow-x-auto pb-0.5">
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
                                    onClick={() => pickMetric(col.title)}
                                    title={mode === 'single' ? `查看 ${col.title}` : `加入对比：${col.title}`}
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

                    <div className="inline-flex shrink-0 rounded-md bg-slate-100 p-0.5">
                        {([
                            { key: 'month' as PeriodMode, label: '月', enabled: canMonthly },
                            { key: 'week' as PeriodMode, label: '周', enabled: canWeekly },
                            { key: 'day' as PeriodMode, label: '日', enabled: canDaily },
                        ]).map(({ key, label, enabled }) => (
                            <button
                                key={key}
                                type="button"
                                disabled={!enabled}
                                title={enabled ? undefined : key === 'day' ? '日粒度需要连接云端数据' : undefined}
                                onClick={() => {
                                    if (!enabled) return;
                                    setChartMode(key);
                                    setRangeCount(key === 'day' ? 30 : 12);
                                }}
                                className={`rounded px-2 py-0.5 text-[10.5px] font-medium transition-all ${
                                    chartMode === key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                                } disabled:cursor-not-allowed disabled:opacity-40`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    <div className="inline-flex shrink-0 rounded-md bg-slate-100 p-0.5">
                        {rangeOptions.map(n => (
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

                <div className="custom-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50 p-3">
                    {chartData.length === 0 ? (
                        <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl border border-slate-200/90 bg-white">
                            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" className="text-slate-300" aria-hidden>
                                <path d="M4 19V5M4 19h16" strokeLinecap="round" />
                                <path d="M7 15l3.5-4 3 2.4L19 7" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
                            </svg>
                            <p className="text-sm text-slate-400">暂无历史趋势数据</p>
                            <p className="text-[11px] text-slate-300">上传月度或周度业绩表后即可查看趋势</p>
                        </div>
                    ) : mode === 'single' && activeCol ? (
                        <div className="rounded-xl border border-slate-200/90 bg-white shadow-sm">
                            {/* KPI：大字 + 语义化 pill */}
                            <div className="flex flex-wrap items-end gap-x-3 gap-y-1 px-4 pb-1 pt-3">
                                <span className="font-mono text-[28px] font-bold leading-none tracking-tight tabular-nums" style={{ color: theme.text }}>
                                    {fmtKpi(activeCol, lastValue)}
                                </span>
                                <span className="pb-0.5 text-[11px] font-medium" style={{ color: theme.textSubtle }}>
                                    {unitOf(activeCol)}
                                </span>
                                <div className="flex flex-wrap items-center gap-1.5 pb-0.5">
                                    {delta && (
                                        <span
                                            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold"
                                            style={{ color: deltaTone, borderColor: `${deltaTone}55`, backgroundColor: `${deltaTone}14` }}
                                        >
                                            {delta.text} 较上期
                                        </span>
                                    )}
                                    {lastTarget > 0 && (
                                        <>
                                            <span
                                                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold"
                                                style={{
                                                    color: lastValue >= lastTarget ? theme.positive : theme.negative,
                                                    borderColor: `${lastValue >= lastTarget ? theme.positive : theme.negative}55`,
                                                    backgroundColor: `${lastValue >= lastTarget ? theme.positive : theme.negative}14`,
                                                }}
                                            >
                                                达成 {((lastValue / lastTarget) * 100).toFixed(1)}%
                                            </span>
                                            <span className="text-[10.5px]" style={{ color: theme.textMuted }}>
                                                目标 {fmtKpi(activeCol, lastTarget)}
                                            </span>
                                        </>
                                    )}
                                    <span className="text-[10.5px]" style={{ color: theme.textSubtle }}>
                                        · {lastRow?.__tick ?? ''}
                                    </span>
                                </div>
                            </div>

                            {/* 一句话结论 */}
                            <p className="px-4 pb-1 text-[11.5px] leading-relaxed" style={{ color: theme.textMuted }}>
                                {insight.map((span, i) => (
                                    <span
                                        key={i}
                                        style={{
                                            color:
                                                span.tone === 'pos'
                                                    ? theme.positive
                                                    : span.tone === 'neg'
                                                      ? theme.negative
                                                      : span.tone === 'strong'
                                                        ? theme.text
                                                        : undefined,
                                            fontWeight: span.tone === 'strong' ? 700 : undefined,
                                        }}
                                    >
                                        {span.text}
                                    </span>
                                ))}
                            </p>

                            {/* 图表 */}
                            <div className="h-[clamp(240px,42vh,400px)] px-2 pb-1 pt-1">
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={chartData} margin={{ top: 26, right: 18, left: 4, bottom: 2 }}>
                                        <CartesianGrid horizontal vertical={false} stroke={theme.grid} strokeWidth={1} />
                                        <XAxis
                                            dataKey="time"
                                            tickFormatter={(v: string) => {
                                                const found = chartData.find((d: any) => d.time === v) as any;
                                                return found?.__tick ?? v;
                                            }}
                                            tick={{ fontSize: 11, fill: theme.axisTick }}
                                            tickMargin={8}
                                            axisLine={false}
                                            tickLine={false}
                                            interval="preserveStartEnd"
                                            minTickGap={14}
                                        />
                                        <YAxis
                                            domain={singleAxis.domain}
                                            ticks={singleAxis.ticks}
                                            tickFormatter={(v: number) => axisTick(activeCol, v)}
                                            tick={{ fontSize: 11, fill: theme.axisTick }}
                                            axisLine={false}
                                            tickLine={false}
                                            width={56}
                                        />
                                        <Tooltip
                                            content={renderSingleTooltip}
                                            cursor={{ fill: 'rgba(148,163,184,0.10)' }}
                                            wrapperStyle={{ outline: 'none', zIndex: 40 }}
                                        />

                                        {activeTargetKey && (
                                            <Line
                                                type="linear"
                                                dataKey={activeTargetKey}
                                                name="目标"
                                                stroke={theme.target}
                                                strokeWidth={1.6}
                                                strokeDasharray="4 4"
                                                dot={false}
                                                activeDot={false}
                                                isAnimationActive={false}
                                            />
                                        )}

                                        {activeCol.isPercent ? (
                                            <Line
                                                type="linear"
                                                dataKey={activeKey}
                                                name={chipLabel(activeCol)}
                                                stroke={seriesColor(theme, 0)}
                                                strokeWidth={2.4}
                                                strokeLinecap="round"
                                                dot={{ r: 2.6, strokeWidth: 0, fill: seriesColor(theme, 0) }}
                                                activeDot={{ r: 5, strokeWidth: 3, stroke: theme.surface, fill: seriesColor(theme, 0) }}
                                                isAnimationActive={false}
                                            >
                                                {showValueLabels && (
                                                    <LabelList
                                                        dataKey={activeKey}
                                                        position="top"
                                                        offset={9}
                                                        fontSize={10}
                                                        fontWeight={600}
                                                        fill={theme.textMuted}
                                                        formatter={(v: any) => fmtLabel(activeCol, Number(v))}
                                                    />
                                                )}
                                            </Line>
                                        ) : (
                                            <Bar
                                                dataKey={activeKey}
                                                name={chipLabel(activeCol)}
                                                isAnimationActive={false}
                                                radius={[3, 3, 0, 0]}
                                                maxBarSize={46}
                                            >
                                                {chartData.map((row: any, i: number) => (
                                                    <Cell
                                                        key={row.time}
                                                        fill={seriesColor(theme, 0)}
                                                        fillOpacity={i === chartData.length - 1 ? 1 : 0.34}
                                                    />
                                                ))}
                                                {showValueLabels && (
                                                    <LabelList
                                                        dataKey={activeKey}
                                                        position="top"
                                                        offset={6}
                                                        fontSize={10}
                                                        fontWeight={600}
                                                        fill={theme.textMuted}
                                                        formatter={(v: any) => fmtLabel(activeCol, Number(v))}
                                                    />
                                                )}
                                            </Bar>
                                        )}
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </div>

                            {/* 数据表：可以直接读数、复制到飞书 */}
                            <div className="border-t border-slate-100">
                                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[11px] font-semibold" style={{ color: theme.textMuted }}>
                                            数据表（{tableRows.length} 期）
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setTableExpanded(v => !v)}
                                            className="inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 text-[10.5px] text-slate-600 transition-colors hover:bg-slate-50"
                                        >
                                            {tableExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                            {tableExpanded ? '收起' : '展开全部'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void copyTable()}
                                            className="inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 text-[10.5px] text-slate-600 transition-colors hover:bg-slate-50"
                                        >
                                            {copyState === 'ok' ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                                            {copyState === 'ok' ? '已复制' : copyState === 'err' ? '复制失败' : '复制到飞书'}
                                        </button>
                                    </div>
                                    <span className="text-[10px]" style={{ color: theme.textSubtle }}>
                                        等宽数字 · 最新在上
                                    </span>
                                </div>
                                <div className="custom-scroll overflow-x-auto">
                                    <table className="w-full text-[11px]">
                                        <thead>
                                            <tr className="bg-slate-50 text-[10px] text-slate-500">
                                                <th className="px-3 py-1.5 text-left font-semibold">月份</th>
                                                <th className="px-3 py-1.5 text-right font-semibold">{chipLabel(activeCol)}</th>
                                                <th className="px-3 py-1.5 text-right font-semibold">目标</th>
                                                <th className="px-3 py-1.5 text-right font-semibold">达成率</th>
                                                <th className="px-3 py-1.5 text-right font-semibold">环比</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {visibleTableRows.map(row => (
                                                <tr key={row.time}>
                                                    <td className="px-3 py-1 font-mono tabular-nums text-slate-500">{row.tick ?? row.time}</td>
                                                    <td className="px-3 py-1 text-right font-mono font-semibold tabular-nums" style={{ color: theme.text }}>
                                                        {fmtKpi(activeCol, row.value)}
                                                    </td>
                                                    <td className="px-3 py-1 text-right font-mono tabular-nums text-slate-500">
                                                        {row.target > 0 ? fmtKpi(activeCol, row.target) : '—'}
                                                    </td>
                                                    <td
                                                        className="px-3 py-1 text-right font-mono tabular-nums"
                                                        style={{
                                                            color:
                                                                row.achievement === null
                                                                    ? undefined
                                                                    : row.achievement >= 100
                                                                      ? theme.positive
                                                                      : theme.negative,
                                                        }}
                                                    >
                                                        {row.achievement === null ? '—' : `${row.achievement.toFixed(1)}%`}
                                                    </td>
                                                    <td className="px-3 py-1 text-right font-mono tabular-nums" style={{ color: theme.textMuted }}>
                                                        {row.delta ? row.delta.text : '—'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    ) : (
                        /* 对比模式：小多图 */
                        <div className="rounded-xl border border-slate-200/90 bg-white shadow-sm">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-100 px-3 py-2">
                                <span className="font-mono text-[11px] font-semibold" style={{ color: theme.textMuted }}>
                                    {focusRow ? String((focusRow as any).__tick ?? (focusRow as any).time) : '—'}
                                </span>
                                {selectedCols.map((col, idx) => {
                                    const key = seriesKeyOf(col);
                                    const value = focusRow ? Number((focusRow as any)[key] ?? 0) : 0;
                                    return (
                                        <span key={col.title} className="inline-flex items-center gap-1.5 text-[10.5px]" style={{ color: theme.textMuted }}>
                                            <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: seriesColor(theme, idx) }} />
                                            {chipLabel(col)}
                                            <span className="font-mono font-semibold tabular-nums" style={{ color: theme.text }}>
                                                {fmtKpi(col, value)}
                                            </span>
                                        </span>
                                    );
                                })}
                                <span className="ml-auto text-[10px]" style={{ color: theme.textSubtle }}>
                                    {hoverIndex === null ? '最新一期（悬浮查看其他月份）' : '正在查看该期'}
                                </span>
                            </div>

                            <div
                                className="grid gap-2 p-2.5"
                                style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}
                                onMouseLeave={() => setHoverIndex(null)}
                            >
                                {selectedCols.map((col, idx) => {
                                    const key = seriesKeyOf(col);
                                    const values = chartData.map((r: any) => Number(r[key] ?? 0));
                                    /** 悬浮时整格变成「该期读数」，与顶部对齐条同一期，避免「条上是 2 月、格里是 9 月」 */
                                    const displayIndex = hoverIndex !== null && hoverIndex < values.length ? hoverIndex : values.length - 1;
                                    const displayValue = values[displayIndex] ?? 0;
                                    const baseValue = displayIndex > 0 ? values[displayIndex - 1] : undefined;
                                    const d = formatDelta(displayValue, baseValue);
                                    const cost = isCostMetric(col.title);
                                    const dTone =
                                        !d || d.direction === 'flat'
                                            ? theme.textSubtle
                                            : (d.direction === 'up') === !cost
                                              ? theme.positive
                                              : theme.negative;
                                    const tKey = targetKeyByLabel.get(col.shortLabel || col.title);
                                    const targetSeries = tKey ? chartData.map((r: any) => Number(r[tKey] ?? 0)) : undefined;
                                    const color = seriesColor(theme, idx);
                                    return (
                                        <div
                                            key={col.title}
                                            className="rounded-lg border px-2.5 pb-1.5 pt-2 transition-shadow"
                                            style={{
                                                borderColor: hoverIndex !== null ? `${color}55` : undefined,
                                                boxShadow: hoverIndex !== null ? `0 0 0 2px ${color}22` : undefined,
                                            }}
                                        >
                                            <div className="flex items-baseline justify-between gap-2">
                                                <span className="truncate text-[10.5px] font-medium" style={{ color: theme.textMuted }}>
                                                    {chipLabel(col)}
                                                </span>
                                                <span className="shrink-0 text-[9px]" style={{ color: theme.textSubtle }}>
                                                    {unitOf(col)}
                                                </span>
                                            </div>
                                            <div className="mt-0.5 flex items-baseline gap-2">
                                                <span className="font-mono text-[17px] font-bold leading-tight tracking-tight tabular-nums" style={{ color: theme.text }}>
                                                    {fmtKpi(col, displayValue)}
                                                </span>
                                                <span className="font-mono text-[9.5px] font-semibold" style={{ color: dTone }}>
                                                    {d ? d.text : ''}
                                                </span>
                                            </div>
                                            <MetricSparkline
                                                values={values}
                                                target={targetSeries}
                                                color={color}
                                                theme={theme}
                                                height={76}
                                                hoverIndex={hoverIndex}
                                                onHover={setHoverIndex}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

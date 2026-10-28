import React, { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { AggregatedData, DataRow, FilterState, TargetRow, PeriodMode } from '../types';
import {
    formatNumber,
    formatPercent,
    formatMoneyNoDecimals,
    getPacingCompletionRatio,
    formatTargetGapPctPoints,
    periodUnitLabel,
} from '../utils';
import { Activity, BadgeDollarSign, BarChart3, ChevronDown, Goal, Megaphone, TrendingUp, X } from 'lucide-react';
const MiniTrendChart = lazy(() => import('./MiniTrendChart').then(m => ({default: m.MiniTrendChart})));
import { METRICS } from '../utils/metrics';

interface DashboardOverviewProps {
    current: AggregatedData;
    target: AggregatedData;
    periodMode?: PeriodMode;
    rawData?: DataRow[];
    /** 长历史（服务端按天聚合）：只用于画趋势，不受当前选中区间限制 */
    historyData?: DataRow[];
    filters?: FilterState;
    targetRows?: TargetRow[];
    /** 时间进度 0~1；&lt;1 时显示序时达成率（仅累计量） */
    pacingRatio?: number;
}

const clampRatio = (value: number, max: number) => {
    if (!max) return 0;
    return Math.max(0, Math.min(value / max, 1));
};

const getTrendTone = (ratio: number, inverse = false) => {
    if (inverse) {
        if (ratio > 1) return 'rose';
        if (ratio > 0.9) return 'amber';
        return 'sky';
    }

    if (ratio >= 1) return 'emerald';
    if (ratio >= 0.75) return 'sky';
    return 'amber';
};

const getGapTone = (actual: number, target: number) => {
    if (actual >= target) return 'emerald';
    if (target > 0 && actual / target >= 0.9) return 'sky';
    return 'amber';
};

const toneClassMap = {
    sky: {
        ring: 'ring-sky-200/80',
        text: 'text-sky-700',
        pill: 'bg-sky-500/10 text-sky-700 border-sky-200/80',
        bar: 'from-sky-500 to-cyan-400',
        glow: 'from-sky-500/12 via-cyan-400/10 to-transparent'
    },
    emerald: {
        ring: 'ring-emerald-200/80',
        text: 'text-emerald-700',
        pill: 'bg-emerald-500/10 text-emerald-700 border-emerald-200/80',
        bar: 'from-emerald-500 to-teal-400',
        glow: 'from-emerald-500/12 via-teal-400/10 to-transparent'
    },
    amber: {
        ring: 'ring-amber-200/80',
        text: 'text-amber-700',
        pill: 'bg-amber-500/10 text-amber-700 border-amber-200/80',
        bar: 'from-amber-500 to-orange-400',
        glow: 'from-amber-500/12 via-orange-400/10 to-transparent'
    },
    rose: {
        ring: 'ring-rose-200/80',
        text: 'text-rose-700',
        pill: 'bg-rose-500/10 text-rose-700 border-rose-200/80',
        bar: 'from-rose-500 to-red-400',
        glow: 'from-rose-500/12 via-red-400/10 to-transparent'
    }
};

type MetricCardKey = 'sales_quantity' | 'sales_amount' | 'gross_profit' | 'gross_margin' | 'ad_spend';

const ProgressMetricCard = ({
    label,
    metricKey,
    value,
    max,
    formatter,
    icon,
    inverseColor = false,
    isRateMetric = false,
    isActive = false,
    onClick,
    pacingRatio = 1,
    featured = false,
}: {
    label: string;
    metricKey: MetricCardKey;
    value: number;
    max: number;
    formatter: (v: number) => string;
    icon: React.ReactNode;
    inverseColor?: boolean;
    isRateMetric?: boolean;
    isActive?: boolean;
    onClick?: () => void;
    pacingRatio?: number;
    featured?: boolean;
}) => {
    const hasTarget = Number.isFinite(max) && Math.abs(max) > 1e-9;
    const ratio = hasTarget ? value / max : 0;
    const progress = clampRatio(value, max) * 100;
    const tone = toneClassMap[hasTarget ? getTrendTone(ratio, inverseColor) : 'sky'];
    const pacingPct = isRateMetric ? null : getPacingCompletionRatio(value, max, pacingRatio);
    const pacingTone = pacingPct !== null
        ? toneClassMap[getTrendTone(pacingPct, inverseColor)]
        : null;
    const gapStr = isRateMetric && max ? formatTargetGapPctPoints(value, max) : null;
    const gapTone = isRateMetric && max ? toneClassMap[getGapTone(value, max)] : null;

    return (
        <div
            onClick={onClick}
            title={metricKey in METRICS ? METRICS[metricKey as keyof typeof METRICS].definition : undefined}
            className={`relative overflow-hidden rounded-2xl border bg-white p-5 shadow-[0_18px_50px_-30px_rgba(15,23,42,0.35)] transition-shadow duration-200 cursor-pointer ${featured ? 'lg:col-span-2 border-sky-300 bg-gradient-to-br from-sky-50 to-white' : ''}
                ${isActive
                    ? 'border-sky-400/60 ring-2 ring-sky-400/30 shadow-[0_20px_60px_-25px_rgba(14,165,233,0.4)]'
                    : 'border-white/80 ring-1 ' + tone.ring + ' hover:shadow-[0_20px_55px_-28px_rgba(15,23,42,0.45)]'
                }
            `}
        >
            <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${tone.glow}`} />
            <div className="relative flex items-start justify-between gap-3">
                <div>
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                        {label}
                        {isActive && (
                            <TrendingUp className="w-3 h-3 text-sky-500" />
                        )}
                    </div>
                    <div className="text-3xl font-bold tracking-tight text-slate-900 font-mono">
                        {formatter(value)}
                    </div>
                </div>
                <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border bg-white/80 ${tone.pill}`}>
                    {icon}
                </div>
            </div>

            {hasTarget ? <div className="relative mt-5 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>目标</span>
                    <span className="font-mono text-slate-700">{formatter(max)}</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200/70">
                    <div
                        className={`h-full rounded-full bg-gradient-to-r ${tone.bar} transition-all duration-700`}
                        style={{ width: `${Math.min(progress, 100)}%` }}
                    />
                </div>
                <div className="flex items-center justify-between text-xs gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 font-semibold ${tone.pill}`}>
                            {(ratio * 100).toFixed(1)}%
                        </span>
                        {pacingPct !== null && pacingTone && (
                            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 font-semibold ${pacingTone.pill}`}>
                                序时 {(pacingPct * 100).toFixed(1)}%
                            </span>
                        )}
                        {gapStr && gapTone && (
                            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 font-semibold ${gapTone.pill}`}>
                                距目标 {gapStr}
                            </span>
                        )}
                    </div>
                    <span className="font-mono text-slate-400 whitespace-nowrap">{inverseColor ? '预算使用率' : '目标达成率'}</span>
                </div>
            </div> : <p className="relative mt-5 text-xs font-medium text-slate-500">未导入目标表，暂不计算达成率</p>}
        </div>
    );
};

const WeeklyMetricCard = ({
    label,
    metricKey,
    value,
    targetValue,
    formatter,
    icon,
    inverseColor = false,
    isRateMetric = false,
    isActive = false,
    onClick,
}: {
    label: string;
    metricKey: MetricCardKey;
    value: number;
    targetValue?: number;
    formatter: (v: number) => string;
    icon: React.ReactNode;
    inverseColor?: boolean;
    isRateMetric?: boolean;
    isActive?: boolean;
    onClick?: () => void;
}) => {
    const hasTarget = typeof targetValue === 'number' && Math.abs(targetValue) > 1e-9;
    const ratio = hasTarget && targetValue ? value / targetValue : 0;
    const tone = hasTarget
        ? toneClassMap[isRateMetric ? getGapTone(value, targetValue!) : getTrendTone(ratio, inverseColor)]
        : null;
    const progress = hasTarget && targetValue ? clampRatio(value, targetValue) * 100 : 0;
    const gapStr = isRateMetric && hasTarget && targetValue ? formatTargetGapPctPoints(value, targetValue) : null;

    return (
        <div
            onClick={onClick}
            className={`relative overflow-hidden rounded-2xl border bg-white p-5 shadow-[0_18px_50px_-30px_rgba(15,23,42,0.35)] transition-shadow duration-200 cursor-pointer
                ${isActive
                    ? 'border-sky-400/60 ring-2 ring-sky-400/30 shadow-[0_20px_60px_-25px_rgba(14,165,233,0.4)]'
                    : tone
                        ? 'border-white/80 ring-1 ' + tone.ring + ' hover:shadow-[0_20px_55px_-28px_rgba(15,23,42,0.45)]'
                        : 'ring-1 ring-slate-200/80 hover:shadow-[0_20px_55px_-28px_rgba(15,23,42,0.45)]'
                }
            `}
        >
            <div className={`pointer-events-none absolute inset-0 ${tone ? `bg-gradient-to-br ${tone.glow}` : 'bg-[radial-gradient(circle_at_top_right,rgba(14,165,233,0.12),transparent_42%)]'}`} />
            <div className="relative flex items-start justify-between gap-3">
                <div>
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                        {label}
                        {isActive && <TrendingUp className="w-3 h-3 text-sky-500" />}
                    </div>
                    <div className="text-3xl font-bold tracking-tight text-slate-900 font-mono">{formatter(value)}</div>
                </div>
                <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${tone ? `bg-white/80 ${tone.pill}` : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                    {icon}
                </div>
            </div>

            {hasTarget && targetValue !== undefined && tone && (
                <div className="relative mt-5 space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>{inverseColor ? '周预算' : isRateMetric ? '目标' : '周目标'}</span>
                        <span className="font-mono text-slate-700">{formatter(targetValue)}</span>
                    </div>
                    {!isRateMetric && (
                        <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200/70">
                            <div
                                className={`h-full rounded-full bg-gradient-to-r ${tone.bar} transition-all duration-700`}
                                style={{ width: `${Math.min(progress, 100)}%` }}
                            />
                        </div>
                    )}
                    <div className="flex items-center justify-between text-xs gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                            {!isRateMetric && (
                                <span className={`inline-flex items-center rounded-full border px-2.5 py-1 font-semibold ${tone.pill}`}>
                                    {(ratio * 100).toFixed(1)}%
                                </span>
                            )}
                            {gapStr && (
                                <span className={`inline-flex items-center rounded-full border px-2.5 py-1 font-semibold ${tone.pill}`}>
                                    距目标 {gapStr}
                                </span>
                            )}
                            {isRateMetric && !gapStr && (
                                <span className={`inline-flex items-center rounded-full border px-2.5 py-1 font-semibold ${tone.pill}`}>
                                    {(ratio * 100).toFixed(1)}%
                                </span>
                            )}
                        </div>
                        <span className="font-mono text-slate-400 whitespace-nowrap">
                            {inverseColor ? '预算使用率' : isRateMetric ? 'vs 月目标' : '周目标完成度'}
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
};

/** 迷你趋势线：纯 SVG，无图表库依赖，首屏不额外拉分包 */
const Sparkline: React.FC<{ values: number[]; labels?: string[] }> = ({ values, labels }) => {
    if (values.length < 2) {
        return <div className="flex h-full items-center justify-end text-[10px] text-slate-400">数据不足，无法画趋势</div>;
    }
    const max = Math.max(...values);
    const min = Math.min(...values);
    const span = max - min || 1;
    const coords = values.map((value, index) => {
        const x = (index / (values.length - 1)) * 100;
        const y = 26 - ((value - min) / span) * 22;
        return { x, y, value, index };
    });
    const points = coords.map(point => `${point.x.toFixed(2)},${point.y.toFixed(2)}`);
    const area = `0,30 ${points.join(' ')} 100,30`;
    // 异常点：负值画红点，便于一眼看到哪天/哪期为负
    const anomalies = coords.filter(point => point.value < 0);
    return (
        <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-full w-full" aria-hidden="true">
            <polygon points={area} fill="url(#spark-fill)" />
            <polyline points={points.join(' ')} fill="none" stroke="#0ea5e9" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            {anomalies.map(point => (
                <g key={point.index}>
                    <circle cx={point.x} cy={point.y} r="2.4" fill="#f43f5e" vectorEffect="non-scaling-stroke" />
                    {labels?.[point.index] && <title>{`${labels[point.index]}：${point.value.toFixed(0)}`}</title>}
                </g>
            ))}
            <defs>
                <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.22" />
                    <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
                </linearGradient>
            </defs>
        </svg>
    );
};

const DashboardOverviewInner: React.FC<DashboardOverviewProps> = ({    current,
    target,
    periodMode = 'month',
    rawData = [],
    historyData,
    filters,
    targetRows = [],
    pacingRatio = 1,
}: DashboardOverviewProps) => {
    const isWeeklyMode = periodMode === 'week';
    const isDailyMode = periodMode === 'day';
    const [expandedMetric, setExpandedMetric] = useState<MetricCardKey | null>(null);
    /** 首屏主指标：默认毛利额（更关心利润），可切到销售额 */
    const [mainMetric, setMainMetric] = useState<'sales_amount' | 'gross_profit'>('gross_profit');
    /** 趋势用的数据源：优先长历史，这样选单日/短区间时曲线依然连续 */
    const trendSource = historyData && historyData.length > 0 ? historyData : rawData;
    /** 趋势面板的期数范围：默认近 12 期，日度默认近 30 天 */
    const [trendRange, setTrendRange] = useState<number>(isDailyMode ? 30 : 12);
    /** 切粒度时把期数重置成该粒度合理的默认值，避免「近12天」这种别扭组合 */
    useEffect(() => {
        setTrendRange(isDailyMode ? 30 : 12);
    }, [periodMode]);

    const handleCardClick = (key: MetricCardKey) => {
        setExpandedMetric(prev => (prev === key ? null : key));
    };

    /** 主指标近 30 天的日序列（云端日明细；本地月报只有月粒度，画不出趋势就留空） */
    const sparkSeries = useMemo(() => {
        if (!trendSource.length) return { values: [] as number[], labels: [] as string[] };
        const byDate = new Map<string, number>();
        for (const row of trendSource) {
            const value = mainMetric === 'sales_amount' ? Number(row.sales_amount) || 0 : Number(row.gross_profit) || 0;
            byDate.set(row.date, (byDate.get(row.date) || 0) + value);
        }
        const entries = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-30);
        return { values: entries.map(([, value]) => value), labels: entries.map(([date]) => date) };
    }, [trendSource, mainMetric]);
    const sparkValues = sparkSeries.values;

    const mainValue = mainMetric === 'sales_amount' ? current.sales_amount : current.gross_profit;
    const mainTarget = mainMetric === 'sales_amount' ? target.sales_amount : target.gross_profit;
    const mainAchievement = mainTarget > 0 ? (mainValue / mainTarget) * 100 : NaN;

    const hasChartData = trendSource.length > 0 && filters;

    const getMetricConfig = (key: MetricCardKey) => {
        switch (key) {
            case 'sales_quantity':
                return { label: '销量', formatter: formatNumber, isPercent: false, isMoney: false, targetKey: 'sales_quantity_target' };
            case 'sales_amount':
                return { label: '销售额', formatter: formatMoneyNoDecimals, isPercent: false, isMoney: true, targetKey: 'sales_amount_target' };
            case 'gross_profit':
                return { label: '毛利额', formatter: formatMoneyNoDecimals, isPercent: false, isMoney: true, targetKey: 'gross_profit_target' };
            case 'gross_margin':
                return { label: '毛利率', formatter: formatPercent, isPercent: true, isMoney: false, targetKey: 'gross_margin_target' };
            case 'ad_spend':
                return { label: '广告花费', formatter: formatMoneyNoDecimals, isPercent: false, isMoney: true, targetKey: 'ad_spend_target' };
        }
    };

    const renderTrendPanel = () => {
        if (!expandedMetric || !hasChartData) return null;
        const cfg = getMetricConfig(expandedMetric);
        const rangeOptions: number[] = isDailyMode ? [7, 30, 0] : [6, 12, 0];
        const rangeText = trendRange === 0 ? '全部' : `近${trendRange}${periodUnitLabel(periodMode)}`;

        return (
            <div className="rounded-3xl border border-sky-200/60 bg-white p-4 shadow-[0_20px_60px_-30px_rgba(14,165,233,0.2)] ring-1 ring-sky-100/80 sm:p-5">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                        <TrendingUp className="h-4 w-4 shrink-0 text-sky-500" />
                        <span className="truncate text-sm font-bold text-slate-700">
                            {isDailyMode ? `当日${cfg.label}` : isWeeklyMode ? `本周${cfg.label}` : `${cfg.label}`} 历史趋势
                        </span>
                        <span className="whitespace-nowrap text-[10px] text-slate-400">（{rangeText}）</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="inline-flex rounded-md bg-slate-100 p-0.5">
                            {rangeOptions.map(n => (
                                <button
                                    key={n}
                                    type="button"
                                    onClick={e => {
                                        e.stopPropagation();
                                        setTrendRange(n);
                                    }}
                                    className={`rounded px-2 py-0.5 text-[10.5px] font-medium transition-all ${
                                        trendRange === n ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                                    }`}
                                >
                                    {n === 0 ? '全部' : `${n}`}
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={() => setExpandedMetric(null)}
                            className="rounded-full p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>
                <Suspense fallback={<p className="py-8 text-center text-sm text-slate-500">正在加载趋势图…</p>}><MiniTrendChart
                    rawData={trendSource!}
                    filters={filters!}
                    metricKey={expandedMetric}
                    metricLabel={cfg.label}
                    formatter={cfg.formatter}
                    isPercent={cfg.isPercent}
                    isMoney={cfg.isMoney}
                    periodMode={periodMode}
                    targetRows={targetRows}
                    targetKey={cfg.targetKey}
                    rangeCount={trendRange}
                /></Suspense>
            </div>
        );
    };

    if (isWeeklyMode) {
        return (
            <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
                    <WeeklyMetricCard
                        label="本周销量"
                        metricKey="sales_quantity"
                        value={current.sales_quantity}
                        targetValue={target.sales_quantity}
                        formatter={formatNumber}
                        icon={<BarChart3 className="h-5 w-5" />}
                        isActive={expandedMetric === 'sales_quantity'}
                        onClick={() => handleCardClick('sales_quantity')}
                    />
                    <WeeklyMetricCard
                        label="本周销售额"
                        metricKey="sales_amount"
                        value={current.sales_amount}
                        targetValue={target.sales_amount}
                        formatter={formatMoneyNoDecimals}
                        icon={<BadgeDollarSign className="h-5 w-5" />}
                        isActive={expandedMetric === 'sales_amount'}
                        onClick={() => handleCardClick('sales_amount')}
                    />
                    <WeeklyMetricCard
                        label="本周毛利额"
                        metricKey="gross_profit"
                        value={current.gross_profit}
                        targetValue={target.gross_profit}
                        formatter={formatMoneyNoDecimals}
                        icon={<Goal className="h-5 w-5" />}
                        isActive={expandedMetric === 'gross_profit'}
                        onClick={() => handleCardClick('gross_profit')}
                    />
                    <WeeklyMetricCard
                        label="本周毛利率"
                        metricKey="gross_margin"
                        value={current.gross_margin}
                        targetValue={target.gross_margin}
                        formatter={formatPercent}
                        icon={<Activity className="h-5 w-5" />}
                        isRateMetric
                        isActive={expandedMetric === 'gross_margin'}
                        onClick={() => handleCardClick('gross_margin')}
                    />
                    <WeeklyMetricCard
                        label="本周广告花费"
                        metricKey="ad_spend"
                        value={current.ad_spend}
                        targetValue={target.ad_spend}
                        formatter={formatMoneyNoDecimals}
                        icon={<Megaphone className="h-5 w-5" />}
                        inverseColor
                        isActive={expandedMetric === 'ad_spend'}
                        onClick={() => handleCardClick('ad_spend')}
                    />
                </div>
                {renderTrendPanel()}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-3">
                {/* 主指标：整块可点，点一次展开趋势、再点收起 */}
                <section
                    role="button"
                    tabIndex={0}
                    onClick={() => handleCardClick(mainMetric)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            handleCardClick(mainMetric);
                        }
                    }}
                    className={`lg:col-span-2 cursor-pointer rounded-2xl border bg-white p-5 transition hover:border-sky-300 ${expandedMetric === mainMetric ? 'border-sky-300 ring-2 ring-sky-100' : 'border-slate-200'}`}
                >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1" onClick={event => event.stopPropagation()}>
                            {([['gross_profit', '毛利额'], ['sales_amount', '销售额']] as const).map(([key, label]) => (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        setMainMetric(key);
                                    }}
                                    className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${mainMetric === key ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                        <span className="flex items-center gap-1 text-[11px] font-medium text-slate-400">
                            {expandedMetric === mainMetric ? '收起趋势' : '展开趋势'}
                            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expandedMetric === mainMetric ? 'rotate-180' : ''}`} />
                        </span>
                    </div>

                    <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
                        <div>
                            <div className="text-3xl font-bold tracking-tight text-slate-900">
                                {mainMetric === 'sales_amount' ? formatMoneyNoDecimals(current.sales_amount) : formatMoneyNoDecimals(current.gross_profit)}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                                目标 {mainMetric === 'sales_amount' ? formatMoneyNoDecimals(target.sales_amount) : formatMoneyNoDecimals(target.gross_profit)}
                                <span className="mx-1.5 text-slate-300">·</span>
                                达成 <span className={mainAchievement >= 100 ? 'font-semibold text-emerald-600' : 'font-semibold text-slate-700'}>
                                    {Number.isFinite(mainAchievement) ? `${mainAchievement.toFixed(1)}%` : '—'}
                                </span>
                            </div>
                        </div>
                        <div className="h-14 w-full max-w-[280px] shrink-0">
                            <Sparkline values={sparkValues} labels={sparkSeries.labels} />
                        </div>
                    </div>

                    <div className="mt-4">
                        <div className="relative h-2 overflow-hidden rounded-full bg-slate-100">
                            <div
                                className={`h-full rounded-full transition-all ${mainAchievement >= 100 ? 'bg-emerald-500' : 'bg-sky-500'}`}
                                style={{ width: `${Math.min(Math.max(mainAchievement || 0, 0), 100)}%` }}
                            />
                        </div>
                        <div className="mt-1 flex justify-between text-[10px] text-slate-400">
                            <span>0</span>
                            <span>{pacingRatio >= 0.999 ? '区间已完成' : `序时 ${Math.round(pacingRatio * 100)}%`}</span>
                            <span>100%</span>
                        </div>
                    </div>
                </section>

                {/* 次级指标：行式，比卡片省一半高度 */}
                <div className="space-y-3">
                    {[
                        { key: 'gross_margin' as MetricCardKey, label: '毛利率', value: formatPercent(current.gross_margin), targetText: target.gross_margin ? `目标 ${formatPercent(target.gross_margin)}` : '无目标', ratio: target.gross_margin ? current.gross_margin / target.gross_margin : NaN },
                        { key: 'sales_quantity' as MetricCardKey, label: '销量', value: formatNumber(current.sales_quantity), targetText: `目标 ${formatNumber(target.sales_quantity)}`, ratio: target.sales_quantity ? current.sales_quantity / target.sales_quantity : NaN },
                        { key: 'ad_spend' as MetricCardKey, label: '广告占比', value: formatPercent(current.sales_amount > 0 ? current.ad_spend / current.sales_amount : 0), targetText: `花费 ${formatMoneyNoDecimals(current.ad_spend)}`, ratio: target.ad_spend ? current.ad_spend / target.ad_spend : NaN },
                    ].map(item => (
                        <button
                            key={item.key}
                            type="button"
                            onClick={() => handleCardClick(item.key)}
                            className={`flex w-full items-center justify-between gap-3 rounded-2xl border bg-white px-4 py-3 text-left transition hover:border-sky-300 ${expandedMetric === item.key ? 'border-sky-300 ring-2 ring-sky-100' : 'border-slate-200'}`}
                        >
                            <div className="min-w-0">
                                <div className="text-[11px] text-slate-500">{item.label}</div>
                                <div className="text-base font-semibold text-slate-900">{item.value}</div>
                            </div>
                            <div className="shrink-0 text-right">
                                <div className="text-[10px] text-slate-400">{item.targetText}</div>
                                {Number.isFinite(item.ratio) && (
                                    <div className="mt-1 h-1 w-16 overflow-hidden rounded-full bg-slate-100">
                                        <div className={`h-full rounded-full ${item.ratio >= 1 ? 'bg-emerald-500' : 'bg-sky-400'}`} style={{ width: `${Math.min(Math.max(item.ratio * 100, 0), 100)}%` }} />
                                    </div>
                                )}
                            </div>
                        </button>
                    ))}
                </div>
            </div>
            {renderTrendPanel()}
        </div>
    );
};

/** 只在 props 变化时重渲染：父级其它状态（弹窗、侧栏等）变化时不再重算整块 KPI */
export const DashboardOverview = React.memo(DashboardOverviewInner);

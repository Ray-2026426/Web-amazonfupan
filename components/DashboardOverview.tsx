import React, { useState } from 'react';
import { AggregatedData, DataRow, FilterState, TargetRow } from '../types';
import {
    formatNumber,
    formatPercent,
    formatMoneyNoDecimals,
    getPacingCompletionRatio,
    formatTargetGapPctPoints,
} from '../utils';
import { Activity, BadgeDollarSign, BarChart3, Goal, Megaphone, TrendingUp, X } from 'lucide-react';
import { MiniTrendChart } from './MiniTrendChart';

interface DashboardOverviewProps {
    current: AggregatedData;
    target: AggregatedData;
    isWeeklyMode?: boolean;
    rawData?: DataRow[];
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
}) => {
    const ratio = max === 0 ? 0 : value / max;
    const progress = clampRatio(value, max) * 100;
    const tone = toneClassMap[getTrendTone(ratio, inverseColor)];
    const pacingPct = isRateMetric ? null : getPacingCompletionRatio(value, max, pacingRatio);
    const pacingTone = pacingPct !== null
        ? toneClassMap[getTrendTone(pacingPct, inverseColor)]
        : null;
    const gapStr = isRateMetric && max ? formatTargetGapPctPoints(value, max) : null;
    const gapTone = isRateMetric && max ? toneClassMap[getGapTone(value, max)] : null;

    return (
        <div
            onClick={onClick}
            className={`relative overflow-hidden rounded-3xl border bg-white p-5 shadow-[0_18px_50px_-30px_rgba(15,23,42,0.35)] transition-all duration-200 cursor-pointer
                ${isActive
                    ? 'border-sky-400/60 ring-2 ring-sky-400/30 shadow-[0_20px_60px_-25px_rgba(14,165,233,0.4)] scale-[1.02]'
                    : 'border-white/80 ring-1 ' + tone.ring + ' hover:shadow-[0_20px_55px_-28px_rgba(15,23,42,0.45)] hover:scale-[1.01]'
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

            <div className="relative mt-5 space-y-2">
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
            </div>
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
            className={`relative overflow-hidden rounded-3xl border bg-white p-5 shadow-[0_18px_50px_-30px_rgba(15,23,42,0.35)] transition-all duration-200 cursor-pointer
                ${isActive
                    ? 'border-sky-400/60 ring-2 ring-sky-400/30 shadow-[0_20px_60px_-25px_rgba(14,165,233,0.4)] scale-[1.02]'
                    : tone
                        ? 'border-white/80 ring-1 ' + tone.ring + ' hover:shadow-[0_20px_55px_-28px_rgba(15,23,42,0.45)] hover:scale-[1.01]'
                        : 'ring-1 ring-slate-200/80 hover:shadow-[0_20px_55px_-28px_rgba(15,23,42,0.45)] hover:scale-[1.01]'
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

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({
    current,
    target,
    isWeeklyMode = false,
    rawData = [],
    filters,
    targetRows = [],
    pacingRatio = 1,
}) => {
    const [expandedMetric, setExpandedMetric] = useState<MetricCardKey | null>(null);

    const handleCardClick = (key: MetricCardKey) => {
        setExpandedMetric(prev => (prev === key ? null : key));
    };

    const hasChartData = rawData.length > 0 && filters;

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

        return (
            <div className="rounded-3xl border border-sky-200/60 bg-white p-5 shadow-[0_20px_60px_-30px_rgba(14,165,233,0.2)] ring-1 ring-sky-100/80">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-sky-500" />
                        <span className="text-sm font-bold text-slate-700">
                            {isWeeklyMode ? `本周${cfg.label}` : `${cfg.label}`} 历史趋势
                        </span>
                        <span className="text-[10px] text-slate-400">
                            （最近12{isWeeklyMode ? '周' : '个月'}）
                        </span>
                    </div>
                    <button
                        onClick={() => setExpandedMetric(null)}
                        className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
                <MiniTrendChart
                    rawData={rawData!}
                    filters={filters!}
                    metricKey={expandedMetric}
                    metricLabel={cfg.label}
                    formatter={cfg.formatter}
                    isPercent={cfg.isPercent}
                    isMoney={cfg.isMoney}
                    isWeekly={isWeeklyMode}
                    targetRows={targetRows}
                    targetKey={cfg.targetKey}
                />
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
                <ProgressMetricCard
                    label="销量达成"
                    metricKey="sales_quantity"
                    value={current.sales_quantity}
                    max={target.sales_quantity}
                    formatter={formatNumber}
                    icon={<BarChart3 className="h-5 w-5" />}
                    isActive={expandedMetric === 'sales_quantity'}
                    onClick={() => handleCardClick('sales_quantity')}
                    pacingRatio={pacingRatio}
                />
                <ProgressMetricCard
                    label="销售额达成"
                    metricKey="sales_amount"
                    value={current.sales_amount}
                    max={target.sales_amount}
                    formatter={formatMoneyNoDecimals}
                    icon={<BadgeDollarSign className="h-5 w-5" />}
                    isActive={expandedMetric === 'sales_amount'}
                    onClick={() => handleCardClick('sales_amount')}
                    pacingRatio={pacingRatio}
                />
                <ProgressMetricCard
                    label="毛利额达成"
                    metricKey="gross_profit"
                    value={current.gross_profit}
                    max={target.gross_profit}
                    formatter={formatMoneyNoDecimals}
                    icon={<Goal className="h-5 w-5" />}
                    isActive={expandedMetric === 'gross_profit'}
                    onClick={() => handleCardClick('gross_profit')}
                    pacingRatio={pacingRatio}
                />
                <ProgressMetricCard
                    label="毛利率达成"
                    metricKey="gross_margin"
                    value={current.gross_margin}
                    max={target.gross_margin}
                    formatter={formatPercent}
                    icon={<Activity className="h-5 w-5" />}
                    isRateMetric
                    isActive={expandedMetric === 'gross_margin'}
                    onClick={() => handleCardClick('gross_margin')}
                    pacingRatio={pacingRatio}
                />
                <ProgressMetricCard
                    label="广告预算消耗"
                    metricKey="ad_spend"
                    value={current.ad_spend}
                    max={target.ad_spend}
                    formatter={formatMoneyNoDecimals}
                    icon={<Megaphone className="h-5 w-5" />}
                    inverseColor={true}
                    isActive={expandedMetric === 'ad_spend'}
                    onClick={() => handleCardClick('ad_spend')}
                    pacingRatio={pacingRatio}
                />
            </div>
            {renderTrendPanel()}
        </div>
    );
};

import React from 'react';
import { AggregatedData } from '../types';
import { formatNumber, formatPercent, formatMoneyNoDecimals } from '../utils';
import { Activity, BadgeDollarSign, BarChart3, Goal, Megaphone } from 'lucide-react';

interface DashboardOverviewProps {
    current: AggregatedData;
    target: AggregatedData;
    isWeeklyMode?: boolean;
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

const ProgressMetricCard = ({
    label,
    value,
    max,
    formatter,
    icon,
    inverseColor = false
}: {
    label: string;
    value: number;
    max: number;
    formatter: (v: number) => string;
    icon: React.ReactNode;
    inverseColor?: boolean;
}) => {
    const ratio = max === 0 ? 0 : value / max;
    const progress = clampRatio(value, max) * 100;
    const tone = toneClassMap[getTrendTone(ratio, inverseColor)];

    return (
        <div className={`relative overflow-hidden rounded-3xl border border-white/80 bg-white p-5 shadow-[0_18px_50px_-30px_rgba(15,23,42,0.35)] ring-1 ${tone.ring}`}>
            <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${tone.glow}`} />
            <div className="relative flex items-start justify-between gap-3">
                <div>
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                        {label}
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
                <div className="flex items-center justify-between text-xs">
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 font-semibold ${tone.pill}`}>
                        {(ratio * 100).toFixed(1)}%
                    </span>
                    <span className="font-mono text-slate-400">{inverseColor ? '预算使用率' : '目标达成率'}</span>
                </div>
            </div>
        </div>
    );
};

const WeeklyMetricCard = ({
    label,
    value,
    formatter,
    icon
}: {
    label: string;
    value: number;
    formatter: (v: number) => string;
    icon: React.ReactNode;
}) => (
    <div className="relative overflow-hidden rounded-3xl border border-white/80 bg-white p-5 shadow-[0_18px_50px_-30px_rgba(15,23,42,0.35)] ring-1 ring-slate-200/80">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(14,165,233,0.12),transparent_42%)]" />
        <div className="relative flex items-start justify-between gap-3">
            <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">{label}</div>
                <div className="text-3xl font-bold tracking-tight text-slate-900 font-mono">{formatter(value)}</div>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-600">
                {icon}
            </div>
        </div>
    </div>
);

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({ current, target, isWeeklyMode }) => {
    if (isWeeklyMode) {
        return (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
                <WeeklyMetricCard label="本周销量" value={current.sales_quantity} formatter={formatNumber} icon={<BarChart3 className="h-5 w-5" />} />
                <WeeklyMetricCard label="本周销售额" value={current.sales_amount} formatter={formatMoneyNoDecimals} icon={<BadgeDollarSign className="h-5 w-5" />} />
                <WeeklyMetricCard label="本周毛利额" value={current.gross_profit} formatter={formatMoneyNoDecimals} icon={<Goal className="h-5 w-5" />} />
                <WeeklyMetricCard label="本周毛利率" value={current.gross_margin} formatter={formatPercent} icon={<Activity className="h-5 w-5" />} />
                <WeeklyMetricCard label="本周广告花费" value={current.ad_spend} formatter={formatMoneyNoDecimals} icon={<Megaphone className="h-5 w-5" />} />
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <ProgressMetricCard
                label="销量达成"
                value={current.sales_quantity}
                max={target.sales_quantity}
                formatter={formatNumber}
                icon={<BarChart3 className="h-5 w-5" />}
            />
            <ProgressMetricCard
                label="销售额达成"
                value={current.sales_amount}
                max={target.sales_amount}
                formatter={formatMoneyNoDecimals}
                icon={<BadgeDollarSign className="h-5 w-5" />}
            />
            <ProgressMetricCard
                label="毛利额达成"
                value={current.gross_profit}
                max={target.gross_profit}
                formatter={formatMoneyNoDecimals}
                icon={<Goal className="h-5 w-5" />}
            />
            <ProgressMetricCard
                label="毛利率达成"
                value={current.gross_margin}
                max={target.gross_margin}
                formatter={formatPercent}
                icon={<Activity className="h-5 w-5" />}
            />
            <ProgressMetricCard
                label="广告预算消耗"
                value={current.ad_spend}
                max={target.ad_spend}
                formatter={formatMoneyNoDecimals}
                icon={<Megaphone className="h-5 w-5" />}
                inverseColor={true}
            />
        </div>
    );
};

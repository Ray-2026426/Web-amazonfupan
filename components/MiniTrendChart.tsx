import React, { useId, useMemo } from 'react';
import { DataRow, FilterState, TargetRow, PeriodMode } from '../types';
import {
    aggregateData,
    getBusinessWeekRangeFromYearWeek,
    filterData,
    periodKeyOf,
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
import { metricValue } from '../utils/metrics';
import {
    ChartTheme,
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
import { ChartLegendItem, ChartTooltipCard, TooltipRow } from './ChartTooltip';

interface MiniTrendChartProps {
    rawData: DataRow[];
    filters: FilterState;
    metricKey: string;
    metricLabel: string;
    formatter: (v: number) => string;
    isPercent: boolean;
    isMoney: boolean;
    periodMode: PeriodMode;
    targetRows?: TargetRow[];
    targetKey?: string;
    /** 横轴期数：默认近 12 期，传 0 表示全部 */
    rangeCount?: number;
}

/** 数据覆盖的完整日期范围（前后各留一天，确保边界被包含） */
const getWideDateRange = (data: DataRow[]) => {
    if (data.length === 0) return { start: new Date('2024-01-01'), end: new Date() };
    const dates = data.map(d => d.date).sort();
    const firstDate = new Date(dates[0]);
    const lastDate = new Date(dates[dates.length - 1]);
    // 加上一天，确保包含最后一天
    lastDate.setDate(lastDate.getDate() + 1);
    return { start: firstDate, end: lastDate };
};

export const MiniTrendChart: React.FC<MiniTrendChartProps> = ({
    rawData,
    filters,
    metricKey,
    metricLabel,
    formatter,
    isPercent,
    isMoney,
    periodMode,
    targetRows = [],
    targetKey,
    rangeCount = 12,
}) => {
    const theme: ChartTheme = useChartTheme();
    const gradientId = `mini-trend-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const mainColor = seriesColor(theme, 0);
    /** 目标线只对月度有意义：目标表是月粒度，周/日目标由月目标分摊，画在趋势上会误导 */
    const showTarget = periodMode === 'month' && Boolean(targetKey) && targetRows.length > 0;

    const chartData = useMemo(() => {
        if (rawData.length === 0) return [];

        // 按维度筛选，但不限制日期范围（需要完整历史）
        const dateRange = getWideDateRange(rawData);
        const filtered = filterData(rawData, dateRange, filters);

        // 按时间分组
        const timeGroups: Record<string, DataRow[]> = {};
        filtered.forEach(row => {
            const timeKey = periodKeyOf(row.date, periodMode);
            if (!timeKey) return;
            if (!timeGroups[timeKey]) timeGroups[timeKey] = [];
            timeGroups[timeKey].push(row);
        });

        // 按时间排序
        const sortedKeys = Object.keys(timeGroups).sort();

        // 目标数据聚合（仅月度模式，且目标表本身是月粒度）
        const targetByMonth: Record<string, number> = {};
        if (showTarget) {
            targetRows.forEach(t => {
                // 目标行也需要按筛选维度过滤
                const passesFilter = (() => {
                    if (filters.countries.includes('__NONE__')) return false;
                    if (filters.countries.length > 0 && !filters.countries.includes(t.country)) return false;
                    if (filters.brands.includes('__NONE__')) return false;
                    if (filters.brands.length > 0 && !filters.brands.includes(t.brand)) return false;
                    if (filters.managers.includes('__NONE__')) return false;
                    if (filters.managers.length > 0 && !filters.managers.includes(t.manager)) return false;
                    return true;
                })();
                if (!passesFilter) return;
                const m = t.month;
                targetByMonth[m] = (targetByMonth[m] || 0) + ((t as any)[targetKey] || 0);
            });
        }

        // 只显示最近 N 个时间点，避免图表过挤
        const showKeys =
            rangeCount > 0 && sortedKeys.length > rangeCount ? sortedKeys.slice(-rangeCount) : sortedKeys;

        const tickLabels = buildAxisTickLabels(showKeys, periodMode);

        return showKeys.map(timeKey => {
            const agg = aggregateData(timeGroups[timeKey] || []);
            let value: number;

            // 特殊处理毛利率（从 gross_profit / sales_amount 计算）
            if (metricKey === 'gross_margin') {
                value = metricValue('gross_margin', { current: agg }) ?? 0;
            } else if (metricKey === 'ad_spend') {
                value = agg.ad_spend;
            } else {
                value = (agg as any)[metricKey] || 0;
            }

            const targetVal =
                showTarget && targetKey ? targetByMonth[timeKey] || 0 : undefined;

            return {
                time: timeKey,
                tick: tickLabels[timeKey],
                value,
                target: targetVal,
            };
        });
    }, [rawData, filters, metricKey, periodMode, targetRows, targetKey, rangeCount, showTarget]);

    const hasTarget = chartData.some(d => d.target !== undefined && d.target > 0);
    const lastPoint = chartData[chartData.length - 1];

    /** 刻度取整（0/150k/300k），并保证目标线也在可视范围内 */
    const yAxis = (() => {
        const values = chartData.map(d => d.value).filter(v => Number.isFinite(v));
        const targets = chartData
            .map(d => d.target)
            .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
        const all = [...values, ...targets];
        const maxV = Math.max(...all, 0);
        if (isPercent) {
            const minV = Math.min(...all, maxV);
            const span = maxV - minV || Math.abs(maxV) * 0.1 || 0.01;
            return buildNiceAxis(Math.max(0, minV - span * 0.2), maxV + span * 0.2, 4);
        }
        return buildNiceAxis(0, maxV * 1.06, 4);
    })();

    /** 末端数值标签：只标「最新一期」，省得为了读一个数去悬停 */
    const lastValueLabel = lastPoint
        ? isPercent
            ? `${(lastPoint.value * 100).toFixed(1)}%`
            : isMoney
              ? `$${compactNumber(lastPoint.value)}`
              : compactCount(lastPoint.value)
        : '';

    const renderTooltip = ({ active, payload, label }: any) => {
        if (!active || !payload || payload.length === 0) return null;
        const index = chartData.findIndex(d => d.time === label);
        if (index < 0) return null;
        const row = chartData[index];
        const prev = index > 0 ? chartData[index - 1] : undefined;
        const period = formatPeriodLabel(String(label), getBusinessWeekRangeFromYearWeek);

        const rows: TooltipRow[] = [
            { key: 'value', color: mainColor, label: metricLabel, value: formatter(row.value) },
        ];
        if (hasTarget && row.target !== undefined) {
            rows.push({
                key: 'target',
                color: theme.target,
                label: '目标',
                value: formatter(row.target),
                hollow: true,
                muted: true,
            });
        }

        const achievement =
            hasTarget && row.target && row.target > 0 ? (row.value / row.target) * 100 : null;

        return (
            <ChartTooltipCard
                theme={theme}
                title={period.title}
                subtitle={period.subtitle}
                delta={prev ? formatDelta(row.value, prev.value) : null}
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

    if (chartData.length === 0) {
        return (
            <div className="flex h-44 flex-col items-center justify-center gap-1.5 text-slate-400">
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
                    <path d="M4 19V5M4 19h16" strokeLinecap="round" />
                    <path d="M7 15l3.5-4 3 2.4L19 7" strokeLinecap="round" strokeLinejoin="round" opacity="0.55" />
                </svg>
                <span className="text-xs">所选范围暂无趋势数据</span>
            </div>
        );
    }

    return (
        <div className="w-full">
            <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-500">
                <ChartLegendItem color={mainColor} label={metricLabel} />
                {hasTarget ? <ChartLegendItem color={theme.target} label="目标" dashed /> : null}
            </div>
            <div className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 16, right: 44, left: 0, bottom: 0 }}>
                        <defs>
                            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={mainColor} stopOpacity={0.22} />
                                <stop offset="100%" stopColor={mainColor} stopOpacity={0} />
                            </linearGradient>
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
                                return found ? found.tick : v;
                            }}
                            tick={{ fontSize: 10.5, fill: theme.axisTick }}
                            tickMargin={8}
                            axisLine={false}
                            tickLine={false}
                            interval="preserveStartEnd"
                            minTickGap={12}
                        />
                        <YAxis
                            tickFormatter={(v: number) =>
                                compactTick(v, { isMoney, isPercent, isCount: !isMoney && !isPercent })
                            }
                            tick={{ fontSize: 10.5, fill: theme.axisTick }}
                            axisLine={false}
                            tickLine={false}
                            width={46}
                            domain={yAxis.domain}
                            ticks={yAxis.ticks}
                        />
                        <Tooltip
                            content={renderTooltip}
                            cursor={{ stroke: theme.cursor, strokeWidth: 1, strokeDasharray: '3 3' }}
                            wrapperStyle={{ outline: 'none', zIndex: 30 }}
                        />
                        {hasTarget ? (
                            <Line
                                type="linear"
                                dataKey="target"
                                name="目标"
                                stroke={theme.target}
                                strokeWidth={1.5}
                                strokeDasharray="4 4"
                                dot={false}
                                activeDot={false}
                                isAnimationActive={false}
                            />
                        ) : null}
                        <Area
                            type="linear"
                            dataKey="value"
                            stroke="none"
                            fill={`url(#${gradientId})`}
                            isAnimationActive={false}
                            activeDot={false}
                        />
                        <Line
                            type="linear"
                            dataKey="value"
                            name={metricLabel}
                            stroke={mainColor}
                            strokeWidth={2.25}
                            strokeLinecap="round"
                            dot={false}
                            isAnimationActive={false}
                            activeDot={{
                                r: 4.5,
                                strokeWidth: 3,
                                stroke: theme.surface,
                                fill: mainColor,
                            }}
                        />
                        {lastPoint ? (
                            <ReferenceDot
                                x={lastPoint.time}
                                y={lastPoint.value}
                                r={3.2}
                                fill={mainColor}
                                stroke={theme.surface}
                                strokeWidth={2}
                                isFront
                                ifOverflow="extendDomain"
                                label={{
                                    value: lastValueLabel,
                                    position: 'top',
                                    offset: 5,
                                    fill: theme.textMuted,
                                    fontSize: 10,
                                    fontWeight: 600,
                                }}
                            />
                        ) : null}
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

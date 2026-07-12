import React, { useMemo } from 'react';
import { DataRow, FilterState, TargetRow } from '../types';
import {
    aggregateData,
    formatBusinessWeekFromDateStr,
    filterData,
    formatDate,
} from '../utils';
import {
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
    ComposedChart,
} from 'recharts';

interface MiniTrendChartProps {
    rawData: DataRow[];
    filters: FilterState;
    metricKey: string;
    metricLabel: string;
    formatter: (v: number) => string;
    isPercent: boolean;
    isMoney: boolean;
    isWeekly: boolean;
    targetRows?: TargetRow[];
    targetKey?: string;
}

const CHART_COLORS = ['#3b82f6', '#ef4444', '#10b981'];

/** 获取数据中最早的日期，向前扩展 12 个月作为宽范围 */
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
    isWeekly,
    targetRows = [],
    targetKey,
}) => {
    const chartData = useMemo(() => {
        if (rawData.length === 0) return [];

        // 按维度筛选，但不限制日期范围（需要完整历史）
        const dateRange = getWideDateRange(rawData);
        const filtered = filterData(rawData, dateRange, filters);

        // 按时间分组
        const timeGroups: Record<string, DataRow[]> = {};
        filtered.forEach(row => {
            const timeKey = isWeekly
                ? formatBusinessWeekFromDateStr(row.date)
                : row.date.substring(0, 7);
            if (!timeKey) return;
            if (!timeGroups[timeKey]) timeGroups[timeKey] = [];
            timeGroups[timeKey].push(row);
        });

        // 按时间排序
        const sortedKeys = Object.keys(timeGroups).sort();

        // 目标数据聚合（仅月度模式）
        const targetByMonth: Record<string, number> = {};
        if (!isWeekly && targetKey && targetRows.length > 0) {
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

        // 只显示最近 12 个时间点，避免图表过挤
        const showKeys = sortedKeys.length > 12 ? sortedKeys.slice(-12) : sortedKeys;

        return showKeys.map(timeKey => {
            const agg = aggregateData(timeGroups[timeKey] || []);
            let value: number;

            // 特殊处理毛利率（从 gross_profit / sales_amount 计算）
            if (metricKey === 'gross_margin') {
                value = agg.sales_amount > 0 ? agg.gross_profit / agg.sales_amount : 0;
            } else if (metricKey === 'ad_spend') {
                value = agg.ad_spend;
            } else {
                value = (agg as any)[metricKey] || 0;
            }

            const targetVal = (!isWeekly && targetKey)
                ? (targetByMonth[timeKey] || 0)
                : undefined;

            return {
                time: isWeekly ? timeKey.replace(/^\d{4}-/, '') : timeKey,
                value,
                target: targetVal,
            };
        });
    }, [rawData, filters, metricKey, isWeekly, targetRows, targetKey]);

    if (chartData.length === 0) {
        return (
            <div className="flex items-center justify-center h-40 text-xs text-slate-400">
                暂无趋势数据
            </div>
        );
    }

    const hasTarget = chartData.some(d => d.target !== undefined && d.target > 0);

    const formatTooltipValue = (val: number, name: string) => {
        if (name === 'target') return formatter(val);
        return formatter(val);
    };

    return (
        <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis
                        dataKey="time"
                        tick={{ fontSize: 10, fill: '#94a3b8' }}
                        tickMargin={4}
                        interval="preserveStartEnd"
                    />
                    <YAxis
                        tickFormatter={(v) => {
                            if (isPercent) return `${(v * 100).toFixed(0)}%`;
                            if (Math.abs(v) >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
                            if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
                            return v;
                        }}
                        tick={{ fontSize: 10, fill: '#94a3b8' }}
                        width={50}
                    />
                    <Tooltip
                        formatter={(val: number, name: string) => {
                            if (name === 'target') return [formatter(val), '目标'];
                            return [formatter(val), metricLabel];
                        }}
                        labelStyle={{ color: '#1e293b', fontWeight: 600, fontSize: 12 }}
                        contentStyle={{
                            borderRadius: 8,
                            border: '1px solid rgba(148,163,184,0.3)',
                            backgroundColor: 'rgba(255,255,255,0.95)',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                            fontSize: 11,
                        }}
                    />
                    {hasTarget && (
                        <Legend
                            wrapperStyle={{ fontSize: 10, paddingTop: 0 }}
                            iconSize={8}
                        />
                    )}
                    <Line
                        type="monotone"
                        dataKey="value"
                        name={metricLabel}
                        stroke={CHART_COLORS[0]}
                        strokeWidth={2}
                        dot={{ r: 2, strokeWidth: 1, fill: '#fff' }}
                        activeDot={{ r: 4, strokeWidth: 0 }}
                    />
                    {hasTarget && (
                        <Line
                            type="monotone"
                            dataKey="target"
                            name="目标"
                            stroke={CHART_COLORS[1]}
                            strokeWidth={1.5}
                            strokeDasharray="5 3"
                            dot={false}
                        />
                    )}
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
};

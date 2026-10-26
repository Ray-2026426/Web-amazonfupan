import React, { useMemo, useState } from 'react';
import { Grid3x3 } from 'lucide-react';
import type { DataRow } from '../types';

type Metric = 'gross_profit' | 'sales_amount';

const METRIC_LABEL: Record<Metric, string> = {
    gross_profit: '毛利额',
    sales_amount: '销售额',
};

const money = (value: number) =>
    Math.abs(value) >= 10000 ? `${(value / 10000).toFixed(1)}万` : value.toFixed(0);

/**
 * 多维对比矩阵：行 = ASIN，列 = 日期，格子颜色 = 指标高低。
 * 用来一眼看出「哪个 ASIN 在哪一天塌了」——这是表格翻页翻不出来的。
 */
export const MetricMatrix: React.FC<{
    rows: DataRow[];
    onPick?: (asin: string, date: string) => void;
}> = ({ rows, onPick }) => {
    const [metric, setMetric] = useState<Metric>('gross_profit');
    const [topN, setTopN] = useState(12);

    const { asins, dates, cellValue, maxAbs } = useMemo(() => {
        const dateSet = new Set<string>();
        const byAsin = new Map<string, { name: string; values: Map<string, number>; total: number }>();
        for (const row of rows) {
            const asin = row.child_asin;
            if (!asin) continue;
            dateSet.add(row.date);
            const entry = byAsin.get(asin) || { name: row.product_name || asin, values: new Map<string, number>(), total: 0 };
            const value = Number(row[metric]) || 0;
            entry.values.set(row.date, (entry.values.get(row.date) || 0) + value);
            entry.total += value;
            byAsin.set(asin, entry);
        }
        const dateList = [...dateSet].sort();
        // 日期太多时只取最近 31 天，避免格子过于密集
        const trimmed = dateList.length > 31 ? dateList.slice(-31) : dateList;
        const asinList = [...byAsin.entries()]
            .sort((a, b) => Math.abs(b[1].total) - Math.abs(a[1].total))
            .slice(0, topN)
            .map(([asin, entry]) => ({ asin, name: entry.name, total: entry.total }));
        let max = 0;
        for (const entry of byAsin.values()) {
            for (const value of entry.values.values()) max = Math.max(max, Math.abs(value));
        }
        return {
            asins: asinList,
            dates: trimmed,
            cellValue: (asin: string, date: string) => byAsin.get(asin)?.values.get(date) ?? null,
            maxAbs: max || 1,
        };
    }, [rows, metric, topN]);

    if (!rows.length || !asins.length) return null;

    const colorOf = (value: number | null) => {
        if (value === null) return 'bg-slate-50';
        if (value === 0) return 'bg-slate-100';
        const intensity = Math.min(Math.abs(value) / maxAbs, 1);
        const alpha = 0.12 + intensity * 0.7;
        return value > 0
            ? `rgba(16, 185, 129, ${alpha.toFixed(2)})`
            : `rgba(244, 63, 94, ${alpha.toFixed(2)})`;
    };

    return (
        <section id="matrix" className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                    <Grid3x3 className="h-4 w-4 text-sky-500" />
                    多维对比矩阵
                    <span className="text-[11px] font-normal text-slate-400">行 ASIN × 列日期，颜色越深数值越大，红色为负</span>
                </h2>
                <div className="flex items-center gap-2 text-[11px]">
                    <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5">
                        {(['gross_profit', 'sales_amount'] as Metric[]).map(value => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => setMetric(value)}
                                className={`rounded-md px-2 py-1 font-semibold transition ${metric === value ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-500'}`}
                            >
                                {METRIC_LABEL[value]}
                            </button>
                        ))}
                    </div>
                    <select
                        value={topN}
                        onChange={event => setTopN(Number(event.target.value))}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-600"
                    >
                        {[12, 20, 30].map(value => <option key={value} value={value}>前 {value} 个 ASIN</option>)}
                    </select>
                </div>
            </div>

            <div className="mt-3 overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-[2px] text-[10px]">
                    <thead>
                        <tr>
                            <th className="sticky left-0 z-10 bg-white px-2 py-1 text-left font-medium text-slate-500">ASIN / 品名</th>
                            {dates.map(date => (
                                <th key={date} className="px-1 py-1 text-center font-normal text-slate-400">
                                    {date.slice(5)}
                                </th>
                            ))}
                            <th className="px-2 py-1 text-right font-medium text-slate-500">合计</th>
                        </tr>
                    </thead>
                    <tbody>
                        {asins.map(item => (
                            <tr key={item.asin}>
                                <td className="sticky left-0 z-10 max-w-[170px] bg-white px-2 py-1">
                                    <div className="truncate font-mono text-[10px] text-slate-700">{item.asin}</div>
                                    <div className="truncate text-[9px] text-slate-400">{item.name}</div>
                                </td>
                                {dates.map(date => {
                                    const value = cellValue(item.asin, date);
                                    return (
                                        <td
                                            key={date}
                                            onClick={() => value !== null && onPick?.(item.asin, date)}
                                            title={value === null ? '无数据' : `${date} ${METRIC_LABEL[metric]} ${money(value)}`}
                                            className={`h-7 min-w-[38px] cursor-pointer rounded text-center align-middle font-mono ${value === null ? 'text-transparent' : 'text-slate-700'}`}
                                            style={{ backgroundColor: colorOf(value) }}
                                        >
                                            {value === null ? '' : money(value)}
                                        </td>
                                    );
                                })}
                                <td className={`px-2 py-1 text-right font-mono font-semibold ${item.total >= 0 ? 'text-slate-700' : 'text-rose-600'}`}>
                                    {money(item.total)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
};

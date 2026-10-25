import React, { useMemo } from 'react';
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Droplets, TrendingDown, TrendingUp } from 'lucide-react';
import type { AggregatedData, DataRow } from '../types';
import { formatMoneyNoDecimals, formatNumber } from '../utils';

interface ProfitWaterfallProps {
    current: AggregatedData;
    last: AggregatedData | null;
    currentRows: DataRow[];
    lastRows: DataRow[];
    /** 点归因表里的 ASIN 聚焦到该实体 */
    onFocusAsin?: (asin: string) => void;
}

type Step = { label: string; value: number; base: number; height: number; kind: 'total' | 'cost' | 'other' };

const COST_STEPS: { key: keyof AggregatedData; label: string }[] = [
    { key: 'platform_commission', label: '平台佣金' },
    { key: 'fba_fee', label: 'FBA 费' },
    { key: 'first_mile_cost', label: '头程' },
    { key: 'procurement_cost', label: '采购' },
    { key: 'storage_fee', label: '仓储' },
    { key: 'refund_cost', label: '退款' },
    { key: 'ad_spend', label: '广告' },
];

const money = (value: number) => formatMoneyNoDecimals(Number.isFinite(value) ? value : 0);

/** 按 ASIN 汇总毛利，用于「为什么变了」的归因 */
function grossProfitByAsin(rows: DataRow[]): Map<string, { name: string; shop: string; gp: number }> {
    const map = new Map<string, { name: string; shop: string; gp: number }>();
    for (const row of rows) {
        const key = `${row.shop_name}|${row.child_asin}`;
        const existing = map.get(key);
        if (existing) existing.gp += Number(row.gross_profit) || 0;
        else map.set(key, { name: row.product_name || row.child_asin, shop: row.shop_name || '', gp: Number(row.gross_profit) || 0 });
    }
    return map;
}

export const ProfitWaterfall: React.FC<ProfitWaterfallProps> = ({ current, last, currentRows, lastRows, onFocusAsin }) => {
    const steps = useMemo<Step[]>(() => {
        const sales = Number(current.sales_amount) || 0;
        const out: Step[] = [];
        let running = sales;
        out.push({ label: '销售额', value: sales, base: 0, height: sales, kind: 'total' });

        let deducted = 0;
        for (const step of COST_STEPS) {
            const raw = Math.abs(Number(current[step.key]) || 0);
            if (!raw) continue;
            deducted += raw;
            running -= raw;
            out.push({ label: step.label, value: -raw, base: running, height: raw, kind: 'cost' });
        }

        // 毛利由领星给出，和「销售额 − 各项成本」可能存在口径差（返点、其他费用等），补一个差额段让瀑布落到毛利
        const grossProfit = Number(current.gross_profit) || 0;
        const gap = grossProfit - running;
        if (Math.abs(gap) > 1) {
            out.push({ label: '其他/口径差', value: gap, base: Math.min(running, grossProfit), height: Math.abs(gap), kind: 'other' });
        }
        out.push({ label: '毛利', value: grossProfit, base: 0, height: Math.max(grossProfit, 0), kind: 'total' });
        return out;
    }, [current]);

    const attribution = useMemo(() => {
        if (!last) return [];
        const nowMap = grossProfitByAsin(currentRows);
        const prevMap = grossProfitByAsin(lastRows);
        const keys = new Set([...nowMap.keys(), ...prevMap.keys()]);
        const list: { key: string; name: string; shop: string; now: number; prev: number; delta: number }[] = [];
        for (const key of keys) {
            const now = nowMap.get(key);
            const prev = prevMap.get(key);
            const nowGp = now?.gp || 0;
            const prevGp = prev?.gp || 0;
            const delta = nowGp - prevGp;
            if (Math.abs(delta) < 1) continue;
            list.push({ key, name: now?.name || prev?.name || key, shop: now?.shop || prev?.shop || '', now: nowGp, prev: prevGp, delta });
        }
        return list.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 8);
    }, [currentRows, lastRows, last]);

    const revenueEffect = last && Number(last.sales_amount) !== 0
        ? (Number(current.sales_amount) - Number(last.sales_amount)) * (Number(last.gross_profit) / Number(last.sales_amount))
        : 0;
    const marginEffect = last
        ? Number(current.sales_amount) * (Number(current.gross_profit) / (Number(current.sales_amount) || 1) - Number(last.gross_profit) / (Number(last.sales_amount) || 1))
        : 0;
    const grossMargin = Number(current.sales_amount) > 0 ? Number(current.gross_profit) / Number(current.sales_amount) : 0;

    const maxValue = Math.max(...steps.map(step => step.base + step.height), 1);

    return (
        <section id="waterfall" className="rounded-3xl border border-white/80 bg-white/90 p-5 shadow-[0_20px_60px_-45px_rgba(15,23,42,0.5)] backdrop-blur-xl">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="flex items-center gap-2 text-base font-bold text-slate-800">
                        <Droplets className="h-4 w-4 text-sky-500" />
                        毛利瀑布
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">销售额一路减到毛利，看看钱花在哪些环节；点数字可对照下方明细。</p>
                </div>
                <div className="text-right">
                    <div className="text-[11px] text-slate-400">毛利率</div>
                    <div className={`text-lg font-bold ${grossMargin >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{(grossMargin * 100).toFixed(1)}%</div>
                </div>
            </div>

            <div className="mt-4 h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={steps} margin={{ top: 18, right: 8, left: 8, bottom: 4 }}>
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} interval={0} angle={-18} textAnchor="end" height={46} />
                        <YAxis hide domain={[0, maxValue * 1.05]} />
                        <Tooltip
                            cursor={{ fill: 'rgba(148,163,184,0.08)' }}
                            formatter={(_value: unknown, _name: unknown, entry: any) => [money(Number(entry?.payload?.value) || 0), '金额']}
                            labelFormatter={(label) => String(label)}
                        />
                        <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
                        <Bar dataKey="height" stackId="w" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                            {steps.map((step) => (
                                <Cell
                                    key={step.label}
                                    fill={step.kind === 'total' ? (step.label === '毛利' ? '#10b981' : '#0ea5e9') : step.kind === 'cost' ? '#f59e0b' : '#94a3b8'}
                                />
                            ))}
                            <LabelList
                                dataKey="value"
                                position="top"
                                formatter={(value: unknown) => money(Number(value) || 0)}
                                style={{ fontSize: 10, fill: '#475569' }}
                            />
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>

            {last && (
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-slate-100 bg-slate-50/70 px-3 py-2">
                        <div className="text-[11px] text-slate-400">毛利变化</div>
                        <div className={`text-sm font-bold ${Number(current.gross_profit) >= Number(last.gross_profit) ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {money(Number(current.gross_profit) - Number(last.gross_profit))}
                        </div>
                    </div>
                    <div className="rounded-2xl border border-slate-100 bg-slate-50/70 px-3 py-2">
                        <div className="text-[11px] text-slate-400 flex items-center gap-1"><TrendingUp className="h-3 w-3" />收入变化带来</div>
                        <div className="text-sm font-bold text-slate-700">{money(revenueEffect)}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-100 bg-slate-50/70 px-3 py-2">
                        <div className="text-[11px] text-slate-400 flex items-center gap-1"><TrendingDown className="h-3 w-3" />毛利率变化带来</div>
                        <div className="text-sm font-bold text-slate-700">{money(marginEffect)}</div>
                    </div>
                </div>
            )}

            {attribution.length > 0 && (
                <div className="mt-4">
                    <div className="mb-2 text-[11px] font-semibold text-slate-500">变化最大的 8 个 ASIN</div>
                    <div className="overflow-x-auto rounded-2xl border border-slate-100">
                        <table className="min-w-full text-xs">
                            <thead className="bg-slate-50 text-slate-500">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">ASIN / 品名</th>
                                    <th className="px-3 py-2 text-right font-medium">本期毛利</th>
                                    <th className="px-3 py-2 text-right font-medium">上期毛利</th>
                                    <th className="px-3 py-2 text-right font-medium">变化</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {attribution.map(row => (
                                    <tr key={row.key} className="hover:bg-slate-50/70">
                                        <td className="px-3 py-2">
                                            <button
                                                type="button"
                                                onClick={() => onFocusAsin?.(row.key.split('|')[1])}
                                                className="font-mono text-[11px] text-slate-700 transition hover:text-sky-600 hover:underline"
                                                title="点击聚焦这个 ASIN"
                                            >
                                                {row.key.split('|')[1]}
                                            </button>
                                            <div className="truncate text-[11px] text-slate-400">{row.name}{row.shop ? ` · ${row.shop}` : ''}</div>
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">{money(row.now)}</td>
                                        <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-500">{money(row.prev)}</td>
                                        <td className={`px-3 py-2 text-right font-mono tabular-nums font-semibold ${row.delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                            {row.delta >= 0 ? '+' : ''}{money(row.delta)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            <p className="mt-3 text-[10px] text-slate-400">
                口径：成本取绝对值；「其他/口径差」= 毛利 −（销售额 − 各项成本），用于对齐领星毛利，包含返点等未单列的费用。
                归因拆分：毛利变化 = 收入变化 × 上期毛利率 + 本期收入 × 毛利率变化。共 {formatNumber(currentRows.length)} 行明细参与计算。
            </p>
        </section>
    );
};

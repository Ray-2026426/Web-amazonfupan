import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowDown, Boxes, PackageX, TrendingDown, Wallet } from 'lucide-react';
import type { DataRow, InventoryRow } from '../types';
import type { ProductImageLookup } from '../utils';
import { formatNumber, formatPercent, formatRMB, resolveProductImage } from '../utils';

type Status = 'stockout' | 'restock' | 'healthy' | 'overstock' | 'idle';

const STATUS_META: Record<Status, { label: string; chip: string; action: string }> = {
    stockout: { label: '断货风险', chip: 'bg-rose-50 text-rose-700 ring-rose-200', action: '立即补货 / 空运' },
    restock: { label: '需要补货', chip: 'bg-amber-50 text-amber-700 ring-amber-200', action: '按交期排单' },
    healthy: { label: '健康', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200', action: '维持' },
    overstock: { label: '积压', chip: 'bg-violet-50 text-violet-700 ring-violet-200', action: '促销 / 清仓' },
    idle: { label: '无动销', chip: 'bg-slate-100 text-slate-600 ring-slate-200', action: '核对 listing / 停采' },
};

const STATUS_ORDER: Status[] = ['stockout', 'restock', 'healthy', 'overstock', 'idle'];
const AGE_BUCKETS: { key: string; label: string; min: number }[] = [
    { key: 'age_0_30_qty', label: '0-30', min: 0 },
    { key: 'age_31_60_qty', label: '31-60', min: 31 },
    { key: 'age_61_90_qty', label: '61-90', min: 61 },
    { key: 'age_91_180_qty', label: '91-180', min: 91 },
    { key: 'age_181_270_qty', label: '181-270', min: 181 },
    { key: 'age_271_330_qty', label: '271-330', min: 271 },
    { key: 'age_331_365_qty', label: '331-365', min: 331 },
    { key: 'age_365_plus_qty', label: '365+', min: 366 },
];

type DecisionRow = {
    key: string;
    asin: string;
    name: string;
    manager: string;
    country: string;
    shop: string;
    brand: string;
    qty: number;
    cost: number;
    dailySales: number;
    daysOfSupply: number | null;
    oldQty: number;
    oldRatio: number;
    monthlyGrossProfit: number;
    paybackMonths: number | null;
    status: Status;
};

/**
 * 库存决策表（P1）：把库存翻译成「补货 / 清仓 / 维持」三类动作。
 * 只用现有数据（库存快照 + 业绩明细），不引入新参数。
 */
export const InventoryDecision: React.FC<{
    rows: InventoryRow[];
    salesRows: DataRow[];
    imageLookup?: ProductImageLookup | null;
    onFocusParent?: (asin: string) => void;
}> = ({ rows, salesRows, imageLookup, onFocusParent }) => {
    const [sortKey, setSortKey] = useState<'cost' | 'days' | 'payback'>('cost');
    const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
    const [countryFilter, setCountryFilter] = useState('all');
    const [shopFilter, setShopFilter] = useState('all');
    const [brandFilter, setBrandFilter] = useState('all');

    const { decisions, windowDays } = useMemo(() => {
        if (!rows.length) return { decisions: [] as DecisionRow[], windowDays: 28 };

        // 销量窗口：以业绩数据里的最后一天为基准，往前 28 天
        const dates = salesRows.map(row => row.date).sort();
        const lastDate = dates[dates.length - 1];
        const windowDays = 28;
        const cutoff = lastDate
            ? new Date(Date.parse(`${lastDate}T00:00:00Z`) - (windowDays - 1) * 86400000).toISOString().slice(0, 10)
            : '';

        const distinctDays = new Set<string>();
        const salesByParent = new Map<string, { qty: number; amount: number; profit: number }>();
        for (const row of salesRows) {
            if (cutoff && row.date < cutoff) continue;
            distinctDays.add(row.date);
            const key = row.parent_asin || row.child_asin;
            if (!key) continue;
            const entry = salesByParent.get(key) || { qty: 0, amount: 0, profit: 0 };
            entry.qty += Number(row.sales_quantity) || 0;
            entry.amount += Number(row.sales_amount) || 0;
            entry.profit += Number(row.gross_profit) || 0;
            salesByParent.set(key, entry);
        }

        const byParent = new Map<string, InventoryRow[]>();
        for (const row of rows) {
            const key = row.parent_asin || row.asin || row.msku;
            if (!key) continue;
            const list = byParent.get(key) || [];
            list.push(row);
            byParent.set(key, list);
        }

        const decisions: DecisionRow[] = [];
        for (const [key, list] of byParent) {
            const qty = list.reduce((sum, row) => sum + (Number(row.fba_total_qty) || 0), 0);
            const cost = list.reduce((sum, row) => sum + (Number(row.fba_total_cost) || 0), 0);
            if (qty === 0 && cost === 0) continue;

            const ageQty = (bucket: string) => list.reduce((sum, row) => sum + (Number((row as unknown as Record<string, number>)[bucket]) || 0), 0);
            const totalAge = AGE_BUCKETS.reduce((sum, bucket) => sum + ageQty(bucket.key), 0);
            const oldQty = ageQty('age_181_270_qty') + ageQty('age_271_330_qty') + ageQty('age_331_365_qty') + ageQty('age_365_plus_qty');

            // 关键：按「实际有数据的天数」求日均，否则只选了 1 天时会把日均压低 28 倍，
            // 结果所有父体都显示"积压"，断货/补货永远是 0。
            const effectiveDays = Math.max(distinctDays.size, 1);
            const sales = salesByParent.get(key);
            const dailySales = sales ? sales.qty / effectiveDays : 0;
            const monthlyProfit = sales ? sales.profit * (30 / effectiveDays) : 0;
            const daysOfSupply = dailySales > 0 ? qty / dailySales : null;

            let status: Status;
            if (dailySales <= 0) status = qty > 0 ? 'idle' : 'healthy';
            else if (daysOfSupply !== null && daysOfSupply <= 21) status = 'stockout';
            else if (daysOfSupply !== null && daysOfSupply <= 45) status = 'restock';
            else if (daysOfSupply !== null && daysOfSupply > 120) status = 'overstock';
            else status = 'healthy';

            const first = list[0];
            decisions.push({
                key,
                asin: first?.parent_asin || first?.asin || key,
                name: first?.product_name || key,
                manager: first?.manager || '未归属',
                country: (first?.country || '').trim() || '未归属',
                shop: (first?.shop_name || '').trim() || '未归属',
                brand: (first?.brand || '').trim() || '未归属',
                qty,
                cost,
                dailySales,
                daysOfSupply,
                oldQty,
                oldRatio: totalAge > 0 ? oldQty / totalAge : 0,
                monthlyGrossProfit: monthlyProfit,
                paybackMonths: monthlyProfit > 0 ? cost / monthlyProfit : null,
                status,
            });
        }

        decisions.sort((a, b) => b.cost - a.cost);
        return { decisions, windowDays: Math.max(distinctDays.size, 1) };
    }, [rows, salesRows]);

    const options = useMemo(() => ({
        countries: [...new Set(decisions.map(item => item.country))].sort(),
        shops: [...new Set(decisions.map(item => item.shop))].sort(),
        brands: [...new Set(decisions.map(item => item.brand))].sort(),
    }), [decisions]);

    const visible = useMemo(() => {
        let base = statusFilter === 'all' ? decisions : decisions.filter(item => item.status === statusFilter);
        if (countryFilter !== 'all') base = base.filter(item => item.country === countryFilter);
        if (shopFilter !== 'all') base = base.filter(item => item.shop === shopFilter);
        if (brandFilter !== 'all') base = base.filter(item => item.brand === brandFilter);
        const sorted = [...base];
        if (sortKey === 'cost') sorted.sort((a, b) => b.cost - a.cost);
        if (sortKey === 'days') sorted.sort((a, b) => (a.daysOfSupply ?? 99999) - (b.daysOfSupply ?? 99999));
        if (sortKey === 'payback') sorted.sort((a, b) => (b.paybackMonths ?? -1) - (a.paybackMonths ?? -1));
        return sorted.slice(0, 30);
    }, [decisions, statusFilter, sortKey, countryFilter, shopFilter, brandFilter]);

    const summary = useMemo(() => {
        const totalCost = decisions.reduce((sum, item) => sum + item.cost, 0);
        const byStatus = (status: Status) => decisions.filter(item => item.status === status);
        return {
            totalCost,
            stockout: byStatus('stockout').length,
            restock: byStatus('restock').length,
            overstock: byStatus('overstock').length,
            overstockValue: byStatus('overstock').reduce((sum, item) => sum + item.cost, 0),
            idle: byStatus('idle').length,
            idleValue: byStatus('idle').reduce((sum, item) => sum + item.cost, 0),
        };
    }, [decisions]);

    if (!decisions.length) return null;

    const cards = [
        { key: 'stockout' as Status, label: '断货风险', value: `${summary.stockout}`, note: '可售 ≤ 21 天', tone: 'text-rose-600', icon: PackageX },
        { key: 'restock' as Status, label: '需要补货', value: `${summary.restock}`, note: '可售 22~45 天', tone: 'text-amber-600', icon: AlertTriangle },
        { key: 'overstock' as Status, label: '积压清理', value: formatRMB(summary.overstockValue), note: `${summary.overstock} 个父体可售 > 120 天`, tone: 'text-violet-600', icon: TrendingDown },
        { key: 'all' as const, label: '占用资金', value: formatRMB(summary.totalCost), note: `无动销 ${summary.idle} 个 · ${formatRMB(summary.idleValue)}`, tone: 'text-slate-900', icon: Wallet },
    ];

    return (
        <section id="inventory-decision" className="rounded-3xl border border-white/80 bg-white shadow-[0_24px_70px_-42px_rgba(15,23,42,0.35)] ring-1 ring-slate-200/70">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
                <div>
                    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                        <Boxes className="h-4 w-4 text-sky-500" />
                        表格 4：库存决策
                        <span className="text-[11px] font-normal text-slate-400">按父体判断「补货 / 维持 / 清仓」，销量口径为近 {windowDays} 天</span>
                    </h2>
                </div>
                <div className="flex items-center gap-1 text-[11px]">
                    {(['all', ...STATUS_ORDER] as (Status | 'all')[]).map(value => (
                        <button
                            key={value}
                            type="button"
                            onClick={() => setStatusFilter(value)}
                            className={`rounded-lg px-2 py-1 font-medium transition ${statusFilter === value ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-800'}`}
                        >
                            {value === 'all' ? '全部' : STATUS_META[value].label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-2 gap-px border-b border-slate-100 bg-slate-100 lg:grid-cols-4">
                {cards.map(card => {
                    const Icon = card.icon;
                    return (
                        <button
                            key={card.label}
                            type="button"
                            onClick={() => setStatusFilter(card.key)}
                            className="flex items-start gap-3 bg-white px-4 py-3 text-left transition hover:bg-slate-50"
                        >
                            <Icon className={`mt-0.5 h-4 w-4 ${card.tone}`} />
                            <div>
                                <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400">{card.label}</div>
                                <div className={`mt-0.5 font-mono text-lg font-semibold tabular-nums ${card.tone}`}>{card.value}</div>
                                <div className="text-[10px] text-slate-400">{card.note}</div>
                            </div>
                        </button>
                    );
                })}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-b border-slate-100 px-5 py-2 text-[11px] text-slate-500">
                <select value={countryFilter} onChange={event => setCountryFilter(event.target.value)} className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600">
                    <option value="all">全部国家</option>
                    {options.countries.map(value => <option key={value} value={value}>{value}</option>)}
                </select>
                <select value={shopFilter} onChange={event => setShopFilter(event.target.value)} className="max-w-[160px] rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600">
                    <option value="all">全部店铺</option>
                    {options.shops.map(value => <option key={value} value={value}>{value}</option>)}
                </select>
                <select value={brandFilter} onChange={event => setBrandFilter(event.target.value)} className="max-w-[140px] rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600">
                    <option value="all">全部品牌</option>
                    {options.brands.map(value => <option key={value} value={value}>{value}</option>)}
                </select>
                <span className="text-slate-400">排序</span>
                {([['cost', '占用资金'], ['days', '可售天数'], ['payback', '回收月数']] as const).map(([value, label]) => (
                    <button
                        key={value}
                        type="button"
                        onClick={() => setSortKey(value)}
                        className={`rounded px-1.5 py-0.5 transition ${sortKey === value ? 'bg-slate-100 font-semibold text-slate-800' : 'hover:text-slate-700'}`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            <div className="custom-scroll overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                    <thead className="bg-slate-50/80 text-[11px] uppercase tracking-[0.12em] text-slate-500">
                        <tr>
                            <th className="px-4 py-2.5">父体 / 品名</th>
                            <th className="px-3 py-2.5">国家</th>
                            <th className="px-3 py-2.5">店铺</th>
                            <th className="px-3 py-2.5">品牌</th>
                            <th className="px-3 py-2.5">负责人</th>
                            <th className="px-3 py-2.5 text-right">库存量</th>
                            <th className="px-3 py-2.5 text-right">库存成本</th>
                            <th className="px-3 py-2.5 text-right">日均销量</th>
                            <th className="px-3 py-2.5 text-right">可售天数</th>
                            <th className="px-3 py-2.5 text-right">180天+ 占比</th>
                            <th className="px-3 py-2.5 text-right">回收月数</th>
                            <th className="px-3 py-2.5">状态</th>
                            <th className="px-3 py-2.5">建议</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {visible.map(item => {
                            const meta = STATUS_META[item.status];
                            const image = resolveProductImage(imageLookup, { asin: item.asin, productName: item.name });
                            return (
                                <tr
                                    key={item.key}
                                    onClick={() => onFocusParent?.(item.asin)}
                                    className="cursor-pointer transition hover:bg-sky-50/50"
                                >
                                    <td className="px-4 py-2">
                                        <div className="flex items-center gap-2">
                                            {image && <img src={image} alt="" loading="lazy" className="h-8 w-8 rounded object-cover" />}
                                            <div className="min-w-0">
                                                <div className="truncate font-mono text-[11px] text-slate-700">{item.asin}</div>
                                                <div className="max-w-[220px] truncate text-[11px] text-slate-400">{item.name}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-3 py-2 text-slate-600">{item.country}</td>
                                    <td className="max-w-[120px] truncate px-3 py-2 text-slate-600" title={item.shop}>{item.shop}</td>
                                    <td className="max-w-[100px] truncate px-3 py-2 text-slate-600" title={item.brand}>{item.brand}</td>
                                    <td className="px-3 py-2 text-slate-600">{item.manager}</td>
                                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-800">{formatNumber(item.qty)}</td>
                                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-600">{formatRMB(item.cost)}</td>
                                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-600">{item.dailySales.toFixed(1)}</td>
                                    <td className={`px-3 py-2 text-right font-mono tabular-nums font-semibold ${
                                        item.daysOfSupply !== null && item.daysOfSupply <= 21 ? 'text-rose-600'
                                            : item.daysOfSupply !== null && item.daysOfSupply > 120 ? 'text-violet-600'
                                                : 'text-slate-800'
                                    }`}>
                                        {item.daysOfSupply === null ? '—' : `${Math.round(item.daysOfSupply)} 天`}
                                    </td>
                                    <td className={`px-3 py-2 text-right font-mono tabular-nums ${item.oldRatio > 0.3 ? 'text-violet-600' : 'text-slate-600'}`}>
                                        {formatPercent(item.oldRatio)}
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-600">
                                        {item.paybackMonths === null ? '—' : `${item.paybackMonths.toFixed(1)} 月`}
                                    </td>
                                    <td className="px-3 py-2">
                                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${meta.chip}`}>{meta.label}</span>
                                    </td>
                                    <td className="px-3 py-2 text-slate-600">{meta.action}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-2 text-[10px] text-slate-400">
                <span>展示占用资金前 30 个父体 · 点击行可按该父体聚焦</span>
                <span className="inline-flex items-center gap-1"><ArrowDown className="h-3 w-3" />可售天数 = 库存 ÷ 近 {windowDays} 天日均销量</span>
            </div>
        </section>
    );
};

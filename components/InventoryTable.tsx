
import React, { useMemo } from 'react';
import { InventoryAggregated, InventoryRow } from '../types';
import { formatNumber, formatPercent, formatRMB } from '../utils';
import { Search, Clock } from 'lucide-react';

interface InventoryTableProps {
    data: InventoryAggregated | null;
    inventoryRows?: InventoryRow[];
    snapshotDate?: string;
    /** 数据时刻说明（来源 / 抓取频率） */
    snapshotNote?: string;
    onOpenDetail?: () => void;
}

const BUCKETS = [
    ['age_0_30', '0-30天'],
    ['age_31_60', '31-60天'],
    ['age_61_90', '61-90天'],
    ['age_91_180', '91-180天'],
    ['age_181_270', '181-270天'],
    ['age_271_330', '271-330天'],
    ['age_331_365', '331-365天'],
    ['age_365_plus', '365天+']
] as const;

export const InventoryTable: React.FC<InventoryTableProps> = ({ data, inventoryRows = [], snapshotDate, snapshotNote, onOpenDetail }) => {
    const inv = data;
    if (!inv) return null;

    const combinedQty = (inv.fba_total_qty || 0) + (inv.awd_total_qty || 0);
    /** 库龄各桶合计：为 0 说明还没接入库龄报表，界面上给出提示而不是显示一排 0 */
    const combinedAgeQty = BUCKETS.reduce((sum, [key]) => sum + ((inv[`${key}_qty` as keyof InventoryAggregated] as number) || 0), 0);

    /**
     * 库存构成：总库存 = 可售 + 预留 + 在途 + 不可售。
     * 库龄只统计「在库可售」那部分，所以它天然小于总库存——把构成摊开就不会让人以为对不上。
     */
    const breakdown = useMemo(() => {
        const rows = inventoryRows || [];
        const sum = (pick: (row: InventoryRow) => number) => rows.reduce((total, row) => total + (Number(pick(row)) || 0), 0);
        if (rows.length === 0) {
            return {
                sellable: inv.fba_sellable_qty || 0,
                reserved: 0,
                inbound: 0,
                unsellable: 0,
                total: inv.fba_total_qty || 0,
                age: combinedAgeQty,
            };
        }
        return {
            sellable: sum(row => row.fba_sellable_qty),
            reserved: sum(row => row.fba_reserved_qty),
            inbound: sum(row => row.fba_pending_qty + row.fba_transferring_qty),
            unsellable: sum(row => Number((row as unknown as Record<string, number>).fba_unsellable_qty) || 0),
            total: sum(row => row.fba_total_qty),
            age: combinedAgeQty,
        };
    }, [inventoryRows, inv, combinedAgeQty]);

    const breakdownTiles = [
        { label: '在库可售', value: breakdown.sellable, hint: '能被下单的部分' },
        { label: '预留中', value: breakdown.reserved, hint: '已下单待发货' },
        { label: '在途', value: breakdown.inbound, hint: '已发/收货中/处理中' },
        { label: '不可售', value: breakdown.unsellable, hint: '破损/调查' },
        { label: '库存合计', value: breakdown.total, hint: '以上四项之和' },
        { label: '库龄可覆盖', value: breakdown.age, hint: '仅统计在库部分' },
    ];

    const columns = useMemo(() => {
        const fbaQty = inv.fba_total_qty;
        const fbaCost = inv.fba_total_cost;
        return [
            {
                label: 'FBA 总计',
                qty: fbaQty,
                cost: fbaCost,
                qtyPercent: 1,
                costPercent: 1
            },
            ...BUCKETS.map(([key, label]) => {
                const qtyK = `${key}_qty` as keyof InventoryAggregated;
                const costK = `${key}_cost` as keyof InventoryAggregated;
                const qty = (inv[qtyK] as number) || 0;
                const cost = (inv[costK] as number) || 0;
                return {
                    label,
                    qty,
                    cost,
                    qtyPercent: fbaQty ? qty / fbaQty : 0,
                    costPercent: fbaCost ? cost / fbaCost : 0
                };
            }),
            {
                label: 'AWD',
                qty: inv.awd_total_qty,
                cost: inv.awd_total_cost,
                qtyPercent: combinedQty ? inv.awd_total_qty / combinedQty : 0,
                costPercent: fbaCost + inv.awd_total_cost > 0 ? inv.awd_total_cost / (fbaCost + inv.awd_total_cost) : 0
            }
        ];
    }, [inv, combinedQty]);

    return (
        <div className="overflow-hidden rounded-3xl border border-white/80 bg-white shadow-[0_24px_70px_-42px_rgba(15,23,42,0.45)] ring-1 ring-slate-200/70">
            <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 bg-[linear-gradient(135deg,#0f172a_0%,#172554_100%)] px-5 py-4 text-white">
                <div className="mt-1 flex flex-wrap items-center gap-3 text-sm font-bold tracking-[0.08em]">
                    <span>表格 3：FBA库存与库龄结构</span>
                    {snapshotDate && (
                        <div className="flex items-center gap-1.5 rounded-2xl border border-white/20 bg-white/10 px-2.5 py-1">
                            <Clock className="h-3.5 w-3.5 text-slate-300" />
                            <span className="font-mono text-xs font-semibold text-slate-200">{snapshotDate}</span>
                        </div>
                    )}
                    {inv.fba_total_qty > 0 && combinedAgeQty === 0 && (
                        <span className="rounded-full border border-amber-300/40 bg-amber-400/15 px-2 py-0.5 text-[10px] font-medium text-amber-200">
                            库龄结构待接入（当前为领星 FBA 库存明细）
                        </span>
                    )}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                    {onOpenDetail && (
                        <button
                            type="button"
                            onClick={onOpenDetail}
                            className="inline-flex items-center gap-1.5 rounded-2xl bg-sky-500 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-sky-500/20 transition-colors hover:bg-sky-400"
                        >
                            <Search className="h-3.5 w-3.5" />
                            详细数据
                        </button>
                    )}
                </div>
            </div>
            <div className="border-b border-slate-100 bg-white px-5 py-2 text-[11px] text-slate-400">
                数据时刻：{snapshotDate || '—'} · {snapshotNote || '领星 FBA 库存快照，每天 09:00 自动抓取一次'}
            </div>
            <div className="grid grid-cols-2 gap-px border-b border-slate-100 bg-slate-100 sm:grid-cols-3 lg:grid-cols-6">
                {breakdownTiles.map(tile => (
                    <div key={tile.label} className="bg-white px-4 py-3">
                        <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400">{tile.label}</div>
                        <div className="mt-1 font-mono text-base font-semibold tabular-nums text-slate-900">{formatNumber(tile.value)}</div>
                        <div className="text-[10px] text-slate-400">{tile.hint}</div>
                    </div>
                ))}
            </div>
            <div className="custom-scroll overflow-x-auto">
                <table className="min-w-max text-left text-sm">
                    <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/80">
                            {columns.map((col, idx) => (
                                <th
                                    key={idx}
                                    className={`min-w-[168px] border-r border-slate-100 px-4 py-3.5 text-right text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 last:border-0 ${idx === 0 ? 'sticky left-0 z-10 bg-slate-50' : ''}`}
                                >
                                    {col.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        <tr className="bg-white">
                            {columns.map((col, idx) => (
                                <td key={idx} className={`border-r border-slate-100 px-4 py-4 align-top text-right last:border-0 even:bg-slate-50/35 ${idx === 0 ? 'sticky left-0 z-10 bg-white' : ''}`}>
                                    <div className="font-mono text-lg font-bold tracking-tight text-slate-900">{formatNumber(col.qty)}</div>
                                    <div className="mb-2 font-mono text-xs text-slate-500">{formatRMB(col.cost)}</div>
                                    {idx > 0 && (
                                        <div className="flex flex-col items-end gap-1">
                                            <div className="flex gap-1 text-[10px] text-slate-500">
                                                <span>数量占比:</span>
                                                <span className={col.qtyPercent > 0.2 && idx > 4 ? 'font-bold text-red-600' : 'text-slate-700'}>
                                                    {formatPercent(col.qtyPercent)}
                                                </span>
                                            </div>
                                            <div className="flex gap-1 text-[10px] text-slate-500">
                                                <span>成本占比:</span>
                                                <span className={col.costPercent > 0.2 && idx > 4 ? 'font-bold text-red-600' : 'text-slate-700'}>
                                                    {formatPercent(col.costPercent)}
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                </td>
                            ))}
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    );
};

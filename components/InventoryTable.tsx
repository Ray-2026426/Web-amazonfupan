
import React, { useMemo } from 'react';
import { InventoryAggregated, InventoryRow } from '../types';
import { formatNumber, formatPercent, formatRMB } from '../utils';
import { Search, Clock } from 'lucide-react';

interface InventoryTableProps {
    data: InventoryAggregated | null;
    inventoryRows?: InventoryRow[];
    snapshotDate?: string;
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

export const InventoryTable: React.FC<InventoryTableProps> = ({ data, inventoryRows: _inventoryRows = [], snapshotDate, onOpenDetail }) => {
    const inv = data;
    if (!inv) return null;

    const combinedQty = (inv.fba_total_qty || 0) + (inv.awd_total_qty || 0);

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
        <div className="overflow-hidden rounded-3xl border border-white/80 bg-white shadow-[0_24px_60px_-35px_rgba(15,23,42,0.35)] ring-1 ring-slate-200/70">
            <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 bg-[linear-gradient(135deg,#0f172a_0%,#172554_100%)] px-5 py-4 text-white">
                <div className="mt-1 flex flex-wrap items-center gap-3 text-sm font-bold tracking-[0.08em]">
                    <span>表格 3：FBA库存与库龄结构</span>
                    {snapshotDate && (
                        <div className="flex items-center gap-1.5 rounded-2xl border border-white/20 bg-white/10 px-2.5 py-1">
                            <Clock className="h-3.5 w-3.5 text-slate-300" />
                            <span className="font-mono text-xs font-semibold text-slate-200">{snapshotDate}</span>
                        </div>
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
            <div className="custom-scroll overflow-x-auto">
                <table className="min-w-max text-left text-sm">
                    <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/80">
                            {columns.map((col, idx) => (
                                <th
                                    key={idx}
                                    className="min-w-[168px] border-r border-slate-100 px-4 py-3.5 text-right text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 last:border-0"
                                >
                                    {col.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        <tr className="bg-white">
                            {columns.map((col, idx) => (
                                <td key={idx} className="border-r border-slate-100 px-4 py-4 align-top text-right last:border-0 even:bg-slate-50/35">
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

import React, { useMemo } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { AggregatedData } from '../types';
import { formatMoneyNoDecimals, formatNumber, formatPercent } from '../utils';
import { DataTable, type DataTableColumn } from './DataTable';

export type MetricFormat = 'money' | 'number' | 'percent' | 'ratio';

export type MetricRow = {
    key: string;
    label: string;
    /** 悬浮说明 */
    hint?: string;
    format: MetricFormat;
    /** 从聚合结果取值 */
    value: (agg: AggregatedData) => number;
    /** 目标值（只有四个核心指标有） */
    target?: (target: AggregatedData) => number;
    /** 成本类指标：涨了是坏事（颜色反转） */
    inverse?: boolean;
    /** 分组标题，用于视觉分隔 */
    group?: string;
};

const formatterOf = (format: MetricFormat) => {
    if (format === 'money') return formatMoneyNoDecimals;
    if (format === 'percent' || format === 'ratio') return formatPercent;
    return formatNumber;
};

const changeOf = (current: number, base: number | null | undefined): number | null => {
    if (base === null || base === undefined || !Number.isFinite(base) || base === 0) return null;
    return (current - base) / Math.abs(base);
};

/** 变化单元格：箭头 + 百分比，成本类指标涨=红、降=绿 */
const ChangeCell: React.FC<{ value: number | null; inverse?: boolean }> = ({ value, inverse }) => {
    if (value === null) return <span className="text-slate-300">—</span>;
    const positive = value >= 0;
    const good = inverse ? !positive : positive;
    const Icon = Math.abs(value) < 0.0005 ? Minus : positive ? ArrowUpRight : ArrowDownRight;
    return (
        <span className={`inline-flex items-center gap-0.5 font-mono text-[11px] ${Math.abs(value) < 0.0005 ? 'text-slate-400' : good ? 'text-emerald-600' : 'text-rose-600'}`}>
            <Icon className="h-3 w-3" />
            {(Math.abs(value) * 100).toFixed(1)}%
        </span>
    );
};

/**
 * 指标对比表：行是指标，列是 本期 / 环比 / 同比 / 目标 / 达成。
 * 取代原来「一大堆宽表 + 每格一行小字」的排版，一屏能读完，还能点表头排序。
 */
export const MetricCompareTable: React.FC<{
    title: string;
    rows: MetricRow[];
    current: AggregatedData;
    last: AggregatedData | null;
    year: AggregatedData | null;
    target?: AggregatedData | null;
    onOpenDetail?: () => void;
    footer?: React.ReactNode;
}> = ({ title, rows, current, last, year, target, onOpenDetail, footer }) => {
    const columns = useMemo<DataTableColumn<MetricRow>[]>(() => {
        const format = (row: MetricRow, agg: AggregatedData | null) => (agg ? formatterOf(row.format)(row.value(agg)) : '—');

        return [
            {
                key: 'label',
                title: '指标',
                width: '26%',
                render: row => (
                    <span className="flex items-center gap-1.5">
                        <span className="text-[12px] text-slate-700">{row.label}</span>
                        {row.hint && (
                            <span className="cursor-help text-[10px] text-slate-300" title={row.hint}>?</span>
                        )}
                    </span>
                ),
                sortValue: row => row.key,
            },
            {
                key: 'current',
                title: '本期',
                align: 'right',
                render: row => <span className="text-[13px] font-semibold text-slate-900">{format(row, current)}</span>,
                sortValue: row => row.value(current),
            },
            {
                key: 'mom',
                title: '环比',
                align: 'right',
                render: row => <ChangeCell value={changeOf(row.value(current), last ? row.value(last) : null)} inverse={row.inverse} />,
            },
            {
                key: 'yoy',
                title: '同比',
                align: 'right',
                render: row => <ChangeCell value={changeOf(row.value(current), year ? row.value(year) : null)} inverse={row.inverse} />,
            },
            {
                key: 'target',
                title: '目标',
                align: 'right',
                render: row => {
                    const goal = row.target && target ? row.target(target) : undefined;
                    return <span className="font-mono text-[11px] text-slate-400">{goal === undefined || goal === 0 ? '—' : formatterOf(row.format)(goal)}</span>;
                },
            },
            {
                key: 'attainment',
                title: '达成',
                align: 'right',
                render: row => {
                    const goal = row.target && target ? row.target(target) : undefined;
                    if (!goal) return <span className="text-slate-300">—</span>;
                    const ratio = row.value(current) / goal;
                    const good = row.inverse ? ratio <= 1 : ratio >= 1;
                    return (
                        <span className={`font-mono text-[11px] font-semibold ${good ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {(ratio * 100).toFixed(0)}%
                        </span>
                    );
                },
                sortValue: row => (row.target && target && row.target(target) ? row.value(current) / row.target(target)! : 0),
            },
        ];
    }, [current, last, year, target]);

    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-slate-800">{title}</h2>
                {onOpenDetail && (
                    <button
                        type="button"
                        onClick={onOpenDetail}
                        className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
                    >
                        查看明细 ›
                    </button>
                )}
            </div>
            <DataTable<MetricRow> rows={rows} columns={columns} rowKey={row => row.key} />
            {footer}
        </section>
    );
};

/** 利润表指标（顺序与原表一致） */
export const PL_METRICS: MetricRow[] = [
    { key: 'sales_quantity', label: '销量', format: 'number', value: agg => agg.sales_quantity, target: t => t.sales_quantity, group: '规模' },
    { key: 'sales_amount', label: '销售额', format: 'money', value: agg => agg.sales_amount, target: t => t.sales_amount, group: '规模' },
    { key: 'gross_profit', label: '毛利额', format: 'money', value: agg => agg.gross_profit, target: t => t.gross_profit, group: '规模' },
    { key: 'gross_margin', label: '毛利率', hint: '毛利额 ÷ 销售额', format: 'percent', value: agg => agg.gross_margin, target: t => (t.sales_amount > 0 ? t.gross_profit / t.sales_amount : 0), group: '规模' },
    { key: 'asp', label: '客单均价', hint: '销售额 ÷ 销量', format: 'money', value: agg => (agg.sales_quantity > 0 ? agg.sales_amount / agg.sales_quantity : 0), group: '规模' },
    { key: 'fba_sellable_qty', label: 'FBA 可售', hint: '区间最后一天快照', format: 'number', value: agg => agg.fba_sellable_qty, group: '规模' },
    { key: 'refund_ratio', label: '退款占比', format: 'percent', value: agg => (agg.sales_amount > 0 ? agg.refund_cost / agg.sales_amount : 0), inverse: true, group: '成本结构' },
    { key: 'first_mile_ratio', label: '头程占比', format: 'percent', value: agg => (agg.sales_amount > 0 ? agg.first_mile_cost / agg.sales_amount : 0), inverse: true, group: '成本结构' },
    { key: 'procurement_ratio', label: '采购占比', format: 'percent', value: agg => (agg.sales_amount > 0 ? agg.procurement_cost / agg.sales_amount : 0), inverse: true, group: '成本结构' },
    { key: 'storage_ratio', label: '仓储占比', format: 'percent', value: agg => (agg.sales_amount > 0 ? agg.storage_fee / agg.sales_amount : 0), inverse: true, group: '成本结构' },
    { key: 'fba_ratio', label: 'FBA 费占比', format: 'percent', value: agg => (agg.sales_amount > 0 ? agg.fba_fee / agg.sales_amount : 0), inverse: true, group: '成本结构' },
    { key: 'commission_ratio', label: '佣金占比', format: 'percent', value: agg => (agg.sales_amount > 0 ? agg.platform_commission / agg.sales_amount : 0), inverse: true, group: '成本结构' },
    { key: 'ad_share', label: '广告占比', hint: '广告花费 ÷ 销售额（TACOS）', format: 'percent', value: agg => (agg.sales_amount > 0 ? agg.ad_spend / agg.sales_amount : 0), inverse: true, group: '成本结构' },
];

/** 流量与广告指标 */
export const TRAFFIC_METRICS: MetricRow[] = [
    { key: 'ad_spend', label: '广告花费', format: 'money', value: agg => agg.ad_spend, target: t => t.ad_spend, inverse: true, group: '广告规模' },
    { key: 'ad_sales', label: '广告销售额', format: 'money', value: agg => agg.ad_sales, group: '广告规模' },
    { key: 'sp_spend', label: 'SP 花费', format: 'money', value: agg => agg.sp_spend, inverse: true, group: '广告规模' },
    { key: 'sp_sales', label: 'SP 销售额', format: 'money', value: agg => agg.sp_sales, group: '广告规模' },
    { key: 'sd_spend', label: 'SD 花费', format: 'money', value: agg => agg.sd_spend, inverse: true, group: '广告规模' },
    { key: 'sd_sales', label: 'SD 销售额', format: 'money', value: agg => agg.sd_sales, group: '广告规模' },
    { key: 'sb_spend', label: 'SB 花费', format: 'money', value: agg => agg.sb_spend, inverse: true, group: '广告规模' },
    { key: 'sb_sales', label: 'SB 销售额', format: 'money', value: agg => agg.sb_sales, group: '广告规模' },
    { key: 'sbv_spend', label: 'SBV 花费', format: 'money', value: agg => agg.sbv_spend, inverse: true, group: '广告规模' },
    { key: 'sbv_sales', label: 'SBV 销售额', format: 'money', value: agg => agg.sbv_sales, group: '广告规模' },
    { key: 'impressions', label: '展示量', format: 'number', value: agg => agg.impressions, group: '流量' },
    { key: 'clicks', label: '点击', format: 'number', value: agg => agg.clicks, group: '流量' },
    { key: 'ctr', label: 'CTR', hint: '点击 ÷ 展示量', format: 'percent', value: agg => (agg.impressions > 0 ? agg.clicks / agg.impressions : 0), group: '流量' },
    { key: 'ad_cvr', label: '广告 CVR', hint: '广告订单 ÷ 点击', format: 'percent', value: agg => (agg.clicks > 0 ? agg.ad_orders / agg.clicks : 0), group: '流量' },
    { key: 'natural_cvr', label: '自然 CVR', format: 'percent', value: agg => (agg.natural_clicks > 0 ? agg.natural_orders / agg.natural_clicks : 0), group: '流量' },
    { key: 'cpc', label: 'CPC', hint: '广告花费 ÷ 点击', format: 'money', value: agg => (agg.clicks > 0 ? agg.ad_spend / agg.clicks : 0), inverse: true, group: '效率' },
    { key: 'acos', label: 'ACoS', hint: '广告花费 ÷ 广告销售额', format: 'percent', value: agg => (agg.ad_sales > 0 ? agg.ad_spend / agg.ad_sales : 0), inverse: true, group: '效率' },
    { key: 'asoas', label: 'ASOAS', hint: '广告订单占比', format: 'percent', value: agg => (agg.ad_orders + agg.natural_orders > 0 ? agg.ad_orders / (agg.ad_orders + agg.natural_orders) : 0), group: '效率' },
];

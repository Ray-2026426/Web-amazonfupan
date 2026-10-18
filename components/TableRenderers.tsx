
import React, { useState } from 'react';
import { AggregatedData } from '../types';
import { formatNumber, formatPercent, formatPrice, formatMoneyNoDecimals } from '../utils';
import { Search, Calculator, FileSearch, MessageSquare, Target } from 'lucide-react';
import { METRICS, metricValue } from '../utils/metrics';

interface TableProps {
  current: AggregatedData;
  last: AggregatedData | null;
  year: AggregatedData | null;
  target: AggregatedData;
  onOpenDetail?: () => void;
  onOpenCalculator?: () => void;
  onOpenRefundAnalysis?: () => void;
  onOpenReviewAnalysis?: () => void;
  onOpenKeywordAnalysis?: () => void; // New Prop
}

// Helper to render the small comparison lines
const ComparisonLine = ({ 
    label, 
    current, 
    baseline, 
    formatter,
    type
}: { 
    label: string, 
    current: number, 
    baseline: number | undefined, 
    formatter: (v: number) => string,
    type: 'percent' | 'absolute_val' | 'absolute_percent'
}) => {
    if (baseline === undefined || baseline === null) return null;

    // 「基期为 0」语义化展示：
    //  - 当前期 > 0：标记为「New」（从无到有，新增业务）
    //  - 当前期 = 0：标记为「—」（两期都为 0，不可比）
    //  - 仅 percent 类型才会涉及除以基期，absolute_val / absolute_percent 仍按差值显示
    const isRelative = type === 'percent';
    if (isRelative && baseline === 0) {
        const tone = current > 0
            ? 'text-emerald-600 bg-emerald-500/10 border-emerald-200'
            : 'text-slate-400 bg-slate-100 border-slate-200';
        const label2 = current > 0 ? 'New' : '—';
        return (
            <div className="mt-1.5 flex items-center justify-end gap-1.5 whitespace-nowrap text-[10px] font-mono text-slate-400">
                <span className="uppercase tracking-[0.2em] opacity-70">{label}</span>
                <span>{formatter(baseline)}</span>
                <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 font-semibold ${tone}`}>{label2}</span>
            </div>
        );
    }

    const pct = type === 'absolute_percent' || type === 'absolute_val'
        ? (current - baseline)
        : ((current - baseline) / baseline);

    const isPositive = pct > 0;
    const isZero = pct === 0;
    
    const tone = isPositive
        ? 'text-emerald-600 bg-emerald-500/10 border-emerald-200'
        : isZero
            ? 'text-slate-400 bg-slate-100 border-slate-200'
            : 'text-rose-600 bg-rose-500/10 border-rose-200';
    const sign = isPositive ? '+' : '';
    const pctStr = type === 'absolute_val' ? formatter(pct) : (pct * 100).toFixed(2) + '%';

    return (
        <div className="mt-1.5 flex items-center justify-end gap-1.5 whitespace-nowrap text-[10px] font-mono text-slate-400">
            <span className="uppercase tracking-[0.2em] opacity-70">{label}</span>
            <span>{formatter(baseline)}</span>
            <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 font-semibold ${tone}`}>{sign}{pctStr}</span>
        </div>
    );
};

// Transposed Table Component
const TransposedTable = ({ 
    title, 
    columns,
    onOpenDetail,
    customAction
}: { 
    title: string, 
    columns: { 
        header: string | React.ReactNode, 
        current: number | string, 
        last?: { val: number | undefined, diffType: 'percent' | 'absolute_val' | 'absolute_percent' },
        year?: { val: number | undefined, diffType: 'percent' | 'absolute_val' | 'absolute_percent' },
        formatter: (v: number) => string 
    }[],
    onOpenDetail?: () => void,
    customAction?: React.ReactNode // New prop for custom header buttons
}) => {
    const [hiddenColumns, setHiddenColumns] = useState<Set<number>>(() => new Set());
    const [showColumns, setShowColumns] = useState(false);
    const visibleColumns = columns.map((col, index) => ({col, index})).filter(({index}) => !hiddenColumns.has(index));
    const columnName = (node: React.ReactNode, fallback: string): string => {
        if (typeof node === 'string' || typeof node === 'number') return String(node);
        if (Array.isArray(node)) return node.map(child => columnName(child, '')).join(' ').trim() || fallback;
        if (React.isValidElement<{children?: React.ReactNode}>(node)) return columnName(node.props.children, fallback);
        return fallback;
    };
    return (
        <div className="overflow-hidden rounded-3xl border border-white/80 bg-white shadow-[0_24px_70px_-42px_rgba(15,23,42,0.45)] ring-1 ring-slate-200/70">
            <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 bg-[linear-gradient(135deg,#0f172a_0%,#172554_100%)] px-5 py-4 text-white">
                <div>
                    <div className="mt-1 text-sm font-bold tracking-[0.08em]">{title}</div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                    <button type="button" onClick={() => setShowColumns(v => !v)} className="rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white">显示列</button>
                    {customAction}
                    {onOpenDetail && (
                        <button 
                            onClick={onOpenDetail}
                            className="inline-flex items-center gap-1.5 rounded-2xl bg-sky-500 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-sky-500/20 transition-colors hover:bg-sky-400"
                        >
                            <Search className="w-3.5 h-3.5" />
                            详细数据
                        </button>
                    )}
                </div>
            </div>
            {showColumns && <div className="flex flex-wrap gap-2 border-b border-slate-200 bg-slate-50 p-3 text-xs">{columns.map((col, index) => <label key={index} className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1"><input type="checkbox" checked={!hiddenColumns.has(index)} disabled={!hiddenColumns.has(index) && visibleColumns.length === 1} onChange={() => setHiddenColumns(prev => { const next = new Set(prev); if (next.has(index)) next.delete(index); else next.add(index); return next; })} />{columnName(col.header, `指标 ${index + 1}`)}</label>)}</div>}
            <div className="overflow-x-auto custom-scroll">
                <table className="min-w-max text-sm text-left">
                    <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/80">
                            {visibleColumns.map(({col, index}, displayIndex) => (
                                <th key={index} className={`min-w-[168px] border-r border-slate-100 px-4 py-3.5 text-right text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 last:border-0 ${displayIndex === 0 ? 'sticky left-0 z-10 bg-slate-50' : ''}`}>
                                    {col.header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        <tr className="bg-white">
                            {visibleColumns.map(({col, index}, displayIndex) => (
                                <td key={index} className={`border-r border-slate-100 px-4 py-4 text-right align-top last:border-0 even:bg-slate-50/35 ${displayIndex === 0 ? 'sticky left-0 z-10 bg-white' : ''}`}>
                                    <div className="text-lg font-bold text-slate-900 font-mono tracking-tight">
                                        {typeof col.current === 'number' ? col.formatter(col.current) : col.current}
                                    </div>
                                    {typeof col.current === 'number' && col.last && (
                                        <ComparisonLine 
                                            label="环比" 
                                            current={col.current} 
                                            baseline={col.last.val} 
                                            formatter={col.formatter}
                                            type={col.last.diffType}
                                        />
                                    )}
                                    {typeof col.current === 'number' && col.year && (
                                        <ComparisonLine 
                                            label="同比" 
                                            current={col.current} 
                                            baseline={col.year.val} 
                                            formatter={col.formatter}
                                            type={col.year.diffType}
                                        />
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

export const PLTable: React.FC<TableProps> = ({ current, last, year, onOpenDetail, onOpenCalculator, onOpenRefundAnalysis, onOpenReviewAnalysis }) => {
    
    const getVal = (obj: AggregatedData | null, key: keyof AggregatedData): number | undefined => {
        return obj ? obj[key] : undefined;
    };

    const getRatio = (obj: AggregatedData | null, numKey: keyof AggregatedData, denKey: keyof AggregatedData): number | undefined => {
        if (!obj) return undefined;
        return obj[denKey] ? obj[numKey] / obj[denKey] : 0;
    };

    const columns = [
        { 
            header: "销量", 
            current: current.sales_quantity, 
            last: { val: getVal(last, 'sales_quantity'), diffType: 'percent' as const },
            year: { val: getVal(year, 'sales_quantity'), diffType: 'percent' as const },
            formatter: formatNumber 
        },
        { 
            header: "销售额", 
            current: current.sales_amount, 
            last: { val: getVal(last, 'sales_amount'), diffType: 'percent' as const },
            year: { val: getVal(year, 'sales_amount'), diffType: 'percent' as const },
            formatter: formatMoneyNoDecimals 
        },
        { 
            header: "毛利额", 
            current: current.gross_profit, 
            last: { val: getVal(last, 'gross_profit'), diffType: 'percent' as const },
            year: { val: getVal(year, 'gross_profit'), diffType: 'percent' as const },
            formatter: formatMoneyNoDecimals 
        },
        { 
            header: (
                <div className="flex items-center justify-end gap-1">
                    毛利率
                    {onOpenCalculator && (
                        <button 
                            onClick={onOpenCalculator} 
                            className="rounded-xl p-1.5 text-sky-600 transition-colors hover:bg-sky-100"
                            title="利润模型试算"
                        >
                            <Calculator className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            ), 
            current: current.gross_margin, 
            last: { val: getVal(last, 'gross_margin'), diffType: 'absolute_percent' as const },
            year: { val: getVal(year, 'gross_margin'), diffType: 'absolute_percent' as const },
            formatter: formatPercent 
        },
        { 
            header: "FBA可售", 
            current: current.fba_sellable_qty,
            last: { val: getVal(last, 'fba_sellable_qty'), diffType: 'percent' as const },
            year: { val: getVal(year, 'fba_sellable_qty'), diffType: 'percent' as const }, 
            formatter: formatNumber 
        },
        { 
            header: "客单均价", 
            current: current.avg_ticket, 
            last: { val: getVal(last, 'avg_ticket'), diffType: 'percent' as const },
            year: { val: getVal(year, 'avg_ticket'), diffType: 'percent' as const },
            formatter: formatPrice 
        },
        { 
            header: (
                <div className="flex items-center justify-end gap-1 group/header">
                    平均评分
                    {onOpenReviewAnalysis && (
                        <button 
                            onClick={(e) => { e.stopPropagation(); onOpenReviewAnalysis(); }}
                            className="rounded-xl p-1.5 text-sky-600 transition-colors hover:bg-sky-100"
                            title="深入分析评论舆情"
                        >
                            <MessageSquare className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            ),
            current: current.average_rating, 
            last: { val: getVal(last, 'average_rating'), diffType: 'absolute_val' as const },
            year: { val: getVal(year, 'average_rating'), diffType: 'absolute_val' as const },
            formatter: (v: number) => v.toFixed(2)
        },
    ];

    const costColumns = [
        {
            header: "头程占比",
            current: current.sales_amount ? current.first_mile_cost / current.sales_amount : 0,
            last: { val: getRatio(last, 'first_mile_cost', 'sales_amount'), diffType: 'absolute_percent' as const },
            year: { val: getRatio(year, 'first_mile_cost', 'sales_amount'), diffType: 'absolute_percent' as const },
            formatter: formatPercent
        },
        {
            header: "采购占比",
            current: current.sales_amount ? current.procurement_cost / current.sales_amount : 0,
            last: { val: getRatio(last, 'procurement_cost', 'sales_amount'), diffType: 'absolute_percent' as const },
            year: { val: getRatio(year, 'procurement_cost', 'sales_amount'), diffType: 'absolute_percent' as const },
            formatter: formatPercent
        },
        {
            header: "仓储占比",
            current: current.sales_amount ? current.storage_fee / current.sales_amount : 0,
            last: { val: getRatio(last, 'storage_fee', 'sales_amount'), diffType: 'absolute_percent' as const },
            year: { val: getRatio(year, 'storage_fee', 'sales_amount'), diffType: 'absolute_percent' as const },
            formatter: formatPercent
        },
        {
            header: "FBA费占比",
            current: current.sales_amount ? current.fba_fee / current.sales_amount : 0,
            last: { val: getRatio(last, 'fba_fee', 'sales_amount'), diffType: 'absolute_percent' as const },
            year: { val: getRatio(year, 'fba_fee', 'sales_amount'), diffType: 'absolute_percent' as const },
            formatter: formatPercent
        },
        {
            header: (
                <div className="flex items-center justify-end gap-1">
                    退款占比
                    {onOpenRefundAnalysis && (
                        <button 
                            onClick={(e) => { e.stopPropagation(); onOpenRefundAnalysis(); }}
                            className="rounded-xl p-1.5 text-sky-600 transition-colors hover:bg-sky-100"
                            title="深入分析退款原因"
                        >
                            <FileSearch className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            ),
            current: metricValue('refund_rate', {current}) ?? 0,
            last: { val: getRatio(last, 'refund_cost', 'sales_amount'), diffType: 'absolute_percent' as const },
            year: { val: getRatio(year, 'refund_cost', 'sales_amount'), diffType: 'absolute_percent' as const },
            formatter: formatPercent
        },
        {
            header: "佣金占比",
            current: current.sales_amount ? current.platform_commission / current.sales_amount : 0,
            last: { val: getRatio(last, 'platform_commission', 'sales_amount'), diffType: 'absolute_percent' as const },
            year: { val: getRatio(year, 'platform_commission', 'sales_amount'), diffType: 'absolute_percent' as const },
            formatter: formatPercent
        },
        {
            header: <span title={METRICS.ad_share.definition}>广告占比 ⓘ</span>,
            current: metricValue('ad_share', {current}) ?? 0,
            last: { val: last ? metricValue('ad_share', {current: last}) ?? undefined : undefined, diffType: 'absolute_percent' as const },
            year: { val: year ? metricValue('ad_share', {current: year}) ?? undefined : undefined, diffType: 'absolute_percent' as const },
            formatter: formatPercent
        },
    ];

    const allColumns = [...columns, ...costColumns];

    return <TransposedTable title="表格 1：P&L 核心业绩" columns={allColumns} onOpenDetail={onOpenDetail} />;
};

export const TrafficTable: React.FC<TableProps> = ({ current, last, year, onOpenDetail, onOpenKeywordAnalysis }) => {
    
    const getVal = (obj: AggregatedData | null, key: keyof AggregatedData): number | undefined => {
        return obj ? obj[key] : undefined;
    };

    const safeCalc = (obj: AggregatedData | null, fn: (o: AggregatedData) => number): number | undefined => {
        return obj ? fn(obj) : undefined;
    }
    
    const getNaturalCVR = (d: AggregatedData) => {
        if (!d.natural_clicks || d.natural_clicks === 0) return 0;
        return d.natural_orders / d.natural_clicks;
    };

    const columns = [
        { 
            header: "广告花费", 
            current: current.ad_spend, 
            last: { val: getVal(last, 'ad_spend'), diffType: 'percent' as const }, 
            year: { val: getVal(year, 'ad_spend'), diffType: 'percent' as const }, 
            formatter: formatMoneyNoDecimals 
        },
        { header: "广告销售额", current: current.ad_sales, last: { val: getVal(last, 'ad_sales'), diffType: 'percent' as const }, year: { val: getVal(year, 'ad_sales'), diffType: 'percent' as const }, formatter: formatMoneyNoDecimals },
        
        { header: "SP花费", current: current.sp_spend, last: { val: getVal(last, 'sp_spend'), diffType: 'percent' as const }, year: { val: getVal(year, 'sp_spend'), diffType: 'percent' as const }, formatter: formatMoneyNoDecimals 
        },
        { header: "SP销售额", current: current.sp_sales, last: { val: getVal(last, 'sp_sales'), diffType: 'percent' as const }, year: { val: getVal(year, 'sp_sales'), diffType: 'percent' as const }, formatter: formatMoneyNoDecimals },
        
        { header: "SD花费", current: current.sd_spend, last: { val: getVal(last, 'sd_spend'), diffType: 'percent' as const }, year: { val: getVal(year, 'sd_spend'), diffType: 'percent' as const }, formatter: formatMoneyNoDecimals 
        },
        { header: "SD销售额", current: current.sd_sales, last: { val: getVal(last, 'sd_sales'), diffType: 'percent' as const }, year: { val: getVal(year, 'sd_sales'), diffType: 'percent' as const }, formatter: formatMoneyNoDecimals },
        
        { header: "SB花费", current: current.sb_spend, last: { val: getVal(last, 'sb_spend'), diffType: 'percent' as const }, year: { val: getVal(year, 'sb_spend'), diffType: 'percent' as const }, formatter: formatMoneyNoDecimals 
        },
        { header: "SB销售额", current: current.sb_sales, last: { val: getVal(last, 'sb_sales'), diffType: 'percent' as const }, year: { val: getVal(year, 'sb_sales'), diffType: 'percent' as const }, formatter: formatMoneyNoDecimals },
        
        { header: "SBV花费", current: current.sbv_spend, last: { val: getVal(last, 'sbv_spend'), diffType: 'percent' as const }, year: { val: getVal(year, 'sbv_spend'), diffType: 'percent' as const }, formatter: formatMoneyNoDecimals 
        },
        { header: "SBV销售额", current: current.sbv_sales, last: { val: getVal(last, 'sbv_sales'), diffType: 'percent' as const }, year: { val: getVal(year, 'sbv_sales'), diffType: 'percent' as const }, formatter: formatMoneyNoDecimals },
        
        { header: "展示量", current: current.impressions, last: { val: getVal(last, 'impressions'), diffType: 'percent' as const }, year: { val: getVal(year, 'impressions'), diffType: 'percent' as const }, formatter: formatNumber },
        { header: "点击", current: current.clicks, last: { val: getVal(last, 'clicks'), diffType: 'percent' as const }, year: { val: getVal(year, 'clicks'), diffType: 'percent' as const }, formatter: formatNumber },
        
        { 
            header: "广告CVR", 
            current: current.clicks ? current.ad_orders / current.clicks : 0,
            last: { val: safeCalc(last, l => l.clicks ? l.ad_orders / l.clicks : 0), diffType: 'absolute_percent' as const },
            year: { val: safeCalc(year, y => y.clicks ? y.ad_orders / y.clicks : 0), diffType: 'absolute_percent' as const },
            formatter: formatPercent
        },
        { 
            header: "CTR", 
            current: current.impressions ? current.clicks / current.impressions : 0,
            last: { val: safeCalc(last, l => l.impressions ? l.clicks / l.impressions : 0), diffType: 'absolute_percent' as const },
            year: { val: safeCalc(year, y => y.impressions ? y.clicks / y.impressions : 0), diffType: 'absolute_percent' as const },
            formatter: formatPercent
        },
        { 
            header: "自然CVR", 
            current: getNaturalCVR(current),
            last: { 
                val: safeCalc(last, getNaturalCVR), 
                diffType: 'absolute_percent' as const 
            },
            year: { 
                val: safeCalc(year, getNaturalCVR), 
                diffType: 'absolute_percent' as const 
            },
            formatter: formatPercent
        },
        { 
            header: "CPC", 
            current: current.clicks ? current.ad_spend / current.clicks : 0,
            last: { val: safeCalc(last, l => l.clicks ? l.ad_spend / l.clicks : 0), diffType: 'absolute_val' as const },
            year: { val: safeCalc(year, y => y.clicks ? y.ad_spend / y.clicks : 0), diffType: 'absolute_val' as const },
            formatter: (v) => `$${v.toFixed(2)}`
        },
        // New: ACoS (Spend / Ad Sales)
        { 
            header: <span title={METRICS.acos.definition}>ACoS ⓘ</span>, 
            current: metricValue('acos', {current}) ?? 0,
            last: { val: last ? metricValue('acos', {current: last}) ?? undefined : undefined, diffType: 'absolute_percent' as const },
            year: { val: year ? metricValue('acos', {current: year}) ?? undefined : undefined, diffType: 'absolute_percent' as const },
            formatter: formatPercent
        },
        // Changed: ASoAS (Ad Orders / Total Orders)
        { 
            header: "ASOAS (广告订单占比)", 
            current: current.sales_quantity ? current.ad_orders / current.sales_quantity : 0,
            last: { val: safeCalc(last, l => l.sales_quantity ? l.ad_orders / l.sales_quantity : 0), diffType: 'absolute_percent' as const },
            year: { val: safeCalc(year, y => y.sales_quantity ? y.ad_orders / y.sales_quantity : 0), diffType: 'absolute_percent' as const },
            formatter: formatPercent
        },
    ];

    return (
        <TransposedTable 
            title="表格 2：流量与广告效率" 
            columns={columns} 
            onOpenDetail={onOpenDetail} 
            customAction={
                onOpenKeywordAnalysis ? (
                    <button
                        type="button"
                        onClick={onOpenKeywordAnalysis}
                        className="inline-flex items-center gap-1.5 rounded-2xl border border-violet-300/30 bg-violet-500/15 px-3 py-2 text-xs font-semibold text-violet-100 transition-colors hover:bg-violet-500/25"
                    >
                        <Target className="h-3 w-3" />
                        关键词分析
                    </button>
                ) : null
            }
        />
    );
}


import React, { useState, lazy, Suspense } from 'react';
import { AggregatedData, DataRow, FilterState, TargetRow } from '../types';
import { formatNumber, formatPercent, formatPrice, formatMoneyNoDecimals } from '../utils';
import { Search, Calculator, FileSearch, MessageSquare, Target, ArrowUp, ArrowDown, Minus, X } from 'lucide-react';
import { METRICS, metricValue } from '../utils/metrics';
import { TREND_TONE, trendKeyOf } from '../utils/semantics';

const MiniTrendChart = lazy(() => import('./MiniTrendChart').then(m => ({ default: m.MiniTrendChart })));

type TrendConfig = {
    key: string;
    label: string;
    isPercent: boolean;
    isMoney: boolean;
    targetKey?: string;
};

type TableColumn = {
    header: string | React.ReactNode;
    current: number | string;
    last?: { val: number | undefined; diffType: 'percent' | 'absolute_val' | 'absolute_percent' };
    year?: { val: number | undefined; diffType: 'percent' | 'absolute_val' | 'absolute_percent' };
    formatter: (v: number) => string;
    /** 若提供，点击指标值可展开该指标的历史趋势 */
    trend?: TrendConfig;
};

interface TableProps {
  current: AggregatedData;
  last: AggregatedData | null;
  year: AggregatedData | null;
  target: AggregatedData;
  /** 供表格内联趋势图使用（原始明细 + 当前筛选 + 目标） */
  rawData?: DataRow[];
  filters?: FilterState;
  isWeeklyMode?: boolean;
  targetRows?: TargetRow[];
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
        const tone = TREND_TONE[current > 0 ? 'up' : 'flat'];
        const label2 = current > 0 ? 'New' : '—';
        return (
            <div className="mt-1.5 flex items-center justify-end gap-1.5 whitespace-nowrap text-[11px] text-slate-500">
                <span className="text-[10px] text-slate-500">{label}</span>
                <span className="tabular-nums">{formatter(baseline)}</span>
                <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 font-semibold ${tone.chip}`}>{label2}</span>
            </div>
        );
    }

    const delta = isRelative
        ? (current - baseline) / baseline
        : (current - baseline);
    const direction = trendKeyOf(delta);
    const tone = TREND_TONE[direction];
    const Icon = direction === 'up' ? ArrowUp : direction === 'down' ? ArrowDown : Minus;
    const sign = delta > 0 ? '+' : '';
    const deltaStr = type === 'absolute_val' ? formatter(delta) : (delta * 100).toFixed(2) + '%';

    return (
        <div className="mt-1.5 flex items-center justify-end gap-1.5 whitespace-nowrap text-[11px] text-slate-500">
            <span className="text-[10px] text-slate-500">{label}</span>
            <span className="tabular-nums">{formatter(baseline)}</span>
            <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-semibold tabular-nums ${tone.chip}`}>
                <Icon className="h-2.5 w-2.5" aria-hidden="true" />
                {sign}{deltaStr}
            </span>
        </div>
    );
};

// Transposed Table Component
type ColumnGroup = { label: string; from: number; to: number };

const TransposedTable = ({ 
    title, 
    columns,
    groups = [],
    trendContext,
    onOpenDetail,
    customAction
}: { 
    title: string, 
    columns: TableColumn[],
    groups?: ColumnGroup[],
    trendContext?: { rawData: DataRow[]; filters: FilterState; isWeeklyMode: boolean; targetRows: TargetRow[] },
    onOpenDetail?: () => void,
    customAction?: React.ReactNode // New prop for custom header buttons
}) => {
    const [hiddenColumns, setHiddenColumns] = useState<Set<number>>(() => new Set());
    const [showColumns, setShowColumns] = useState(false);
    const [openTrendKey, setOpenTrendKey] = useState<string | null>(null);
    const visibleColumns = columns.map((col, index) => ({col, index})).filter(({index}) => !hiddenColumns.has(index));
    const columnName = (node: React.ReactNode, fallback: string): string => {
        if (typeof node === 'string' || typeof node === 'number') return String(node);
        if (Array.isArray(node)) return node.map(child => columnName(child, '')).join(' ').trim() || fallback;
        if (React.isValidElement<{children?: React.ReactNode}>(node)) return columnName(node.props.children, fallback);
        return fallback;
    };
    const groupSpans = groups
        .map(group => ({
            ...group,
            count: visibleColumns.filter(({index}) => index >= group.from && index <= group.to).length,
        }))
        .filter(group => group.count > 0);

    // 内联趋势：点击指标值即可在表格下方展开该指标最近 12 期走势。
    const openTrend = openTrendKey ? columns.find(col => col.trend?.key === openTrendKey)?.trend : undefined;
    const trendFormatter = (trend: TrendConfig) =>
        trend.isPercent ? formatPercent : trend.isMoney ? formatMoneyNoDecimals : formatNumber;

    return (
        <div className="overflow-hidden rounded-3xl border border-white/80 bg-white shadow-[0_24px_70px_-42px_rgba(15,23,42,0.45)] ring-1 ring-slate-200/70">
            <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 bg-[linear-gradient(135deg,#0f172a_0%,#172554_100%)] px-5 py-4 text-white">
                <div>
                    <div className="mt-1 text-sm font-bold">{title}</div>
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
                <table className="min-w-max text-left text-sm">
                    <thead>
                        {groupSpans.length > 0 && (
                            <tr className="border-b border-slate-200 bg-slate-100/70">
                                {groupSpans.map(group => (
                                    <th key={group.label} colSpan={group.count} className="border-r border-slate-200 px-4 py-2 text-left text-[11px] font-semibold text-slate-600 last:border-0">
                                        {group.label}
                                    </th>
                                ))}
                            </tr>
                        )}
                        <tr className="border-b border-slate-200 bg-slate-50/80">
                            {visibleColumns.map(({col, index}, displayIndex) => (
                                <th key={index} className={`min-w-[168px] border-r border-slate-100 px-4 py-3.5 text-right text-[11px] font-semibold text-slate-500 last:border-0 ${displayIndex === 0 ? 'sticky left-0 z-10 bg-slate-50' : ''}`}>
                                    {col.header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        <tr className="bg-white">
                            {visibleColumns.map(({col, index}, displayIndex) => (
                                <td key={index} className={`border-r border-slate-100 px-4 py-4 text-right align-top last:border-0 even:bg-slate-50/35 ${displayIndex === 0 ? 'sticky left-0 z-10 bg-white' : ''}`}>
                                    {typeof col.current === 'number' && col.trend && trendContext ? (
                                        <button
                                            type="button"
                                            onClick={() => setOpenTrendKey(prev => prev === col.trend!.key ? null : col.trend!.key)}
                                            aria-expanded={openTrendKey === col.trend.key}
                                            title={`查看「${col.trend.label}」历史趋势`}
                                            className="font-mono text-lg font-bold tracking-tight text-slate-900 tabular-nums underline-offset-4 transition-colors hover:text-sky-700 hover:underline"
                                        >
                                            {col.formatter(col.current)}
                                        </button>
                                    ) : (
                                        <div className="text-lg font-bold tracking-tight text-slate-900 font-mono tabular-nums">
                                            {typeof col.current === 'number' ? col.formatter(col.current) : col.current}
                                        </div>
                                    )}
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
            {openTrend && trendContext && (
                <div className="border-t border-slate-200 bg-slate-50/60 p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold text-slate-700">{openTrend.label} · 历史趋势</span>
                            <span className="text-[11px] text-slate-500">（最近 12 {trendContext.isWeeklyMode ? '周' : '个月'}）</span>
                        </div>
                        <button
                            type="button"
                            aria-label="关闭趋势图"
                            onClick={() => setOpenTrendKey(null)}
                            className="rounded-full p-1.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                    <Suspense fallback={<p className="py-8 text-center text-sm text-slate-500">正在加载趋势图…</p>}>
                        <MiniTrendChart
                            rawData={trendContext.rawData}
                            filters={trendContext.filters}
                            metricKey={openTrend.key}
                            metricLabel={openTrend.label}
                            formatter={trendFormatter(openTrend)}
                            isPercent={openTrend.isPercent}
                            isMoney={openTrend.isMoney}
                            isWeekly={trendContext.isWeeklyMode}
                            targetRows={trendContext.targetRows}
                            targetKey={openTrend.targetKey}
                        />
                    </Suspense>
                </div>
            )}
        </div>
    );
};

export const PLTable: React.FC<TableProps> = ({ current, last, year, rawData, filters, isWeeklyMode, targetRows, onOpenDetail, onOpenCalculator, onOpenRefundAnalysis, onOpenReviewAnalysis }) => {
    // 成本结构默认收拢，避免 14 列一屏横向滚动；一键展开可查看全部占比。
    const [showCosts, setShowCosts] = useState(false);

    // 核心列的指标趋势配置（按 coreColumns 顺序一一对应；成本占比类为率值，不提供趋势）
    const PL_TREND: (TrendConfig | undefined)[] = [
        { key: 'sales_quantity', label: '销量', isPercent: false, isMoney: false, targetKey: 'sales_quantity_target' },
        { key: 'sales_amount', label: '销售额', isPercent: false, isMoney: true, targetKey: 'sales_amount_target' },
        { key: 'gross_profit', label: '毛利额', isPercent: false, isMoney: true, targetKey: 'gross_profit_target' },
        { key: 'gross_margin', label: '毛利率', isPercent: true, isMoney: false },
        { key: 'fba_sellable_qty', label: 'FBA可售', isPercent: false, isMoney: false },
        { key: 'avg_ticket', label: '客单均价', isPercent: false, isMoney: true },
        { key: 'average_rating', label: '平均评分', isPercent: false, isMoney: false },
    ];

    const getVal = (obj: AggregatedData | null, key: keyof AggregatedData): number | undefined => {
        return obj ? obj[key] : undefined;
    };

    const getRatio = (obj: AggregatedData | null, numKey: keyof AggregatedData, denKey: keyof AggregatedData): number | undefined => {
        if (!obj) return undefined;
        return obj[denKey] ? obj[numKey] / obj[denKey] : 0;
    };

    const coreColumns = [
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

    const coreWithTrend = coreColumns.map((col, index) => ({ ...col, trend: PL_TREND[index] }));
    const columns = showCosts ? [...coreWithTrend, ...costColumns] : coreWithTrend;
    const groups = showCosts
        ? [
            { label: '核心业绩', from: 0, to: 3 },
            { label: '商品与口碑', from: 4, to: 6 },
            { label: '成本结构', from: 7, to: 13 },
        ]
        : [
            { label: '核心业绩', from: 0, to: 3 },
            { label: '商品与口碑', from: 4, to: 6 },
        ];
    const trendContext = rawData && filters
        ? { rawData, filters, isWeeklyMode: Boolean(isWeeklyMode), targetRows: targetRows || [] }
        : undefined;

    return (
        <React.Fragment key={showCosts ? 'pl-costs' : 'pl-core'}>
            <TransposedTable
                title="表格 1：P&L 核心业绩"
                columns={columns}
                groups={groups}
                trendContext={trendContext}
                onOpenDetail={onOpenDetail}
                customAction={
                    <button
                        type="button"
                        onClick={() => setShowCosts(v => !v)}
                        className="rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/15"
                    >
                        {showCosts ? '收起成本结构' : '成本结构（7 项）'}
                    </button>
                }
            />
        </React.Fragment>
    );
};

export const TrafficTable: React.FC<TableProps> = ({ current, last, year, rawData, filters, isWeeklyMode, targetRows, onOpenDetail, onOpenKeywordAnalysis }) => {
    
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

    const trafficColumns = [
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

    // 流量表列的指标趋势配置（顺序与 trafficColumns 一致；效率类为率值，不提供趋势）
    const TRAFFIC_TREND: (TrendConfig | undefined)[] = [
        { key: 'ad_spend', label: '广告花费', isPercent: false, isMoney: true, targetKey: 'ad_spend_target' },
        { key: 'ad_sales', label: '广告销售额', isPercent: false, isMoney: true },
        { key: 'sp_spend', label: 'SP花费', isPercent: false, isMoney: true },
        { key: 'sp_sales', label: 'SP销售额', isPercent: false, isMoney: true },
        { key: 'sd_spend', label: 'SD花费', isPercent: false, isMoney: true },
        { key: 'sd_sales', label: 'SD销售额', isPercent: false, isMoney: true },
        { key: 'sb_spend', label: 'SB花费', isPercent: false, isMoney: true },
        { key: 'sb_sales', label: 'SB销售额', isPercent: false, isMoney: true },
        { key: 'sbv_spend', label: 'SBV花费', isPercent: false, isMoney: true },
        { key: 'sbv_sales', label: 'SBV销售额', isPercent: false, isMoney: true },
        { key: 'impressions', label: '展示量', isPercent: false, isMoney: false },
        { key: 'clicks', label: '点击', isPercent: false, isMoney: false },
    ];
    const columns = trafficColumns.map((col, index) => ({ ...col, trend: TRAFFIC_TREND[index] }));
    const trendContext = rawData && filters
        ? { rawData, filters, isWeeklyMode: Boolean(isWeeklyMode), targetRows: targetRows || [] }
        : undefined;

    return (
        <TransposedTable 
            title="表格 2：流量与广告效率" 
            columns={columns} 
            groups={[
                { label: '广告总览', from: 0, to: 1 },
                { label: '分类型花费与销售（SP / SD / SB / SBV）', from: 2, to: 9 },
                { label: '流量规模', from: 10, to: 11 },
                { label: '效率指标', from: 12, to: 17 },
            ]}
            trendContext={trendContext}
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

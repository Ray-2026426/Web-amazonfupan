
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { X, Layers, Check, FileSearch, ExternalLink, Copy, ArrowUp, ArrowDown, Filter, Search as SearchIcon, ListFilter, Calculator, CheckSquare, Square, RefreshCcw, MessageSquare, TrendingUp, Bot, Sparkles, Loader2, Settings, ChevronDown, ChevronUp, ChevronRight } from 'lucide-react';
import { DataRow, AggregatedData, TargetRow, InventoryRow, InventoryAggregated, FilterState } from '../types';
import { groupDataByDimension, aggregateData, formatMoney, formatNumber, formatPercent, getPacingRatio, groupTargetsByDimension, initialAggregated, initialInventoryAggregated, getAmazonProductLink, formatPrice, groupInventoryByDimension, aggregateInventoryData, formatDate, formatMoneyNoDecimals, formatRMB, formatBusinessWeekFromDateStr, sumAggregatedData, sumInventoryAggregated } from '../utils';
import { TrendChartModal, TrendColumn, TrendChartScope } from './TrendChartModal';
import { PromptSettingsModal, getActivePromptSettings } from './PromptSettingsModal';
import { hasConfiguredAiApi, unifiedGenerateContent, AI_API_SETUP_HINT } from './aiUnifiedGenerate';
import {
    computeSubtableRowDiagnosis,
    getDiagnosisSortKey,
    loadSubtableDiagnosisSettings,
} from './subtableDiagnosis';
import { SubtableDiagnosisSettingsModal } from './SubtableDiagnosisSettingsModal';
import { useEscClose } from './useEscClose';

interface DetailAnalysisModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentRows?: DataRow[];
    lastRows?: DataRow[];
    yearRows?: DataRow[];
    targetRows?: TargetRow[]; 
    inventoryRows?: InventoryRow[]; 
    period?: { start: Date, end: Date }; 
    type: 'PL' | 'Traffic' | 'Inventory'; 
    onOpenRefundAnalysis?: (filters?: Partial<FilterState>) => void;
    onOpenCalculator?: (product?: string, country?: string) => void; 
    onOpenReviewAnalysis?: () => void; 
    isWeeklyMode?: boolean;
    rawPerformance?: DataRow[];
    performanceMonthly?: DataRow[];
    performanceWeekly?: DataRow[];
}

type GroupDimension = 'product_name' | 'parent_asin' | 'child_asin' | 'shop_name' | 'manager' | 'brand' | 'country' | 'year_month' | 'sub_category';

const DIMENSION_OPTIONS: { key: GroupDimension, label: string }[] = [
    { key: 'country', label: '国家' },
    { key: 'year_month', label: '年月' }, 
    { key: 'sub_category', label: '二级分类' },
    { key: 'brand', label: '品牌' },
    { key: 'shop_name', label: '店铺' },
    { key: 'manager', label: '负责人' },
    { key: 'parent_asin', label: '父ASIN' },
    { key: 'child_asin', label: '子ASIN' },
    { key: 'product_name', label: '品名' },
];

const titleMap: Record<string, string> = {
    'PL': 'P&L 业绩详情分析',
    'Traffic': '流量与广告效能分析',
    'Inventory': 'FBA 库存深度分析'
};

/** 子表顶部：按选定维度字段做「包含」关键词筛选（与列头筛选为 AND，在聚合前先筛明细行） */
type SubtableQuickFilterKey =
    | 'product_name'
    | 'manager'
    | 'brand'
    | 'country'
    | 'child_asin'
    | 'parent_asin'
    | 'shop_name';

const SUBTABLE_QUICK_FILTER_OPTIONS: { key: SubtableQuickFilterKey; label: string }[] = [
    { key: 'product_name', label: '品名' },
    { key: 'manager', label: '负责人' },
    { key: 'brand', label: '品牌' },
    { key: 'country', label: '国家' },
    { key: 'child_asin', label: '子ASIN' },
    { key: 'parent_asin', label: '父ASIN' },
    { key: 'shop_name', label: '店铺' },
];

const subtableQuickGetField = (row: DataRow, key: SubtableQuickFilterKey): string => {
    switch (key) {
        case 'product_name':
            return row.product_name;
        case 'manager':
            return row.manager;
        case 'brand':
            return row.brand;
        case 'country':
            return row.country;
        case 'child_asin':
            return row.child_asin;
        case 'parent_asin':
            return row.parent_asin;
        case 'shop_name':
            return row.shop_name;
    }
};

const subtableQuickGetFieldInv = (row: InventoryRow, key: SubtableQuickFilterKey): string => {
    switch (key) {
        case 'product_name':
            return row.product_name;
        case 'manager':
            return row.manager;
        case 'brand':
            return row.brand;
        case 'country':
            return row.country;
        case 'child_asin':
            return row.asin;
        case 'parent_asin':
            return row.parent_asin;
        case 'shop_name':
            return row.shop_name;
    }
};

/** 多项精确搜索：一行一项，去重（忽略大小写），最多 MAX 条 */
const SUBTABLE_BULK_EXACT_MAX = 200;
function parseBulkExactInput(raw: string): { tokens: string[]; truncated: boolean } {
    const lines = raw.split(/\r\n|\n|\r/);
    const seen = new Set<string>();
    const tokens: string[] = [];
    let truncated = false;
    for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        const k = t.toLowerCase();
        if (seen.has(k)) continue;
        if (tokens.length >= SUBTABLE_BULK_EXACT_MAX) {
            truncated = true;
            break;
        }
        seen.add(k);
        tokens.push(t);
    }
    return { tokens, truncated };
}

const SUBTABLE_PL_AI_KEY = 'detail_subtable_pl_ai';
const SUBTABLE_TRAFFIC_AI_KEY = 'detail_subtable_traffic_ai';

const DEFAULT_SUBTABLE_AI_SYSTEM = `【身份与数据边界】
你是「亚马逊业绩子表」专属诊断分析师。为业财与投放**一体**复盘，作如下约定（仅用于你组织思路，不增加用户未提供的数据）：
- **子表1**：**P&L 业绩子表**——销额/销量、毛利与毛利率、费用结构、退款、广告费与广告占比等**结果与利润**向指标。
- **子表2**：**流量与广告子表**——展示/点击、广告费、CPC、ACoS/ROAS、与转化/流量效率相关的**过程与规模**向指标。

**子表1 ⟷ 子表2 联动要求**：你不得用「只读子表1、不理子表2」或「只读子表2、不理子表1」的封闭方式下**绝对化**结论。即使本次请求里**仅附带**了用户当前在界面中打开的那**一张**子表数据（只含子表1 或 只含子表2），你也必须显式做**对侧联动的思考**并在文中写出：例如 P&L 上看到的利与费，应用流量/广告维度的**量与效率**来对照「是否说得通」；流量/广告上的高花费或高点击，应回落到**对销额/毛利/占比**的含义，并点明哪些判断**需用户打开另一子表**在相同/可比时间、可比拆解下核对后才能定论。当本次**没有**另一类子表的数据时，应写明「本段为单侧推断、须结合子表2/子表1 验证」，**不得编造**对侧子表中未出现的数字、店铺、ASIN 或品名。

**本次数据实际来源**仍只来自**用户当前正在使用的那类子表**的视图：已受主界面时间范围等筛选，并包含用户选择的拆解维度、列头漏斗、顶部词筛、以及当前排序下的汇总行（与表格逻辑行一致，不限于当前屏幕可见行）。若存在父/子 ASIN 折叠或按品名/ASIN 的预筛，以范围说明与数据块为准。

你必须只基于**本次**提供的范围说明与数据块进行分析，不得编造未出现的数字、店铺、ASIN 或品名。若某指标在数据中缺失，请明确写「数据未提供，无法判断」，不得自行补数。

请用中文撰写。输出必须为 Markdown（# / ## 标题、有序或无序列表、**加粗** 强调要点），不要使用 HTML。

【核心诊断方法：六层数据模型与三大路径】
在进行任何诊断时，你必须将观察到的现象归类到以下层级，并理解因果（下层驱动上层；分析时先锁作战单元，再判终局，再下钻）：

**第0层 维度/作战单元**：负责人、店铺、国家、ASIN/父或子、品牌、分类等。先明确「在讨论哪条汇总行/哪类组合」，再谈指标。

**第1层 P&L 终局**：毛利润、毛利率、ROI 等（若子表为 P&L 类，数据中有则优先用于判断健康度）。这是复盘的顶视野。

**第2层 结果与结构**：收入（销售额、销量等）与主要成本/消耗（广告、退款、费用等），及广告占比、CPO 等综合指标（以数据中实际列为准）。

**第3层 效率/操纵杆**：转化（如 CVR、与转化相关表述）、广告（ACoS/ROAS/CPC/CTR 等，以数据中有者为准）、质量（退货/退款、评分相关）、价格（客单价/均价，以数据中有者为准）。

**第4层 流量/燃料**：展示、点击、Sessions/自然或广告流量等（以子表为流量/广告类时重点使用）。

**第5层 资产/供给**：FBA 可售、库龄、库存成本等（若子表为库存类或数据中包含则使用）。断货与可售天数决定「是否还有意义谈拉流量」。

【决策顺序：不可随意跳步】
**规则零（Rule Zero）— S&OP 与可售优先**：若数据中体现 FBA 可售为 0、或「可售天数过短/明显断货风险」类信号，应优先判断为供给与补货问题：先建议收/停非必要广告、推动补货与在途，再分析流量与转化；若该层已能解释主矛盾，可明确写「本范围下优先处理库存与补货，本次子表不展开深拆流量」。

**路径一 — 销售额/规模类未达预期**（在规则零未覆盖或已排除断货主因时）：用「流量 × 转化 × 客单」思路拆解。广告流量问题可联系展示/CTR/竞价与创意；自然侧若数据无法支撑排名，只写据现有数据能推出的结论。转化问题可核对 Buybox、价格、评分、退款等子表中是否可见的线索。

**路径二 — 利润/费用类未达预期**：重点打穿**广告**（占比过高、CPC、无效流量）与**质量/退款**（退货、差评带来的利润侵蚀）。区分手：竞价与结构问题、词/活动质量、以及品控/Listing 预期与 VOC（若数据有退货或评论类接入则引用，无则写数据不足）

【输出要求】
结构须清晰、结论须收束。禁止只罗列十多种可能原因。必须尽量回答：问题更像落在**哪一层**、更接近**哪条路径**、与**当前子表中的哪几列最一致**、以及**下一步 1～3 条可执行、可排优先级的行动**。若数据不足以下结论，须诚实说明缺什么、无法外推。

注：P&L 子表以毛利、费用、退款、广告费为主；流量子表以广告与点击、展点为主；若本次为库存子表，则优先资产层与库龄/成本风险。请根据数据块中实际列名与数值灵活套用，勿机械套用子表中不存在的指标名。`;

const DEFAULT_SUBTABLE_AI_TEMPLATE = `以下数据与当前子表展示范围一致（含列头筛选、顶部词筛、折叠视图若有）。请**严格只据此**作诊断，不要补充外部“行业常识数字”。

{{DATA}}

请按 **Markdown** 输出，并遵守「六层 + 三路径」方法。建议结构如下（可微调标题，但须覆盖各块实质内容）：

## 1. 范围与读表说明
- 用一两句话说明：子表类型（P&L / 流量/广告 / 库存 等，从范围说明中判断）、主时间段、主要拆解维度、参与行数，以及**哪些关键指标在数据中未出现**（若有）。

## 2. 总览
- 概括当前视图下整体强弱（仅基于表内数），避免空话。

## 3. 分层与路径诊断
- 指出最需关注的 1～3 条汇总行或维度组合（用表中维度值指代）。
- 对每条优先项：说明更像落在**第几层**（0～5）、若适用则写明是否触发**规则零**、否则进入**路径一**还是**路径二**；用表中的具体列与数值**简短对照**（同比/环比/目标等若数据有则写）。

## 4. 异常与风险
- 结合上节，点出**异常与风险**（可引用目标差、同环比、占比等，以数据中有的为准）。

## 5. 行动建议
- 给出 **3～5 条**可执行、可排序的建议；每条应能对应到**层级 + 路径 + 子表能支持的证据**，避免笼统的「优化广告」「提升转化」而无抓手。

若数据行过少或关键列缺失，在「风险」中写清**局限**，并只写基于现有能确定的建议。`;

const safeRatio = (num: number, den: number) => den ? num / den : 0;
const getNaturalCVR = (d: AggregatedData) => d.natural_clicks ? d.natural_orders / d.natural_clicks : 0;

const PL_TREND_METRICS_SOURCE = [
    { title: '销量', key: 'sales_quantity', formatter: formatNumber, diffType: 'percent' },
    { title: '销售额', key: 'sales_amount', formatter: formatMoneyNoDecimals, diffType: 'percent' },
    { title: '毛利额', key: 'gross_profit', formatter: formatMoneyNoDecimals, diffType: 'percent' },
    { title: '毛利率', key: 'gross_margin', formatter: formatPercent, diffType: 'absolute_percent' },
    { title: 'FBA可售', key: 'fba_sellable_qty', formatter: formatNumber, diffType: 'percent' },
    { title: '客单价', key: 'avg_ticket', formatter: formatPrice, diffType: 'percent' },
    { title: '评分', key: 'average_rating', formatter: (v: number) => v.toFixed(1), diffType: 'absolute_val' },
    { title: '头程占比', calculator: (d: AggregatedData) => safeRatio(d.first_mile_cost, d.sales_amount), formatter: formatPercent, diffType: 'absolute_percent' },
    { title: '采购占比', calculator: (d: AggregatedData) => safeRatio(d.procurement_cost, d.sales_amount), formatter: formatPercent, diffType: 'absolute_percent' },
    { title: '仓储占比', calculator: (d: AggregatedData) => safeRatio(d.storage_fee, d.sales_amount), formatter: formatPercent, diffType: 'absolute_percent' },
    { title: 'FBA费占比', calculator: (d: AggregatedData) => safeRatio(d.fba_fee, d.sales_amount), formatter: formatPercent, diffType: 'absolute_percent' },
    { title: '退款占比', calculator: (d: AggregatedData) => safeRatio(d.refund_cost, d.sales_amount), formatter: formatPercent, diffType: 'absolute_percent' },
    { title: '佣金占比', calculator: (d: AggregatedData) => safeRatio(d.platform_commission, d.sales_amount), formatter: formatPercent, diffType: 'absolute_percent' },
    { title: '广告占比', calculator: (d: AggregatedData) => safeRatio(d.ad_spend, d.sales_amount), formatter: formatPercent, diffType: 'absolute_percent' }
];

const TRAFFIC_TREND_METRICS_SOURCE = [
    { title: '广告花费', key: 'ad_spend', formatter: formatMoney, diffType: 'percent' },
    { title: '广告销售', key: 'ad_sales', formatter: formatMoneyNoDecimals, diffType: 'percent' },
    { title: 'SP花费', key: 'sp_spend', formatter: formatMoney, diffType: 'percent' },
    { title: 'SP销售', key: 'sp_sales', formatter: formatMoneyNoDecimals, diffType: 'percent' },
    { title: 'SD花费', key: 'sd_spend', formatter: formatMoney, diffType: 'percent' },
    { title: 'SD销售', key: 'sd_sales', formatter: formatMoneyNoDecimals, diffType: 'percent' },
    { title: 'SB花费', key: 'sb_spend', formatter: formatMoney, diffType: 'percent' },
    { title: 'SB销售', key: 'sb_sales', formatter: formatMoneyNoDecimals, diffType: 'percent' },
    { title: 'SBV花费', key: 'sbv_spend', formatter: formatMoney, diffType: 'percent' },
    { title: 'SBV销售', key: 'sbv_sales', formatter: formatMoneyNoDecimals, diffType: 'percent' },
    { title: '展示量', key: 'impressions', formatter: formatNumber, diffType: 'percent' },
    { title: '点击量', key: 'clicks', formatter: formatNumber, diffType: 'percent' },
    { title: '广告CVR', calculator: (d: AggregatedData) => safeRatio(d.ad_orders, d.clicks), formatter: formatPercent, diffType: 'absolute_percent' },
    { title: 'CTR', calculator: (d: AggregatedData) => safeRatio(d.clicks, d.impressions), formatter: formatPercent, diffType: 'absolute_percent' },
    { title: '自然CVR', calculator: getNaturalCVR, formatter: formatPercent, diffType: 'absolute_percent' },
    { title: 'CPC', calculator: (d: AggregatedData) => safeRatio(d.ad_spend, d.clicks), formatter: (v: number) => `$${v.toFixed(2)}`, diffType: 'absolute_val' },
    { title: 'ACoS', calculator: (d: AggregatedData) => safeRatio(d.ad_spend, d.ad_sales), formatter: formatPercent, diffType: 'absolute_percent' },
    { title: 'ASoAS (广告订单占比)', calculator: (d: AggregatedData) => safeRatio(d.ad_orders, d.sales_quantity), formatter: formatPercent, diffType: 'absolute_percent' }
];

const TARGET_TREND_METRICS_SOURCE = [
    { title: '销量（目标）', shortLabel: '销量', dataKey: 'tg_sales_quantity', isPercent: false, isMoney: false },
    { title: '销售额（目标）', shortLabel: '销售额', dataKey: 'tg_sales_amount', isPercent: false, isMoney: true },
    { title: '毛利额（目标）', shortLabel: '毛利额', dataKey: 'tg_gross_profit', isPercent: false, isMoney: true },
    { title: '毛利率（目标）', shortLabel: '毛利率', dataKey: 'tg_gross_margin', isPercent: true, isMoney: false },
    { title: '广告花费（目标）', shortLabel: '广告花费', dataKey: 'tg_ad_spend', isPercent: false, isMoney: true },
    { title: '广告占比（目标）', shortLabel: '广告占比', dataKey: 'tg_ad_ratio', isPercent: true, isMoney: false }
];

// --- HeaderFilter (Moved Outside) ---
const HeaderFilter = ({ dimKey, align = 'right', dimFilters, setDimFilters, sourceData }: { 
    dimKey: string, 
    align?: 'left' | 'right',
    dimFilters: Record<string, string[]>,
    setDimFilters: React.Dispatch<React.SetStateAction<Record<string, string[]>>>,
    sourceData: any[] 
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const filterRef = useRef<HTMLDivElement>(null);

    const uniqueValues = useMemo(() => {
        const values = new Set<string>();
        sourceData.forEach((row: any) => {
            const val = row.dimensions[dimKey];
            if (val) values.add(String(val));
        });
        return Array.from(values).sort();
    }, [sourceData, dimKey]);

    const filteredValues = useMemo(() => {
        if (!searchTerm) return uniqueValues;
        return uniqueValues.filter(val => val.toLowerCase().includes(searchTerm.toLowerCase()));
    }, [uniqueValues, searchTerm]);

    const currentFilters = dimFilters[dimKey] || [];

    const toggleFilter = (val: string) => {
        setDimFilters(prev => {
            const current = prev[dimKey] || [];
            const newFilters = current.includes(val)
                ? current.filter(c => c !== val)
                : [...current, val];
            
            if (newFilters.length === 0) {
                const { [dimKey]: _, ...rest } = prev;
                return rest;
            }
            
            return { ...prev, [dimKey]: newFilters };
        });
    };

    const clearFilter = () => {
            setDimFilters(prev => {
            const { [dimKey]: _, ...rest } = prev;
            return rest;
        });
    };
    
    const selectAll = () => {
        setDimFilters(prev => {
            const current = prev[dimKey] || [];
            const newSelection = Array.from(new Set([...current, ...filteredValues]));
            return { ...prev, [dimKey]: newSelection };
        });
    };
    
    useEffect(() => {
        if (!isOpen) setSearchTerm('');
    }, [isOpen]);
    
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        if (isOpen) document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [isOpen]);

    const hasFilter = currentFilters.length > 0;

    return (
        <div className={`absolute top-1/2 -translate-y-1/2 ${align === 'left' ? 'left-1' : 'right-1'}`} ref={filterRef}>
            <button 
                onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
                className={`p-1 rounded hover:bg-slate-300 transition-colors ${hasFilter ? 'text-blue-600 bg-blue-50' : 'text-slate-400 opacity-0 group-hover:opacity-100'}`}
            >
                <Filter className="w-3 h-3" fill={hasFilter ? 'currentColor' : 'none'} />
            </button>
            
            {isOpen && (
                <div 
                    className={`absolute top-full mt-1 bg-white border border-slate-200 shadow-xl rounded-lg w-56 z-[80] text-left flex flex-col max-h-72 cursor-default
                        ${align === 'left' ? 'left-0' : 'right-0'}
                    `} 
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="p-2 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-lg flex-shrink-0">
                        <span className="text-xs font-bold text-slate-600">筛选 ({uniqueValues.length})</span>
                        <div className="flex gap-2">
                            <button onClick={selectAll} className="text-[10px] text-blue-600 hover:underline">
                                全选
                            </button>
                            <button onClick={clearFilter} className="text-[10px] text-slate-400 hover:text-red-500 hover:underline">
                                重置
                            </button>
                        </div>
                    </div>
                    
                    <div className="p-2 border-b border-slate-100 bg-white">
                            <div className="relative">
                            <SearchIcon className="w-3.5 h-3.5 absolute left-2 top-2 text-slate-400" />
                            <input 
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full bg-slate-50 border border-slate-200 rounded py-1 pl-7 pr-2 text-xs text-slate-700 outline-none focus:border-blue-500 focus:bg-white transition-colors"
                                placeholder="搜索..."
                                autoFocus
                                onClick={(e) => e.stopPropagation()}
                            />
                            </div>
                    </div>

                    <div className="overflow-y-auto custom-scroll p-1">
                        {filteredValues.length > 0 ? filteredValues.map(val => {
                            const isSelected = currentFilters.includes(val);
                            return (
                                <div 
                                    key={val} 
                                    className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 cursor-pointer text-xs rounded"
                                    onClick={() => toggleFilter(val)}
                                >
                                    <div className={`w-3.5 h-3.5 border rounded flex items-center justify-center flex-shrink-0 transition-colors
                                        ${isSelected ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white'}
                                    `}>
                                        {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                                    </div>
                                    <span className="truncate text-slate-700" title={val}>{val}</span>
                                </div>
                            );
                        }) : (
                            <div className="p-2 text-center text-xs text-slate-400">无匹配选项</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};


export const DetailAnalysisModal: React.FC<DetailAnalysisModalProps> = ({ 
    isOpen, 
    onClose, 
    currentRows = [], 
    lastRows = [], 
    yearRows = [],
    targetRows = [],
    inventoryRows = [],
    period,
    type,
    onOpenRefundAnalysis,
    onOpenCalculator,
    onOpenReviewAnalysis,
    isWeeklyMode,
    rawPerformance = [],
    performanceMonthly = [],
    performanceWeekly = []
}) => {
    const [selectedDimensions, setSelectedDimensions] = useState<GroupDimension[]>(['manager']);
    const [showStructure, setShowStructure] = useState(false); 
    const [visibleCount, setVisibleCount] = useState(50);
    const tableContainerRef = useRef<HTMLDivElement>(null);
    const [sortConfig, setSortConfig] = useState<{ colIndex: number, direction: 'asc' | 'desc' } | null>(null);
    const [dimFilters, setDimFilters] = useState<Record<string, string[]>>({});
    const [subtableQuickKey, setSubtableQuickKey] = useState<SubtableQuickFilterKey>('product_name');
    const [subtableQuickText, setSubtableQuickText] = useState('');
    const [subtableQuickOpen, setSubtableQuickOpen] = useState(false);
    const subtableQuickRef = useRef<HTMLDivElement>(null);
    const [subtableBulkOpen, setSubtableBulkOpen] = useState(false);
    const [subtableBulkDraft, setSubtableBulkDraft] = useState('');
    const [subtableBulkExactTokens, setSubtableBulkExactTokens] = useState<string[]>([]);
    const [subtableBulkNotice, setSubtableBulkNotice] = useState<string | null>(null);
    const subtableSearchBarRef = useRef<HTMLDivElement>(null);

    const [trendModalOpen, setTrendModalOpen] = useState(false);
    const [trendDimensions, setTrendDimensions] = useState<Record<string, string>>({});
    const [trendFromTotal, setTrendFromTotal] = useState(false);

    const [aiPanelOpen, setAiPanelOpen] = useState(false);
    const [aiReport, setAiReport] = useState('');
    const [aiLoading, setAiLoading] = useState(false);
    const [aiError, setAiError] = useState('');
    const [aiPromptModalOpen, setAiPromptModalOpen] = useState(false);
    const [copyFeishuHint, setCopyFeishuHint] = useState<'idle' | 'ok' | 'err'>('idle');
    const [subtableDiagnosisOpen, setSubtableDiagnosisOpen] = useState(false);
    const [diagnosisSettings, setDiagnosisSettings] = useState(() => loadSubtableDiagnosisSettings());
    const tagColumnVisible = diagnosisSettings.showTagColumn === true;
    const prevTagColumnVisible = useRef<boolean | null>(null);
    useEffect(() => {
        if (prevTagColumnVisible.current === null) {
            prevTagColumnVisible.current = tagColumnVisible;
            return;
        }
        if (prevTagColumnVisible.current !== tagColumnVisible) {
            setSortConfig(null);
            prevTagColumnVisible.current = tagColumnVisible;
        }
    }, [tagColumnVisible]);

    const timeLabel = isWeeklyMode ? '年周' : '年月';

    const monthlyRawSource = performanceMonthly.length > 0 ? performanceMonthly : rawPerformance;

    const toggleDimension = (key: GroupDimension) => {
        setSelectedDimensions(prev => {
            if (prev.includes(key)) {
                if (prev.length === 1) return prev;
                return prev.filter(k => k !== key);
            } else {
                return [...prev, key];
            }
        });
    };

    useEffect(() => {
        if (!subtableQuickOpen) return;
        const close = (e: MouseEvent) => {
            if (subtableQuickRef.current && !subtableQuickRef.current.contains(e.target as Node)) {
                setSubtableQuickOpen(false);
            }
        };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [subtableQuickOpen]);

    useEffect(() => {
        if (!subtableBulkNotice) return;
        const t = window.setTimeout(() => setSubtableBulkNotice(null), 4500);
        return () => window.clearTimeout(t);
    }, [subtableBulkNotice]);

    useEffect(() => {
        if (!subtableBulkOpen) return;
        const handle = (e: MouseEvent) => {
            if (subtableSearchBarRef.current && !subtableSearchBarRef.current.contains(e.target as Node)) {
                setSubtableBulkOpen(false);
            }
        };
        document.addEventListener('mousedown', handle);
        return () => document.removeEventListener('mousedown', handle);
    }, [subtableBulkOpen]);

    useEffect(() => {
        setSubtableBulkExactTokens([]);
        setSubtableBulkDraft('');
        setSubtableBulkOpen(false);
        setSubtableBulkNotice(null);
    }, [subtableQuickKey]);

    /** 顶部词筛集合（多项精确）：整字段精确匹配（trim 后不分大小写） */
    const subtableBulkNormSet = useMemo(
        () => new Set(subtableBulkExactTokens.map((t) => t.trim().toLowerCase()).filter(Boolean)),
        [subtableBulkExactTokens]
    );

    /** 顶部词筛：在按维度聚合之前，对原始业绩/库存行做「包含」匹配；若启用了多项精确搜索，则仅做精确匹配且忽略单行关键词 */
    const subtableQuickQ = useMemo(
        () => subtableQuickText.trim().toLowerCase(),
        [subtableQuickText]
    );

    const plRowsForSubtable = useMemo(() => {
        const bulkActive = subtableBulkNormSet.size > 0;
        if (bulkActive) {
            const match = (r: DataRow) => {
                const v = String(subtableQuickGetField(r, subtableQuickKey) || '').trim().toLowerCase();
                return subtableBulkNormSet.has(v);
            };
            return {
                c: currentRows.filter(match),
                l: lastRows.filter(match),
                y: yearRows.filter(match)
            };
        }
        const q = subtableQuickQ;
        if (!q) {
            return { c: currentRows, l: lastRows, y: yearRows };
        }
        const match = (r: DataRow) => {
            const v = String(subtableQuickGetField(r, subtableQuickKey) || '');
            return v.toLowerCase().includes(q);
        };
        return {
            c: currentRows.filter(match),
            l: lastRows.filter(match),
            y: yearRows.filter(match)
        };
    }, [currentRows, lastRows, yearRows, subtableQuickKey, subtableQuickQ, subtableBulkNormSet]);

    const invRowsForSubtable = useMemo(() => {
        const bulkActive = subtableBulkNormSet.size > 0;
        if (bulkActive) {
            return inventoryRows.filter((r) => {
                const v = String(subtableQuickGetFieldInv(r, subtableQuickKey) || '').trim().toLowerCase();
                return subtableBulkNormSet.has(v);
            });
        }
        const q = subtableQuickQ;
        if (!q) return inventoryRows;
        return inventoryRows.filter((r) => {
            const v = String(subtableQuickGetFieldInv(r, subtableQuickKey) || '');
            return v.toLowerCase().includes(q);
        });
    }, [inventoryRows, subtableQuickKey, subtableQuickQ, subtableBulkNormSet]);

    const applySubtableBulkExact = () => {
        const { tokens, truncated } = parseBulkExactInput(subtableBulkDraft);
        setSubtableBulkExactTokens(tokens);
        setSubtableQuickText('');
        setSubtableBulkOpen(false);
        if (truncated) {
            setSubtableBulkNotice(`已超出 ${SUBTABLE_BULK_EXACT_MAX} 条上限，仅保留前 ${SUBTABLE_BULK_EXACT_MAX} 项`);
        } else {
            setSubtableBulkNotice(null);
        }
    };

    const handleSort = (index: number) => {
        setSortConfig(prev => {
            if (prev && prev.colIndex === index) {
                return { colIndex: index, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
            }
            return { colIndex: index, direction: 'desc' };
        });
    };

    const SortIcon = ({ index }: { index: number }) => {
        if (sortConfig?.colIndex !== index) return <div className="w-3 h-3 flex flex-col justify-center opacity-20"><ArrowUp className="w-2 h-2" /><ArrowDown className="w-2 h-2" /></div>;
        return sortConfig.direction === 'asc' 
            ? <ArrowUp className="w-3 h-3 text-blue-600" /> 
            : <ArrowDown className="w-3 h-3 text-blue-600" />;
    };

    const renderDiff = (curr: number, base: number | undefined, type: string) => {
        if (base === undefined || base === null) return <span className="text-slate-300">-</span>;

        // 基期为 0 时：percent 类型用「New / —」替代 0.00%，避免误读为「无变化」
        if (type === 'percent' && base === 0) {
            if (curr > 0) return <span className="text-green-600 font-mono ml-1">New</span>;
            return <span className="text-slate-400 font-mono ml-1">—</span>;
        }

        const val = (type === 'absolute_percent' || type === 'absolute_val')
            ? curr - base
            : (curr - base) / base;

        const isPos = val > 0;
        const color = isPos ? 'text-green-600' : (val === 0 ? 'text-slate-400' : 'text-red-500');
        const txt = type === 'absolute_val' ? val.toFixed(2) : (val * 100).toFixed(2) + '%';
        const icon = isPos ? '↑' : (val === 0 ? '' : '↓');
        
        return <span className={`${color} font-mono ml-1`}>{icon}{txt}</span>;
    };

    const renderTarget = (curr: number, target: number, config: any, fmt: any) => {
        if (!target && target !== 0) return null;
        if (isWeeklyMode) return null; 

        const pct = target !== 0 ? curr / target : 0;
        const isReverse = config.reverseColor; 
        
        let colorClass = 'text-slate-500';
        if (isReverse) {
            colorClass = pct > 1.05 ? 'text-red-500' : (pct > 0.9 ? 'text-orange-500' : 'text-blue-600');
        } else {
            colorClass = pct >= 1 ? 'text-green-600' : 'text-orange-500';
        }

        const label = config.targetLabel || '目标';
        const valStr = fmt(target);
        const pctStr = (pct * 100).toFixed(0) + '%';

        if (config.targetDisplayMode === 'both') {
             return (
                <div className="flex justify-end items-center text-[10px] text-slate-500 whitespace-nowrap gap-1">
                    <span>{label}:</span>
                    <span className="text-slate-400">{valStr}</span>
                    <span className={`${colorClass} font-mono ml-0.5 font-medium`}>({pctStr})</span>
                </div>
            );
        } else if (config.targetDisplayMode === 'value') {
             return (
                <div className="flex justify-end items-center text-[10px] text-slate-500 whitespace-nowrap">
                    <span>{label}:</span>
                    <span className="text-slate-600 font-mono ml-1">{valStr}</span>
                </div>
            );
        } else {
            return (
                <div className="flex justify-end items-center text-[10px] text-slate-500 whitespace-nowrap">
                    <span>{label}:</span>
                    <span className={`${colorClass} font-mono ml-1`}>{pctStr}</span>
                </div>
            );
        }
    };

    // --- Filtered Raw Rows ---
    const filteredRawRows = useMemo(() => {
        if (!currentRows || currentRows.length === 0) return [];
        if (Object.keys(dimFilters).length === 0) return currentRows;
        
        return currentRows.filter(row => {
            return Object.entries(dimFilters).every(([dimKey, selectedVals]) => {
                const vals = selectedVals as string[];
                if (vals.length === 0) return true;
                
                let rowVal = '';
                if (dimKey === 'year_month') {
                    rowVal = isWeeklyMode ? formatBusinessWeekFromDateStr(row.date) : row.date.substring(0, 7);
                } else {
                    rowVal = (row as any)[dimKey];
                }
                
                return vals.includes(String(rowVal));
            });
        });
    }, [currentRows, dimFilters, isWeeklyMode]);

    const filteredInventoryRows = useMemo(() => {
        if (!inventoryRows || inventoryRows.length === 0) return [];
        if (Object.keys(dimFilters).length === 0) return inventoryRows;

        return inventoryRows.filter((row) => {
            return Object.entries(dimFilters).every(([dimKey, selectedVals]) => {
                const vals = selectedVals as string[];
                if (vals.length === 0) return true;

                let rowVal = '';
                if (dimKey === 'sub_category') rowVal = row.category_2;
                else if (dimKey === 'child_asin') rowVal = row.asin;
                else rowVal = (row as any)[dimKey];

                return vals.includes(String(rowVal));
            });
        });
    }, [inventoryRows, dimFilters]);

    // --- 1. PL / Traffic Logic ---
    const groupedActuals = useMemo(() => {
        if (!isOpen || type === 'Inventory') return [];
        
        const groups: Record<string, { 
            dimensions: Record<string, string>, 
            currentRows: DataRow[], 
            lastRows: DataRow[], 
            yearRows: DataRow[] 
        }> = {};

        const getKey = (row: DataRow) => {
            return selectedDimensions.map(d => {
                if (d === 'year_month') return isWeeklyMode ? formatBusinessWeekFromDateStr(row.date) : row.date.substring(0, 7);
                return row[d] || 'Unknown';
            }).join('|||');
        };

        const process = (rows: DataRow[], type: 'current' | 'last' | 'year') => {
            rows.forEach(r => {
                const key = getKey(r);
                if (!groups[key]) {
                    const dimObj: Record<string, string> = {};
                    selectedDimensions.forEach(d => {
                        if (d === 'year_month') dimObj[d] = isWeeklyMode ? formatBusinessWeekFromDateStr(r.date) : r.date.substring(0, 7);
                        else dimObj[d] = String(r[d] || 'Unknown');
                    });
                    groups[key] = {
                        dimensions: dimObj,
                        currentRows: [],
                        lastRows: [],
                        yearRows: []
                    };
                }
                if (type === 'current') groups[key].currentRows.push(r);
                else if (type === 'last') groups[key].lastRows.push(r);
                else groups[key].yearRows.push(r);
            });
        };

        process(plRowsForSubtable.c, 'current');
        process(plRowsForSubtable.l, 'last');
        process(plRowsForSubtable.y, 'year');

        return Object.keys(groups).map(key => {
            const g = groups[key];
            const sampleRow = g.currentRows[0] || g.lastRows[0] || g.yearRows[0];
            const sampleCountry = sampleRow ? sampleRow.country : 'US';
            
            return {
                compositeKey: key,
                dimensions: g.dimensions,
                current: aggregateData(g.currentRows),
                last: g.lastRows.length ? aggregateData(g.lastRows) : null,
                year: g.yearRows.length ? aggregateData(g.yearRows) : null,
                sampleCountry
            };
        }).sort((a, b) => b.current.sales_amount - a.current.sales_amount);

    }, [isOpen, type, plRowsForSubtable, selectedDimensions, isWeeklyMode]);

    const groupedTargetsMap = useMemo<Map<string, AggregatedData>>(() => {
        if (!isOpen || !period || targetRows.length === 0 || type === 'Inventory') return new Map<string, AggregatedData>();
        const pacing = getPacingRatio(period.start, period.end);
        
        if (isWeeklyMode && selectedDimensions.includes('year_month')) {
            return new Map<string, AggregatedData>();
        }

        return groupTargetsByDimension(targetRows, selectedDimensions as (keyof TargetRow | 'year_month')[], period.start, period.end, pacing);
    }, [isOpen, type, targetRows, period, selectedDimensions, isWeeklyMode]);

    // --- 2. Inventory Logic ---
    const groupedInventoryRaw = useMemo(() => {
        if (!isOpen || type !== 'Inventory') return [];
        const validInvDims = selectedDimensions.filter(d => d !== 'year_month') as string[];
        return groupInventoryByDimension(invRowsForSubtable, validInvDims);
    }, [isOpen, type, invRowsForSubtable, selectedDimensions]);

    // --- 3. Combined & Filtered Data ---
    const finalGroupedData = useMemo(() => {
        let data: any[] = [];

        if (type === 'Inventory') {
            data = groupedInventoryRaw;
        } else {
            data = groupedActuals.map(group => ({
                ...group,
                target: groupedTargetsMap.get(group.compositeKey)
            }));
        }

        // Apply strict filter for 'Ghost Rows' in PL/Traffic Analysis
        // If row has no sales/qty/ad_spend in CURRENT period, filter it out.
        // This prevents items that only existed in last period from appearing as rows.
        if (type !== 'Inventory') {
            data = data.filter(group => {
                if (!group.current) return false;
                // Check if meaningful current data exists
                const hasCurrentData = 
                    group.current.sales_amount > 0 || 
                    group.current.sales_quantity > 0 || 
                    group.current.ad_spend > 0 ||
                    group.current.clicks > 0;
                
                return hasCurrentData;
            });
        }

        if (Object.keys(dimFilters).length > 0) {
            data = data.filter(row => {
                return Object.entries(dimFilters).every(([dimKey, selectedVals]) => {
                    if (!selectedDimensions.includes(dimKey as GroupDimension)) return true;
                    const vals = selectedVals as string[];
                    if (vals.length === 0) return true;
                    const rowVal = row.dimensions[dimKey];
                    return vals.includes(rowVal);
                });
            });
        }

        return data;
    }, [type, groupedActuals, groupedTargetsMap, groupedInventoryRaw, dimFilters, selectedDimensions]);

    // --- 4. Total Data Aggregation ---
    const totalData = useMemo(() => {
        if (finalGroupedData.length === 0) return null;

        if (type === 'Inventory') {
             const inventoryList = finalGroupedData.map(g => g.current as InventoryAggregated);
             
             const totalInventory = inventoryList.reduce((acc, curr) => {
                 const res = { ...acc };
                 (Object.keys(acc) as Array<keyof InventoryAggregated>).forEach(k => {
                     res[k] += curr[k];
                 });
                 return res;
             }, { ...initialInventoryAggregated });

             return { inventory: totalInventory };
        } else {
            const sumObj = (list: AggregatedData[]) => {
                const acc = { ...initialAggregated };
                let totalRatingScore = 0; 
                let totalReviewCountForRating = 0;

                list.forEach(d => {
                    acc.sales_quantity += d.sales_quantity;
                    acc.sales_amount += d.sales_amount;
                    acc.gross_profit += d.gross_profit;
                    acc.fba_sellable_qty += d.fba_sellable_qty;
                    acc.sessions += d.sessions;
                    acc.first_mile_cost += d.first_mile_cost;
                    acc.procurement_cost += d.procurement_cost;
                    acc.storage_fee += d.storage_fee;
                    acc.fba_fee += d.fba_fee;
                    acc.refund_cost += d.refund_cost;
                    acc.platform_commission += d.platform_commission;
                    acc.ad_spend += d.ad_spend;
                    acc.ad_sales += d.ad_sales;
                    acc.ad_orders += d.ad_orders;
                    acc.sp_spend += d.sp_spend;
                    acc.sp_sales += d.sp_sales;
                    acc.sd_spend += d.sd_spend;
                    acc.sd_sales += d.sd_sales;
                    acc.sb_spend += d.sb_spend;
                    acc.sb_sales += d.sb_sales;
                    acc.sbv_spend += d.sbv_spend;
                    acc.sbv_sales += d.sbv_sales;
                    acc.impressions += d.impressions;
                    acc.clicks += d.clicks;
                    acc.natural_orders += d.natural_orders;
                    acc.natural_clicks += d.natural_clicks;
                    acc.review_count += d.review_count;

                    if (d.average_rating > 0 && d.review_count > 0) {
                        totalRatingScore += d.average_rating * d.review_count;
                        totalReviewCountForRating += d.review_count;
                    }
                });
                acc.gross_margin = acc.sales_amount ? acc.gross_profit / acc.sales_amount : 0;
                acc.avg_ticket = acc.sales_quantity ? acc.sales_amount / acc.sales_quantity : 0;
                acc.average_rating = totalReviewCountForRating > 0 ? totalRatingScore / totalReviewCountForRating : 0;

                return acc;
            }
            
            const currentList = finalGroupedData.map(g => g.current).filter(Boolean);
            const lastList = finalGroupedData.map(g => g.last).filter(Boolean);
            const yearList = finalGroupedData.map(g => g.year).filter(Boolean);
            const targetList = finalGroupedData.map(g => g.target).filter(Boolean);

            return {
                current: sumObj(currentList),
                last: lastList.length > 0 ? sumObj(lastList as AggregatedData[]) : null,
                year: yearList.length > 0 ? sumObj(yearList as AggregatedData[]) : null,
                target: targetList.length > 0 ? sumObj(targetList as AggregatedData[]) : null
            };
        }
    }, [finalGroupedData, type]);

    // --- 5. Column Config ---
    const columnConfig = useMemo(() => {
        if (type === 'PL') {
            const plCols = [
                { title: '销量', key: 'sales_quantity', formatter: formatNumber, diffType: 'percent', hasTarget: true, targetDisplayMode: 'both' },
                { title: '销售额', key: 'sales_amount', formatter: formatMoneyNoDecimals, diffType: 'percent', hasTarget: true, targetDisplayMode: 'both' },
                { title: '毛利额', key: 'gross_profit', formatter: formatMoneyNoDecimals, diffType: 'percent', hasTarget: true, targetDisplayMode: 'both' },
                { 
                    title: '毛利率',
                    headerRender: (
                        <div className="flex items-center justify-end gap-1 group">
                            毛利率
                            {onOpenCalculator && (
                                <div title="利润模型试算">
                                    <Calculator 
                                        className="w-3.5 h-3.5 text-blue-400 cursor-pointer hover:text-blue-600 transition-colors"
                                        onClick={(e) => { e.stopPropagation(); onOpenCalculator(); }}
                                    />
                                </div>
                            )}
                        </div>
                    ),
                    key: 'gross_margin', 
                    formatter: formatPercent, 
                    diffType: 'absolute_percent', 
                    hasTarget: true, 
                    targetDisplayMode: 'value', 
                    isInteractive: true, 
                    triggerCalculator: true 
                },
                { title: 'FBA可售', key: 'fba_sellable_qty', formatter: formatNumber, diffType: 'percent' },
                { title: '客单价', key: 'avg_ticket', formatter: formatPrice, diffType: 'percent' },
                { 
                    title: '评分',
                    headerRender: (
                        <div className="flex items-center justify-end gap-1 group">
                            评分
                            {onOpenReviewAnalysis && (
                                <div title="评论舆情分析">
                                    <MessageSquare 
                                        className="w-3.5 h-3.5 text-yellow-400 cursor-pointer hover:text-yellow-600 transition-colors"
                                        onClick={(e) => { e.stopPropagation(); onOpenReviewAnalysis(); }}
                                    />
                                </div>
                            )}
                        </div>
                    ),
                    key: 'average_rating', 
                    formatter: (v: number) => v.toFixed(1), 
                    diffType: 'absolute_val' 
                },
                { title: '头程占比', calculator: (d: AggregatedData) => safeRatio(d.first_mile_cost, d.sales_amount), formatter: formatPercent, diffType: 'absolute_percent' },
                { title: '采购占比', calculator: (d: AggregatedData) => safeRatio(d.procurement_cost, d.sales_amount), formatter: formatPercent, diffType: 'absolute_percent' },
                { title: '仓储占比', calculator: (d: AggregatedData) => safeRatio(d.storage_fee, d.sales_amount), formatter: formatPercent, diffType: 'absolute_percent' },
                { title: 'FBA费占比', calculator: (d: AggregatedData) => safeRatio(d.fba_fee, d.sales_amount), formatter: formatPercent, diffType: 'absolute_percent' },
                { 
                    title: '退款占比',
                    headerRender: (
                        <div className="flex items-center justify-end gap-1 group">
                            退款占比
                            {onOpenRefundAnalysis && (
                                <div title="退货原因分析">
                                    <FileSearch 
                                        className="w-3.5 h-3.5 text-red-400 cursor-pointer hover:text-red-600 transition-colors"
                                        onClick={(e) => { e.stopPropagation(); onOpenRefundAnalysis(); }}
                                    />
                                </div>
                            )}
                        </div>
                    ),
                    calculator: (d: AggregatedData) => safeRatio(d.refund_cost, d.sales_amount), 
                    formatter: formatPercent, 
                    diffType: 'absolute_percent', 
                    isInteractive: true,
                    triggerAction: true 
                },
                { title: '佣金占比', calculator: (d: AggregatedData) => safeRatio(d.platform_commission, d.sales_amount), formatter: formatPercent, diffType: 'absolute_percent' },
                { title: '广告占比', calculator: (d: AggregatedData) => safeRatio(d.ad_spend, d.sales_amount), formatter: formatPercent, diffType: 'absolute_percent' },
            ];
            const plTagCol = { title: '标签', key: 'tags', isDiagnosis: true, formatter: (_n: number) => '—' };
            const plTrendCol = { title: '趋势', key: 'trend', isTrend: true, isInteractive: true, triggerTrend: true };
            if (diagnosisSettings.showTagColumn === true) {
                return [...plCols, plTagCol, plTrendCol];
            }
            return [...plCols, plTrendCol];
        } else if (type === 'Traffic') {
            const trCols = [
                { 
                    title: '广告花费', 
                    key: 'ad_spend', 
                    formatter: formatMoney, 
                    diffType: 'percent', // MoM/YoY for Spend
                    hasTarget: true,
                    targetLabel: '预算',
                    targetDisplayMode: 'both',
                    reverseColor: true
                },
                { title: '广告销售', key: 'ad_sales', formatter: formatMoneyNoDecimals, diffType: 'percent' },
                { title: 'SP花费', key: 'sp_spend', formatter: formatMoney, diffType: 'percent' },
                { title: 'SP销售', key: 'sp_sales', formatter: formatMoneyNoDecimals, diffType: 'percent' },
                { title: 'SD花费', key: 'sd_spend', formatter: formatMoney, diffType: 'percent' },
                { title: 'SD销售', key: 'sd_sales', formatter: formatMoneyNoDecimals, diffType: 'percent' },
                { title: 'SB花费', key: 'sb_spend', formatter: formatMoney, diffType: 'percent' },
                { title: 'SB销售', key: 'sb_sales', formatter: formatMoneyNoDecimals, diffType: 'percent' },
                { title: 'SBV花费', key: 'sbv_spend', formatter: formatMoney, diffType: 'percent' },
                { title: 'SBV销售', key: 'sbv_sales', formatter: formatMoneyNoDecimals, diffType: 'percent' },
                { title: '展示量', key: 'impressions', formatter: formatNumber, diffType: 'percent' },
                { title: '点击量', key: 'clicks', formatter: formatNumber, diffType: 'percent' },
                { title: '广告CVR', calculator: (d: AggregatedData) => safeRatio(d.ad_orders, d.clicks), formatter: formatPercent, diffType: 'absolute_percent' },
                { title: 'CTR', calculator: (d: AggregatedData) => safeRatio(d.clicks, d.impressions), formatter: formatPercent, diffType: 'absolute_percent' },
                { title: '自然CVR', calculator: getNaturalCVR, formatter: formatPercent, diffType: 'absolute_percent' },
                { title: 'CPC', calculator: (d: AggregatedData) => safeRatio(d.ad_spend, d.clicks), formatter: (v: number) => `$${v.toFixed(2)}`, diffType: 'absolute_val' },
                { title: 'ACoS', calculator: (d: AggregatedData) => safeRatio(d.ad_spend, d.ad_sales), formatter: formatPercent, diffType: 'absolute_percent' },
                { title: 'ASoAS (广告订单占比)', calculator: (d: AggregatedData) => safeRatio(d.ad_orders, d.sales_quantity), formatter: formatPercent, diffType: 'absolute_percent' },
            ];
            const trTagCol = { title: '标签', key: 'tags', isDiagnosis: true, formatter: (_n: number) => '—' };
            const trTrendCol = { title: '趋势', key: 'trend', isTrend: true, isInteractive: true, triggerTrend: true };
            if (diagnosisSettings.showTagColumn === true) {
                return [...trCols, trTagCol, trTrendCol];
            }
            return [...trCols, trTrendCol];
        } else {
             // Inventory
             return [
                 { title: 'FBA总库存', key: 'fba_total_qty', subKey: 'fba_total_cost', formatter: formatNumber, subFormatter: formatRMB },
                 { title: '30天内', key: 'age_0_30_qty', subKey: 'age_0_30_cost', formatter: formatNumber, subFormatter: formatRMB, isPercentBase: true },
                 { title: '31-60天', key: 'age_31_60_qty', subKey: 'age_31_60_cost', formatter: formatNumber, subFormatter: formatRMB, isPercentBase: true },
                 { title: '61-90天', key: 'age_61_90_qty', subKey: 'age_61_90_cost', formatter: formatNumber, subFormatter: formatRMB, isPercentBase: true },
                 { title: '91-180天', key: 'age_91_180_qty', subKey: 'age_91_180_cost', formatter: formatNumber, subFormatter: formatRMB, isPercentBase: true },
                 { title: '181-270天', key: 'age_181_270_qty', subKey: 'age_181_270_cost', formatter: formatNumber, subFormatter: formatRMB, isPercentBase: true },
                 { title: '271-330天', key: 'age_271_330_qty', subKey: 'age_271_330_cost', formatter: formatNumber, subFormatter: formatRMB, isPercentBase: true },
                 { title: '331-365天', key: 'age_331_365_qty', subKey: 'age_331_365_cost', formatter: formatNumber, subFormatter: formatRMB, isPercentBase: true },
                 { title: '365天+', key: 'age_365_plus_qty', subKey: 'age_365_plus_cost', formatter: formatNumber, subFormatter: formatRMB, isPercentBase: true },
             ];
        }
    }, [type, onOpenCalculator, onOpenRefundAnalysis, onOpenReviewAnalysis, diagnosisSettings.showTagColumn]);

    const mergedTrendColumns: TrendColumn[] = useMemo(() => {
        if (type === 'Inventory') return [];
        const mapSrc = (src: typeof PL_TREND_METRICS_SOURCE, metricGroup: 'result' | 'process'): TrendColumn[] =>
            src.map(c => ({
                title: typeof c.title === 'string' ? c.title : String(c.key || ''),
                key: c.key,
                calculator: c.calculator,
                isPercent: c.formatter === formatPercent || c.diffType === 'absolute_percent',
                isMoney: c.formatter === formatMoney || c.formatter === formatMoneyNoDecimals || c.formatter === formatPrice,
                metricGroup
            }));
        const mapTarget = (src: typeof TARGET_TREND_METRICS_SOURCE): TrendColumn[] =>
            src.map(c => ({
                title: c.title,
                shortLabel: c.shortLabel,
                dataKey: c.dataKey,
                isPercent: c.isPercent,
                isMoney: c.isMoney,
                metricGroup: 'target' as const
            }));
        return [...mapSrc(PL_TREND_METRICS_SOURCE, 'result'), ...mapSrc(TRAFFIC_TREND_METRICS_SOURCE, 'process'), ...mapTarget(TARGET_TREND_METRICS_SOURCE)];
    }, [type]);

    const visibleGroupKeys = useMemo(() => {
        if (type === 'Inventory') return [];
        return finalGroupedData.map((g: { dimensions: Record<string, string> }) =>
            selectedDimensions.map(d => String(g.dimensions[d] ?? '')).join('|||')
        );
    }, [type, finalGroupedData, selectedDimensions]);

    const trendScope: TrendChartScope = useMemo(() => {
        if (trendFromTotal) {
            return {
                mode: 'total',
                dimFilters,
                selectedDimensions: selectedDimensions as string[],
                visibleGroupKeys
            };
        }
        return { mode: 'dimensions', dimensions: trendDimensions };
    }, [trendFromTotal, dimFilters, selectedDimensions, visibleGroupKeys, trendDimensions]);

    // --- Helper for Dynamic Value Access ---
    const getValue = (data: AggregatedData | null, col: any) => {
        if (col.isDiagnosis) return 0;
        if (!data) return 0;
        if (col.calculator) return col.calculator(data);
        return (data as any)[col.key] || 0;
    };

    const escapeHtml = (s: string) =>
        s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const tsvEscapeCell = (s: string) => {
        if (/[\t\n\r"]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
    };

    const formatDiffForCopy = (curr: number, base: number | undefined, diffType: string): string | null => {
        if (base === undefined || base === null) return null;
        // 复制到飞书/纯文本：基期为 0 时输出 New / — 而不是 0.00%
        if (diffType === 'percent' && base === 0) {
            return curr > 0 ? 'New' : '—';
        }
        const val = (diffType === 'absolute_percent' || diffType === 'absolute_val')
            ? curr - base
            : (curr - base) / base;
        const isPos = val > 0;
        const icon = isPos ? '↑' : (val === 0 ? '' : '↓');
        const txt = diffType === 'absolute_val' ? val.toFixed(2) : (val * 100).toFixed(2) + '%';
        return `${icon}${txt}`;
    };

    const formatTargetForCopy = (curr: number, target: number, config: any): string | null => {
        if (!target && target !== 0) return null;
        if (isWeeklyMode) return null;
        const fmt = config.formatter;
        const pct = target !== 0 ? curr / target : 0;
        const label = config.targetLabel || '目标';
        const valStr = fmt(target);
        const pctStr = (pct * 100).toFixed(0) + '%';
        if (config.targetDisplayMode === 'both') return `${label}: ${valStr} (${pctStr})`;
        if (config.targetDisplayMode === 'value') return `${label}: ${valStr}`;
        return `${label}: ${pctStr}`;
    };

    /** 飞书/Word 粘贴：用行内样式保留涨跌颜色（与 renderDiff / renderTarget 一致） */
    const COPY = {
        green: '#16a34a',
        red: '#ef4444',
        orange: '#f97316',
        blue: '#2563eb',
        slate300: '#cbd5e1',
        slate400: '#94a3b8',
        slate500: '#64748b',
        slate600: '#475569',
        slate700: '#334155',
        slate800: '#1e293b',
        slate900: '#0f172a',
        headerBg: '#f1f5f9',
        footerBg: '#f8fafc',
        border: '#e2e8f0',
    } as const;

    const diffHtmlFragment = (curr: number, base: number | undefined, diffType: string): string | null => {
        if (base === undefined || base === null) return null;
        // 复制到飞书的 HTML 片段：基期为 0 时同样使用 New / — 文案
        if (diffType === 'percent' && base === 0) {
            const color = curr > 0 ? COPY.green : COPY.slate400;
            const label = curr > 0 ? 'New' : '—';
            return `<span style="color:${color};font-family:ui-monospace,monospace;font-weight:600;">${escapeHtml(label)}</span>`;
        }
        const val = (diffType === 'absolute_percent' || diffType === 'absolute_val')
            ? curr - base
            : (curr - base) / base;
        const isPos = val > 0;
        const color = isPos ? COPY.green : val === 0 ? COPY.slate400 : COPY.red;
        const txt = diffType === 'absolute_val' ? val.toFixed(2) : (val * 100).toFixed(2) + '%';
        const icon = isPos ? '↑' : val === 0 ? '' : '↓';
        return `<span style="color:${color};font-family:ui-monospace,monospace;font-weight:600;">${escapeHtml(icon + txt)}</span>`;
    };

    const targetBlockHtml = (curr: number, target: number, config: any, isTotalRow: boolean): string | null => {
        if (!target && target !== 0) return null;
        if (isWeeklyMode) return null;
        const fmt = config.formatter;
        const pct = target !== 0 ? curr / target : 0;
        const isReverse = !!config.reverseColor;
        let pctColor = COPY.slate500;
        if (isReverse) {
            pctColor = pct > 1.05 ? COPY.red : pct > 0.9 ? COPY.orange : COPY.blue;
        } else {
            pctColor = pct >= 1 ? COPY.green : COPY.orange;
        }
        const label = config.targetLabel || '目标';
        const valStr = escapeHtml(fmt(target));
        const pctStr = escapeHtml((pct * 100).toFixed(0) + '%');
        const borderColor = isTotalRow ? COPY.slate300 : COPY.border;
        const tgtBase =
            `display:block;margin:0;padding:4px 0 0 0;border-top:1px solid ${borderColor};font-size:11px;color:${COPY.slate500};white-space:nowrap;text-align:center;line-height:1.45;`;

        if (config.targetDisplayMode === 'both') {
            return `<div style="${tgtBase}">` +
                `<span>${escapeHtml(label)}:</span> ` +
                `<span style="color:${COPY.slate400};">${valStr}</span> ` +
                `<span style="color:${pctColor};font-weight:700;font-family:ui-monospace,monospace;">(${pctStr})</span></div>`;
        }
        if (config.targetDisplayMode === 'value') {
            return `<div style="${tgtBase}">` +
                `<span>${escapeHtml(label)}:</span> ` +
                `<span style="color:${COPY.slate600};font-family:ui-monospace,monospace;">${valStr}</span></div>`;
        }
        return `<div style="${tgtBase}">` +
            `<span>${escapeHtml(label)}:</span> ` +
            `<span style="color:${pctColor};font-family:ui-monospace,monospace;font-weight:600;">${pctStr}</span></div>`;
    };

    /** 与界面单元格信息一致，生成多行文案；剪贴板 HTML 用 <br> 拼接，TSV 用「 | 」压成一行避免列错位 */
    const buildCellLinesForCopy = (
        current: AggregatedData | InventoryAggregated,
        last: AggregatedData | null | undefined,
        year: AggregatedData | null | undefined,
        target: AggregatedData | null | undefined,
        col: any,
        structureVal: number | null,
        isInventory: boolean
    ): string[] => {
        if (col.isDiagnosis && (type === 'PL' || type === 'Traffic')) {
            const tags = computeSubtableRowDiagnosis({
                subType: type,
                settings: diagnosisSettings,
                isWeekly: !!isWeeklyMode,
                current: current as AggregatedData,
                last: last as AggregatedData | null | undefined,
                year: year as AggregatedData | null | undefined,
                target: target as AggregatedData | null | undefined,
                columnConfig: columnConfig as any[],
            });
            // 飞书/Excel：单元格内换行；tsvEscapeCell 会对含换行的字段加引号
            return [tags.length > 0 ? tags.map((t) => t.text).join('\n') : '—'];
        }
        if (col.isTrend) return ['—'];

        const currVal = getValue(current as AggregatedData, col);
        const lastVal = getValue(last as AggregatedData, col);
        const yearVal = getValue(year as AggregatedData, col);
        const targetVal = target ? getValue(target, col) : undefined;
        const displayVal = col.formatter(currVal);

        let subLine: string | null = null;
        if (isInventory && col.subKey) {
            const subVal = (current as any)[col.subKey];
            subLine = String(col.subFormatter(subVal));
        }

        if (isInventory && showStructure && col.isPercentBase) {
            const invData = current as InventoryAggregated;
            const qtyBase = invData.fba_total_qty || 1;
            const costBase = invData.fba_total_cost || 1;
            const qtyVal = (invData as any)[col.key] || 0;
            const qtyPct = qtyVal / qtyBase;
            const costVal = col.subKey ? ((invData as any)[col.subKey] || 0) : 0;
            const costPct = col.subKey ? costVal / costBase : 0;
            const lines = [`数量占比 ${(qtyPct * 100).toFixed(1)}%`];
            if (col.subKey) lines.push(`成本占比 ${(costPct * 100).toFixed(1)}%`);
            return lines;
        }

        if (!isInventory && showStructure && structureVal !== null) {
            return [`${(structureVal * 100).toFixed(1)}%`];
        }

        const lines: string[] = [String(displayVal)];
        if (subLine) lines.push(subLine);

        if (!isInventory) {
            const momLabel = isWeeklyMode ? '周环' : '环';
            const yoyLabel = isWeeklyMode ? '周同' : '同';
            if (last !== undefined && last !== null) {
                const d = formatDiffForCopy(currVal, lastVal, col.diffType);
                if (d) lines.push(`${momLabel}: ${d}`);
            }
            if (year !== undefined && year !== null) {
                const d = formatDiffForCopy(currVal, yearVal, col.diffType);
                if (d) lines.push(`${yoyLabel}: ${d}`);
            }
            if (col.hasTarget && target && targetVal !== undefined) {
                const t = formatTargetForCopy(currVal, targetVal, col);
                if (t) lines.push(t);
            }
        }
        return lines;
    };

    /** 富文本粘贴：与界面一致的颜色、加粗、分行（飞书识别行内 style 较好） */
    const buildCellHtmlForCopy = (
        current: AggregatedData | InventoryAggregated,
        last: AggregatedData | null | undefined,
        year: AggregatedData | null | undefined,
        target: AggregatedData | null | undefined,
        col: any,
        structureVal: number | null,
        isInventory: boolean,
        isTotalRow: boolean
    ): string => {
        const cellWrap = (inner: string) =>
            `<div style="text-align:center;font-family:ui-monospace,SFMono-Regular,monospace;">${inner}</div>`;
        /** 飞书对 td 内 div 常按行内排版；display:block + 行间显式 <br/> 双保险 */
        const rowLine = (extraCss: string, inner: string) =>
            `<div style="display:block;text-align:center;line-height:1.45;margin:0;padding:0;${extraCss}">${inner}</div>`;

        if (col.isTrend) {
            return cellWrap(rowLine(`color:${COPY.slate400};`, '—'));
        }
        if (col.isDiagnosis && (type === 'PL' || type === 'Traffic')) {
            const tags = computeSubtableRowDiagnosis({
                subType: type,
                settings: diagnosisSettings,
                isWeekly: !!isWeeklyMode,
                current: current as AggregatedData,
                last: last as AggregatedData | null | undefined,
                year: year as AggregatedData | null | undefined,
                target: target as AggregatedData | null | undefined,
                columnConfig: columnConfig as any[],
            });
            if (tags.length === 0) {
                return cellWrap(rowLine(`color:${COPY.slate400};font-size:11px;`, '—'));
            }
            const blocks = tags.map((t) => {
                const c = t.tone === 'red' ? COPY.red : COPY.green;
                return rowLine(`color:${c};font-weight:600;font-size:11px;`, escapeHtml(t.text));
            });
            return cellWrap(blocks.join('<br/>'));
        }

        const currVal = getValue(current as AggregatedData, col);
        const lastVal = getValue(last as AggregatedData, col);
        const yearVal = getValue(year as AggregatedData, col);
        const targetVal = target ? getValue(target, col) : undefined;
        const displayVal = col.formatter(currVal);
        const mainColor = isTotalRow ? COPY.slate900 : COPY.slate700;
        const mainSize = isTotalRow ? '15px' : '14px';
        const lineMuted = isTotalRow ? COPY.slate500 : COPY.slate400;

        let subLine: string | null = null;
        if (isInventory && col.subKey) {
            const subVal = (current as any)[col.subKey];
            subLine = String(col.subFormatter(subVal));
        }

        if (isInventory && showStructure && col.isPercentBase) {
            const invData = current as InventoryAggregated;
            const qtyBase = invData.fba_total_qty || 1;
            const costBase = invData.fba_total_cost || 1;
            const qtyVal = (invData as any)[col.key] || 0;
            const qtyPct = qtyVal / qtyBase;
            const costVal = col.subKey ? ((invData as any)[col.subKey] || 0) : 0;
            const costPct = col.subKey ? costVal / costBase : 0;
            const blocks = [
                rowLine(`font-weight:700;color:${COPY.blue};font-size:14px;`, `${(qtyPct * 100).toFixed(1)}%`),
            ];
            if (col.subKey) {
                blocks.push(
                    rowLine(`font-size:11px;color:${COPY.blue};opacity:0.85;`, `${(costPct * 100).toFixed(1)}%`)
                );
            }
            return cellWrap(blocks.join('<br/>'));
        }

        if (!isInventory && showStructure && structureVal !== null) {
            return cellWrap(
                rowLine(`font-weight:700;color:${COPY.slate700};font-size:14px;`, `${(structureVal * 100).toFixed(1)}%`)
            );
        }

        const blocks: string[] = [
            rowLine(
                `font-weight:700;color:${mainColor};font-size:${mainSize};`,
                escapeHtml(String(displayVal))
            ),
        ];
        if (subLine) {
            blocks.push(rowLine(`font-size:11px;color:${COPY.slate500};`, escapeHtml(subLine)));
        }

        if (!isInventory) {
            const momLabel = isWeeklyMode ? '周环' : '环';
            const yoyLabel = isWeeklyMode ? '周同' : '同';
            if (last !== undefined && last !== null) {
                const frag = diffHtmlFragment(currVal, lastVal, col.diffType);
                if (frag) {
                    blocks.push(
                        rowLine(
                            `font-size:11px;color:${lineMuted};`,
                            `<span style="opacity:0.75;">${escapeHtml(momLabel)}:</span> ${frag}`
                        )
                    );
                }
            }
            if (year !== undefined && year !== null) {
                const frag = diffHtmlFragment(currVal, yearVal, col.diffType);
                if (frag) {
                    blocks.push(
                        rowLine(
                            `font-size:11px;color:${lineMuted};`,
                            `<span style="opacity:0.75;">${escapeHtml(yoyLabel)}:</span> ${frag}`
                        )
                    );
                }
            }
            if (col.hasTarget && target && targetVal !== undefined) {
                const tb = targetBlockHtml(currVal, targetVal, col, isTotalRow);
                if (tb) blocks.push(tb);
            }
        }

        return cellWrap(blocks.join('<br/>'));
    };

    const tdStyle = (isFooter: boolean) =>
        `border:1px solid ${COPY.border};padding:8px 10px;vertical-align:middle;text-align:center;background:${isFooter ? COPY.footerBg : '#ffffff'};white-space:normal;word-wrap:break-word;`;
    const thStyle = () =>
        `background:${COPY.headerBg};font-weight:700;color:${COPY.slate600};border:1px solid ${COPY.border};padding:8px 10px;text-align:center;font-size:12px;`;

    // --- 6. Sorting ---
    const sortedData = useMemo(() => {
        if (!sortConfig) return finalGroupedData;
        const { colIndex, direction } = sortConfig;
        
        return [...finalGroupedData].sort((a, b) => {
             if (colIndex < 0) {
                 const dimIndex = Math.abs(colIndex) - 1;
                 const dimKey = selectedDimensions[dimIndex];
                 const valA = String(a.dimensions[dimKey] || '');
                 const valB = String(b.dimensions[dimKey] || '');
                 return direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
             } else {
                 const col = columnConfig[colIndex];
                 if (col.isDiagnosis && (type === 'PL' || type === 'Traffic')) {
                     const sub = type as 'PL' | 'Traffic';
                     const score = (row: (typeof finalGroupedData)[number]) =>
                         getDiagnosisSortKey(
                             computeSubtableRowDiagnosis({
                                 subType: sub,
                                 settings: diagnosisSettings,
                                 isWeekly: !!isWeeklyMode,
                                 current: row.current,
                                 last: row.last,
                                 year: row.year,
                                 target: row.target,
                                 columnConfig: columnConfig as any[],
                             })
                         );
                     const sA = score(a);
                     const sB = score(b);
                     return direction === 'asc' ? sA - sB : sB - sA;
                 }
                 const valA = getValue(a.current, col);
                 const valB = getValue(b.current, col);
                 return direction === 'asc' ? valA - valB : valB - valA;
             }
        });
    }, [finalGroupedData, sortConfig, columnConfig, selectedDimensions, type, diagnosisSettings, isWeeklyMode]);

    const parentAsinSubtableTreeFold = useMemo(
        () =>
            selectedDimensions.includes('parent_asin') &&
            (selectedDimensions.includes('child_asin') || selectedDimensions.includes('product_name')),
        [selectedDimensions]
    );

    const [expandedParentAsinKeys, setExpandedParentAsinKeys] = useState<string[]>([]);

    /** 父 +（子ASIN 与/或 品名）折叠表：分桶时忽略「子ASIN+品名」的取值差异，父行两列可显示「共 n…」，子行在对应列下缩进展示 */
    const subtableViewFlat = useMemo(() => {
        type T = (typeof sortedData)[number];

        const makeParent = (g: T[]): T => {
            const f = g[0];
            const n = g.length;
            const nextDims: Record<string, string> = { ...f.dimensions };
            if (selectedDimensions.includes('child_asin')) nextDims.child_asin = `共 ${n} 子ASIN`;
            if (selectedDimensions.includes('product_name')) nextDims.product_name = `共 ${n} 品名`;
            if (type === 'Inventory') {
                return {
                    ...f,
                    dimensions: nextDims,
                    current: sumInventoryAggregated(g.map(c => c.current as InventoryAggregated))
                } as T;
            }
            const current = sumAggregatedData(g.map(c => c.current as AggregatedData));
            const lasts = g.map(c => c.last).filter(Boolean) as AggregatedData[];
            const years = g.map(c => c.year).filter(Boolean) as AggregatedData[];
            const targs = g.map(c => c.target).filter((x): x is AggregatedData => x != null);
            return {
                ...f,
                dimensions: nextDims,
                current,
                last: lasts.length ? sumAggregatedData(lasts) : null,
                year: years.length ? sumAggregatedData(years) : null,
                target: targs.length ? sumAggregatedData(targs) : undefined
            } as T;
        };

        if (!parentAsinSubtableTreeFold) {
            return sortedData.map((row) => ({ kind: 'flat' as const, row }));
        }

        const keyOf = (r: T) =>
            selectedDimensions
                .map((d) =>
                    d === 'child_asin' || d === 'product_name'
                        ? '—'
                        : String((r as T).dimensions[d] ?? 'Unknown')
                )
                .join('|||');

        const m = new Map<string, T[]>();
        const order: string[] = [];
        for (const row of sortedData) {
            const k = keyOf(row);
            if (!m.has(k)) {
                m.set(k, []);
                order.push(k);
            }
            m.get(k)!.push(row);
        }

        const out: Array<
            { kind: 'flat'; row: T } | { kind: 'parent'; groupKey: string; parentRow: T; children: T[] } | { kind: 'sub'; groupKey: string; row: T; children: T[] }
        > = [];
        for (const k of order) {
            const g = m.get(k)!;
            if (g.length < 2) {
                out.push({ kind: 'flat', row: g[0] });
                continue;
            }
            out.push({ kind: 'parent', groupKey: k, parentRow: makeParent(g), children: g });
            if (expandedParentAsinKeys.includes(k)) {
                g.forEach((r) => out.push({ kind: 'sub', groupKey: k, row: r, children: g }));
            }
        }
        return out;
    }, [sortedData, parentAsinSubtableTreeFold, selectedDimensions, expandedParentAsinKeys, type]);

    const runSubtableAi = async () => {
        if (type === 'Inventory') return;
        if (!hasConfiguredAiApi()) {
            setAiError(`未配置 API。${AI_API_SETUP_HINT}`);
            return;
        }
        setAiLoading(true);
        setAiError('');
        try {
            const configKey = type === 'PL' ? SUBTABLE_PL_AI_KEY : SUBTABLE_TRAFFIC_AI_KEY;
            const settings = getActivePromptSettings(configKey, DEFAULT_SUBTABLE_AI_SYSTEM, DEFAULT_SUBTABLE_AI_TEMPLATE);

            const scopeLines: string[] = [];
            scopeLines.push(`分析类型: ${type === 'PL' ? 'P&L 业绩子表' : '流量与广告子表'}`);
            if (period) scopeLines.push(`主界面时间段: ${formatDate(period.start)} 至 ${formatDate(period.end)}`);
            scopeLines.push(`周度模式: ${isWeeklyMode ? '是' : '否'}`);
            scopeLines.push(`子表拆解维度: ${selectedDimensions.map(d => DIMENSION_OPTIONS.find(o => o.key === d)?.label || d).join('、')}`);
            const filterParts = (Object.entries(dimFilters) as [string, string[]][])
                .filter(([, v]) => v.length > 0)
                .map(([k, v]) => {
                    const lab = DIMENSION_OPTIONS.find(o => o.key === k)?.label || k;
                    return `${lab} 仅保留: ${v.slice(0, 20).join('、')}${v.length > 20 ? ` 等共${v.length}项` : ''}`;
                });
            scopeLines.push(filterParts.length > 0 ? `列头筛选: ${filterParts.join('；')}` : '列头筛选: 无（包含当前维度下全部聚合行）');
            if (subtableBulkExactTokens.length > 0) {
                const qLabel = SUBTABLE_QUICK_FILTER_OPTIONS.find((o) => o.key === subtableQuickKey)?.label || subtableQuickKey;
                const sample = subtableBulkExactTokens.slice(0, 12).join('、');
                scopeLines.push(
                    `多项精确搜索(且，先筛明细再汇总): 字段=${qLabel}，共 ${subtableBulkExactTokens.length} 项；示例：${sample}${subtableBulkExactTokens.length > 12 ? '…' : ''}`
                );
            } else if (subtableQuickText.trim()) {
                const qLabel = SUBTABLE_QUICK_FILTER_OPTIONS.find((o) => o.key === subtableQuickKey)?.label || subtableQuickKey;
                scopeLines.push(`顶部词筛(且，先筛明细再汇总): ${qLabel} 含「${subtableQuickText.trim().slice(0, 80)}${subtableQuickText.trim().length > 80 ? '…' : ''}」`);
            }
            scopeLines.push(`参与分析的行数（筛选并排序后）: ${sortedData.length}`);

            const metricsCols = columnConfig.filter((c: any) => !c.isTrend && !c.isDiagnosis);
            const MAX_ROWS = 220;
            const slice = sortedData.slice(0, MAX_ROWS);
            const rowText = slice.map((row, i) => {
                const dimStr = selectedDimensions
                    .map(d => `${DIMENSION_OPTIONS.find(o => o.key === d)?.label || d}=${row.dimensions[d] ?? '-'}`)
                    .join('；');
                const metricStr = metricsCols
                    .map((col: any) => {
                        const title = typeof col.title === 'string' ? col.title : String(col.key || '');
                        const v = getValue(row.current, col);
                        try {
                            return `${title}=${col.formatter ? col.formatter(v) : String(v)}`;
                        } catch {
                            return `${title}=${String(v)}`;
                        }
                    })
                    .join(' | ');
                return `【第 ${i + 1} 行】${dimStr}\n   指标: ${metricStr}`;
            }).join('\n\n');

            let dataBlock = `### 范围说明\n${scopeLines.join('\n')}\n\n### 明细（每行对应子表中的一条汇总）\n${rowText || '（无数据行）'}`;
            if (sortedData.length > MAX_ROWS) {
                dataBlock += `\n\n> 共 ${sortedData.length} 行，以上为前 ${MAX_ROWS} 行（与 API 长度限制平衡）。`;
            }

            const tpl = settings.template || DEFAULT_SUBTABLE_AI_TEMPLATE;
            const finalPrompt = tpl.replace(/\{\{DATA\}\}/g, dataBlock);

            const text = await unifiedGenerateContent({
                systemInstruction: settings.system,
                contents: finalPrompt,
            });
            setAiReport(text || '');
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            setAiError(msg);
        } finally {
            setAiLoading(false);
        }
    };

    // --- Virtual Scrolling State ---
    useEffect(() => {
        setVisibleCount(50);
        setExpandedParentAsinKeys([]);
        if(tableContainerRef.current) tableContainerRef.current.scrollTop = 0;
    }, [sortedData]);

    const handleScroll = () => {
        if (tableContainerRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = tableContainerRef.current;
            if (scrollTop + clientHeight >= scrollHeight - 400) {
                setVisibleCount((prev) => {
                    if (prev >= subtableViewFlat.length) return prev;
                    return prev + 50;
                });
            }
        }
    };

    // --- 7. 复制表格（飞书 / Excel 友好：TSV + HTML）---
    const handleCopyTableForFeishu = async () => {
        if (sortedData.length === 0) return;
        setCopyFeishuHint('idle');

        const dimHeaders = selectedDimensions.map((d) =>
            d === 'year_month' ? timeLabel : DIMENSION_OPTIONS.find((opt) => opt.key === d)?.label || d
        );
        const metricHeaders = columnConfig.map((c: any) => (typeof c.title === 'string' ? c.title : String(c.key || '')));
        const headers = [...dimHeaders, ...metricHeaders];

        const structureValForRow = (row: (typeof sortedData)[number], col: any): number | null => {
            if (type === 'PL' && showStructure) {
                const currVal = getValue(row.current, col);
                if (['头程占比', '采购占比', '仓储占比', 'FBA费占比', '退款占比', '佣金占比', '广告占比'].includes(col.title)) {
                    return currVal;
                }
                if (col.key === 'sales_amount' || col.key === 'sales_quantity') {
                    const grandTotal = getValue(totalData?.current, col);
                    return grandTotal ? currVal / grandTotal : 0;
                }
            }
            return null;
        };

        const allPlainRows: string[] = [];
        const allHtmlRows: string[] = [];

        /** 复制到飞书：销量/销售额/毛利额 列宽为其它指标列的 1.4 倍（飞书常忽略零散 style，需 colgroup + 每列 width 属性 + fixed 布局） */
        const CLIPBOARD_DIM_COL_W = 108;
        const CLIPBOARD_METRIC_COL_BASE_W = 100;
        const CLIPBOARD_WIDE_METRIC_TITLES = new Set(['销量', '销售额', '毛利额']);
        const clipboardMetricColW = (headerTitle: string) =>
            CLIPBOARD_WIDE_METRIC_TITLES.has(headerTitle)
                ? Math.round(CLIPBOARD_METRIC_COL_BASE_W * 1.4)
                : CLIPBOARD_METRIC_COL_BASE_W;
        const clipboardMetricIsWide = (headerTitle: string) => CLIPBOARD_WIDE_METRIC_TITLES.has(headerTitle);
        const clipboardThMetric = (headerTitle: string) => {
            const w = clipboardMetricColW(headerTitle);
            const widePad = clipboardMetricIsWide(headerTitle) ? 'padding-left:14px;padding-right:14px;' : '';
            return `<th width="${w}" style="${thStyle()}width:${w}px;min-width:${w}px;max-width:${w}px;box-sizing:border-box;${widePad}">${escapeHtml(headerTitle)}</th>`;
        };
        const clipboardTdDim = (cellInner: string) =>
            `<td width="${CLIPBOARD_DIM_COL_W}" style="${tdStyle(false)}width:${CLIPBOARD_DIM_COL_W}px;min-width:${CLIPBOARD_DIM_COL_W}px;max-width:${CLIPBOARD_DIM_COL_W}px;box-sizing:border-box;">${cellInner}</td>`;
        const clipboardTdMetric = (mTitle: string, cellInner: string, isFooter: boolean) => {
            const w = clipboardMetricColW(mTitle);
            const widePad = clipboardMetricIsWide(mTitle) ? 'padding-left:14px;padding-right:14px;' : '';
            return `<td width="${w}" style="${tdStyle(isFooter)}width:${w}px;min-width:${w}px;max-width:${w}px;box-sizing:border-box;${widePad}">${cellInner}</td>`;
        };

        const clipboardTableTotalW =
            selectedDimensions.length * CLIPBOARD_DIM_COL_W +
            columnConfig.reduce((sum, col: any) => {
                const t = typeof col.title === 'string' ? col.title : String(col.key || '');
                return sum + clipboardMetricColW(t);
            }, 0);

        allPlainRows.push(headers.map(tsvEscapeCell).join('\t'));
        const headerHtml =
            '<tr>' +
            dimHeaders.map((h) => `<th width="${CLIPBOARD_DIM_COL_W}" style="${thStyle()}width:${CLIPBOARD_DIM_COL_W}px;min-width:${CLIPBOARD_DIM_COL_W}px;max-width:${CLIPBOARD_DIM_COL_W}px;box-sizing:border-box;">${escapeHtml(h)}</th>`).join('') +
            metricHeaders.map((h) => clipboardThMetric(h)).join('') +
            '</tr>';

        for (const row of sortedData) {
            const lastR = type !== 'Inventory' ? row.last : null;
            const yearR = type !== 'Inventory' ? row.year : null;
            const targetR = type !== 'Inventory' ? row.target : null;

            const plainDims = selectedDimensions.map((d) => String(row.dimensions[d] ?? '-'));
            const plainMetrics = columnConfig.map((col: any) =>
                buildCellLinesForCopy(row.current, lastR, yearR, targetR, col, structureValForRow(row, col), type === 'Inventory').join(
                    ' | '
                )
            );
            allPlainRows.push([...plainDims, ...plainMetrics].map(tsvEscapeCell).join('\t'));

            const dimTds = selectedDimensions.map((d) => {
                const t = String(row.dimensions[d] ?? '-');
                const inner = `<div style="font-weight:500;color:${COPY.slate700};font-size:13px;text-align:center;">${escapeHtml(t)}</div>`;
                return clipboardTdDim(inner);
            });
            const metricTds = columnConfig.map((col: any) => {
                const mTitle = typeof col.title === 'string' ? col.title : String(col.key || '');
                const inner = buildCellHtmlForCopy(row.current, lastR, yearR, targetR, col, structureValForRow(row, col), type === 'Inventory', false);
                const wrapped = clipboardMetricIsWide(mTitle)
                    ? `<div style="display:block;min-width:${clipboardMetricColW(mTitle)}px;width:100%;box-sizing:border-box;">${inner}</div>`
                    : inner;
                return clipboardTdMetric(mTitle, wrapped, false);
            });
            allHtmlRows.push(`<tr>${dimTds.join('')}${metricTds.join('')}</tr>`);
        }

        if (totalData && sortedData.length > 0) {
            const footDimPlain = ['总计 (Total)', ...Array(Math.max(0, selectedDimensions.length - 1)).fill('')];
            const current = type === 'Inventory' ? totalData.inventory : totalData.current;
            const last = type !== 'Inventory' ? totalData.last : null;
            const year = type !== 'Inventory' ? totalData.year : null;
            const target = type !== 'Inventory' ? totalData.target : null;
            const plainMetrics = columnConfig.map((col: any) =>
                buildCellLinesForCopy(current, last, year, target, col, null, type === 'Inventory').join(' | ')
            );
            allPlainRows.push([...footDimPlain, ...plainMetrics].map(tsvEscapeCell).join('\t'));

            const footerMetricTds = columnConfig.map((col: any) => {
                const mTitle = typeof col.title === 'string' ? col.title : String(col.key || '');
                const inner = buildCellHtmlForCopy(current, last, year, target, col, null, type === 'Inventory', true);
                const wrapped = clipboardMetricIsWide(mTitle)
                    ? `<div style="display:block;min-width:${clipboardMetricColW(mTitle)}px;width:100%;box-sizing:border-box;">${inner}</div>`
                    : inner;
                return clipboardTdMetric(mTitle, wrapped, true);
            });
            const colspan = selectedDimensions.length;
            const footerDimSpanW = colspan * CLIPBOARD_DIM_COL_W;
            allHtmlRows.push(
                `<tr>` +
                    `<td colspan="${colspan}" width="${footerDimSpanW}" style="${tdStyle(true)}width:${footerDimSpanW}px;min-width:${footerDimSpanW}px;max-width:${footerDimSpanW}px;box-sizing:border-box;font-weight:700;color:${COPY.slate800};font-size:13px;">总计 (Total)</td>` +
                    `${footerMetricTds.join('')}` +
                    `</tr>`
            );
        }

        const plain = allPlainRows.join('\n');
        const colgroupHtml =
            '<colgroup>' +
            selectedDimensions.map(() => `<col width="${CLIPBOARD_DIM_COL_W}" style="width:${CLIPBOARD_DIM_COL_W}px" />`).join('') +
            columnConfig
                .map((col: any) => {
                    const mTitle = typeof col.title === 'string' ? col.title : String(col.key || '');
                    const w = clipboardMetricColW(mTitle);
                    return `<col width="${w}" style="width:${w}px;min-width:${w}px" />`;
                })
                .join('') +
            '</colgroup>';
        const html =
            '<meta charset="utf-8"><table cellspacing="0" cellpadding="0" width="' +
            clipboardTableTotalW +
            '" style="border-collapse:collapse;table-layout:fixed;width:' +
            clipboardTableTotalW +
            'px;font-size:13px;border:1px solid ' +
            COPY.border +
            '">' +
            colgroupHtml +
            '<thead>' +
            headerHtml +
            '</thead><tbody>' +
            allHtmlRows.join('') +
            '</tbody></table>';

        try {
            if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
                await navigator.clipboard.write([
                    new ClipboardItem({
                        'text/html': new Blob([html], { type: 'text/html' }),
                        'text/plain': new Blob([plain], { type: 'text/plain' }),
                    }),
                ]);
            } else {
                await navigator.clipboard.writeText(plain);
            }
            setCopyFeishuHint('ok');
            window.setTimeout(() => setCopyFeishuHint('idle'), 2500);
        } catch {
            setCopyFeishuHint('err');
            window.setTimeout(() => setCopyFeishuHint('idle'), 3500);
        }
    };

    const handleFooterCellClick = (col: any) => {
        if (col.triggerCalculator && onOpenCalculator) {
            onOpenCalculator(undefined, undefined);
        }
        if (col.triggerAction && onOpenRefundAnalysis) {
            onOpenRefundAnalysis({});
        }
        if (col.triggerTrend) {
            setTrendFromTotal(true);
            setTrendDimensions({});
            setTrendModalOpen(true);
        }
    };

    useEscClose(isOpen, onClose);

    if (!isOpen) return null;

    // Unified Cell Renderer for Detail Rows and Total Row
    const renderDetailCell = (
        current: AggregatedData | InventoryAggregated, 
        last: AggregatedData | null | undefined, 
        year: AggregatedData | null | undefined, 
        target: AggregatedData | null | undefined, 
        col: any, 
        showStructure: boolean, 
        structureVal: number | null, 
        isInventory: boolean,
        isTotalRow = false
    ) => {
        if (col.isTrend) {
            return (
                <div className="flex justify-end items-center h-full">
                    <button className="p-1.5 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded transition-colors group">
                        <TrendingUp className="w-4 h-4 group-hover:scale-110 transition-transform" />
                    </button>
                </div>
            );
        }

        if (col.isDiagnosis && (type === 'PL' || type === 'Traffic')) {
            const tags = computeSubtableRowDiagnosis({
                subType: type,
                settings: diagnosisSettings,
                isWeekly: !!isWeeklyMode,
                current: current as AggregatedData,
                last: last as AggregatedData | null | undefined,
                year: year as AggregatedData | null | undefined,
                target: target as AggregatedData | null | undefined,
                columnConfig: columnConfig as any[],
            });
            if (tags.length === 0) {
                return <div className="text-right text-[10px] text-slate-300">—</div>;
            }
            return (
                <div className="flex max-w-[220px] flex-wrap content-end items-start justify-end gap-0.5 pl-1 text-right">
                    {tags.map((t, i) => (
                        <span
                            key={i}
                            className={t.tone === 'red' ? 'text-red-600' : 'text-emerald-600'}
                            style={{ fontSize: '10px', lineHeight: 1.25 }}
                        >
                            {t.text}
                        </span>
                    ))}
                </div>
            );
        }

        const currVal = getValue(current as AggregatedData, col);
        const lastVal = getValue(last as AggregatedData, col);
        const yearVal = getValue(year as AggregatedData, col);
        const targetVal = target ? getValue(target, col) : undefined;

        const displayVal = col.formatter(currVal);
        
        let subDisplay = null;
        if (isInventory && col.subKey) {
            const subVal = (current as any)[col.subKey];
            subDisplay = <div className="text-[10px] text-slate-500 mt-0.5 font-mono">{col.subFormatter(subVal)}</div>;
        }

        if (isInventory && showStructure && col.isPercentBase) {
            const invData = current as InventoryAggregated;
            // Calculate Row Percentages based on Row Total
            const qtyBase = invData.fba_total_qty || 1;
            const costBase = invData.fba_total_cost || 1;

            const qtyVal = (invData as any)[col.key] || 0;
            const qtyPct = qtyVal / qtyBase;

            const costVal = col.subKey ? ((invData as any)[col.subKey] || 0) : 0;
            const costPct = col.subKey ? (costVal / costBase) : 0;

            return (
                <div className="flex flex-col items-end">
                     <div className="font-bold text-blue-600 font-mono">{(qtyPct * 100).toFixed(1)}%</div>
                     {col.subKey && <div className="text-[10px] text-blue-400">{(costPct * 100).toFixed(1)}%</div>}
                </div>
            )
        }

        if (!isInventory && showStructure && structureVal !== null) {
            return <div className="font-bold text-slate-700 font-mono">{(structureVal * 100).toFixed(1)}%</div>;
        }

        const momLabel = isWeeklyMode ? '周环:' : '环:';
        const yoyLabel = isWeeklyMode ? '周同:' : '同:';

        return (
            <div className="flex flex-col items-end">
                <div className={`font-bold font-mono ${isTotalRow ? 'text-sm text-slate-900' : 'text-slate-700'}`}>
                    {displayVal}
                </div>
                {subDisplay}

                {!isInventory && (
                    <>
                        {last !== undefined && last !== null && (
                            <div className={`text-[10px] ${isTotalRow ? 'text-slate-500' : 'text-slate-400'} mt-0.5 flex justify-end gap-1`}>
                                <span className="opacity-70">{momLabel}</span>
                                {renderDiff(currVal, lastVal, col.diffType)}
                            </div>
                        )}
                        {year !== undefined && year !== null && (
                            <div className={`text-[10px] ${isTotalRow ? 'text-slate-500' : 'text-slate-400'} flex justify-end gap-1`}>
                                <span className="opacity-70">{yoyLabel}</span>
                                {renderDiff(currVal, yearVal, col.diffType)}
                            </div>
                        )}
                        {col.hasTarget && target && targetVal !== undefined && (
                            <div className={`mt-1 pt-1 ${isTotalRow ? 'border-t border-slate-200' : 'border-t border-slate-100'} w-full`}>
                                {renderTarget(currVal, targetVal, col, col.formatter)}
                            </div>
                        )}
                    </>
                )}
            </div>
        );
    };

    return (
        <div className={`fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in zoom-in duration-200 ${isOpen ? '' : 'hidden'}`}>
             <div className="bg-white w-full max-w-[95vw] h-[90vh] rounded-xl shadow-2xl flex flex-col overflow-hidden">
                <div className="bg-slate-800 px-6 py-4 flex items-center justify-between text-white flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="bg-indigo-500 p-2 rounded-lg">
                            {type === 'Inventory' ? <Layers className="w-5 h-5 text-white" /> : <FileSearch className="w-5 h-5 text-white" />}
                        </div>
                        <div>
                            <h2 className="text-xl font-bold tracking-tight">{titleMap[type]}</h2>
                            <p className="text-xs text-indigo-100">Deep Dive Analysis Module {isWeeklyMode ? '(Weekly)' : ''}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {type !== 'Inventory' && (
                            <button
                                type="button"
                                onClick={() => {
                                    setAiPanelOpen(o => !o);
                                    setAiError('');
                                }}
                                className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
                                    aiPanelOpen
                                        ? 'border-indigo-400 bg-indigo-500 text-white'
                                        : 'border-slate-600 bg-slate-700 text-white hover:bg-slate-600'
                                }`}
                            >
                                <Bot className="h-4 w-4" />
                                {aiPanelOpen ? '收起 AI 分析' : 'AI 分析'}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => void handleCopyTableForFeishu()}
                            disabled={subtableViewFlat.length === 0}
                            title="复制为表格：粘贴到飞书文档或 Excel，单元格内多行在飞书中会换行显示"
                            className="flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-700 px-3 py-1.5 text-sm text-white transition-colors hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Copy className="h-4 w-4" />
                            {copyFeishuHint === 'ok' ? '已复制' : copyFeishuHint === 'err' ? '复制失败' : '复制表格（飞书）'}
                        </button>
                        <button type="button" onClick={onClose} className="rounded-full p-2 transition-colors hover:bg-slate-700">
                            <X className="h-6 w-6 text-slate-300" />
                        </button>
                    </div>
                </div>
                
                {/* relative + z-index：避免「顶部词筛」下拉被下方表格区域（同列 flex 后兄弟）整块遮住 */}
                <div className="relative z-40 bg-slate-50 border-b border-slate-200 px-6 py-3 flex flex-wrap gap-4 items-center">
                    <div className="flex items-center gap-2 text-sm text-slate-600 font-bold mr-2">
                        <Filter className="w-4 h-4" /> 维度拆解:
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {DIMENSION_OPTIONS.map((opt) => {
                             if (type === 'Inventory' && opt.key === 'year_month') return null;
                             const isActive = selectedDimensions.includes(opt.key);
                             return (
                                <button
                                    key={opt.key}
                                    onClick={() => toggleDimension(opt.key)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5
                                        ${isActive 
                                            ? 'bg-blue-600 text-white border-blue-600 shadow-sm' 
                                            : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-500'}
                                    `}
                                >
                                    {isActive && <Check className="w-3 h-3" />}
                                    {opt.key === 'year_month' ? timeLabel : opt.label}
                                </button>
                             );
                        })}
                    </div>

                    <div className="ml-0 flex w-full min-w-0 flex-col gap-0.5 sm:ml-1 sm:w-auto sm:flex-row sm:items-center sm:gap-2">
                        <div className="relative w-full min-w-0 max-w-md" ref={subtableSearchBarRef}>
                            <div
                                className="inline-flex h-8 w-full min-w-0 items-stretch rounded-lg border border-slate-200 bg-white text-xs shadow-sm transition-shadow focus-within:ring-2 focus-within:ring-blue-500/30 focus-within:border-blue-500"
                                title="左侧选字段。右侧输入框为「包含」模糊筛选；列表图标打开「多项精确」面板（一行一项、整值精确匹配）。启用精确后暂时不使用模糊词；与维度拆解、表头漏斗为且(AND)。"
                            >
                                {/* 勿对整条搜索框设 overflow-hidden，否则会裁掉下方展开的下拉菜单 */}
                                <div className="relative shrink-0 overflow-visible rounded-l-lg" ref={subtableQuickRef}>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSubtableBulkOpen(false);
                                            setSubtableQuickOpen((o) => !o);
                                        }}
                                        className="flex h-full min-w-[4.5rem] items-center justify-center gap-0.5 rounded-l-lg border-r border-slate-200 bg-slate-50/80 px-2 font-medium text-slate-700 hover:bg-slate-100"
                                    >
                                        {SUBTABLE_QUICK_FILTER_OPTIONS.find((o) => o.key === subtableQuickKey)?.label}
                                        {subtableQuickOpen ? (
                                            <ChevronUp className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                                        ) : (
                                            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                                        )}
                                    </button>
                                    {subtableQuickOpen && (
                                        <div className="absolute left-0 top-full z-[200] mt-1 max-h-72 min-w-[6.5rem] overflow-y-auto rounded-lg border border-slate-200 bg-white py-0.5 shadow-xl">
                                            {SUBTABLE_QUICK_FILTER_OPTIONS.map((opt) => (
                                                <button
                                                    key={opt.key}
                                                    type="button"
                                                    onClick={() => {
                                                        setSubtableQuickKey(opt.key);
                                                        setSubtableQuickOpen(false);
                                                    }}
                                                    className={
                                                        'block w-full px-2.5 py-1.5 text-left ' +
                                                        (opt.key === subtableQuickKey
                                                            ? 'bg-blue-50 text-blue-700'
                                                            : 'text-slate-700 hover:bg-slate-50')
                                                    }
                                                >
                                                    {opt.label}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <div className="relative min-w-0 flex-1 overflow-hidden rounded-r-lg">
                                    <input
                                        type="search"
                                        value={subtableQuickText}
                                        onChange={(e) => setSubtableQuickText(e.target.value)}
                                        placeholder={subtableBulkNormSet.size > 0 ? '已启用精确匹配，请先清除' : '输入关键词筛选'}
                                        disabled={subtableBulkNormSet.size > 0}
                                        title={subtableBulkNormSet.size > 0 ? '已启用多项精确搜索时不再使用模糊关键词；可点下方「清除」恢复' : undefined}
                                        className={
                                            'h-full w-full min-w-0 rounded-r-lg border-0 py-1.5 pl-2 pr-16 text-slate-800 outline-none ' +
                                            (subtableBulkNormSet.size > 0
                                                ? 'cursor-not-allowed bg-slate-50 text-slate-500 placeholder:text-slate-400'
                                                : 'bg-white placeholder:text-slate-400')
                                        }
                                    />
                                    <button
                                        type="button"
                                        title="多项精确搜索"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (!subtableBulkOpen) {
                                                setSubtableBulkDraft(subtableBulkExactTokens.join('\n'));
                                            }
                                            setSubtableQuickOpen(false);
                                            setSubtableBulkOpen((o) => !o);
                                        }}
                                        className={
                                            'absolute right-8 top-1/2 -translate-y-1/2 rounded p-0.5 transition-colors ' +
                                            (subtableBulkNormSet.size > 0 || subtableBulkOpen
                                                ? 'text-blue-600 hover:bg-blue-50'
                                                : 'text-slate-400 hover:bg-slate-100 hover:text-blue-600')
                                        }
                                    >
                                        <ListFilter className="h-3.5 w-3.5" />
                                    </button>
                                    <SearchIcon className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                                </div>
                            </div>
                            {subtableBulkNotice && (
                                <p className="mt-1 text-[11px] leading-snug text-amber-800">{subtableBulkNotice}</p>
                            )}
                            {subtableBulkExactTokens.length > 0 && (
                                <p className="mt-1 text-[11px] leading-snug text-slate-600">
                                    已启用精确匹配 {subtableBulkExactTokens.length} 项 ·{' '}
                                    <button
                                        type="button"
                                        className="font-medium text-blue-600 hover:underline"
                                        onClick={() => {
                                            setSubtableBulkExactTokens([]);
                                            setSubtableBulkNotice(null);
                                        }}
                                    >
                                        清除
                                    </button>
                                </p>
                            )}
                            {subtableBulkOpen && (
                                <div className="absolute left-0 right-0 top-full z-[220] mt-1 rounded-lg border border-slate-200 bg-white p-3 shadow-xl">
                                    <textarea
                                        value={subtableBulkDraft}
                                        onChange={(e) => setSubtableBulkDraft(e.target.value)}
                                        rows={8}
                                        placeholder={`精确搜索，一行一项，最多支持 ${SUBTABLE_BULK_EXACT_MAX} 项（与左侧字段整段内容一致；空白行忽略）`}
                                        className="min-h-[140px] w-full resize-y rounded border border-slate-200 bg-slate-50/60 px-2 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30"
                                    />
                                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setSubtableBulkDraft('')}
                                            className="text-xs text-slate-500 hover:text-slate-800"
                                        >
                                            清空
                                        </button>
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setSubtableBulkOpen(false)}
                                                className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                                            >
                                                关闭
                                            </button>
                                            <button
                                                type="button"
                                                onClick={applySubtableBulkExact}
                                                className="rounded border border-blue-600 bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                                            >
                                                搜索
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {type !== 'Inventory' && !tagColumnVisible && (
                        <button
                            type="button"
                            onClick={() => setSubtableDiagnosisOpen(true)}
                            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 sm:ml-auto"
                            title="「标签」列已隐藏：点此打开设置，可重新显示并编辑规则"
                        >
                            <Settings className="h-3.5 w-3.5 text-slate-500" />
                            标签设置
                        </button>
                    )}
                    
                    {/* Hide Structure Toggle for P&L types (both Monthly and Weekly), Show only for Inventory */}
                    {type === 'Inventory' && (
                        <>
                            <div className="h-6 w-px bg-slate-300 mx-2"></div>
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                                <div className={`w-9 h-5 rounded-full relative transition-colors ${showStructure ? 'bg-blue-600' : 'bg-slate-300'}`} onClick={() => setShowStructure(!showStructure)}>
                                    <div className={`absolute top-1 left-1 w-3 h-3 bg-white rounded-full transition-transform ${showStructure ? 'translate-x-4' : ''}`}></div>
                                </div>
                                <span className="text-xs font-bold text-slate-600">显示占比 (Row %)</span>
                            </label>
                        </>
                    )}
                </div>

                <div className="relative z-0 flex min-h-0 flex-1 overflow-hidden">
                    <div
                        className="relative min-w-0 flex-1 overflow-auto custom-scroll"
                        ref={tableContainerRef}
                        onScroll={handleScroll}
                    >
                        <table className="w-full text-left border-collapse min-w-[1200px]">
                            <thead className="bg-slate-100 text-slate-600 sticky top-0 z-[55] shadow-sm">
                                <tr>
                                    {selectedDimensions.map((dimKey, i) => {
                                        const label = dimKey === 'year_month' ? timeLabel : (DIMENSION_OPTIONS.find(d => d.key === dimKey)?.label || dimKey);
                                        const sortIdx = -(i + 1);
                                        const filterAlign = i === 0 ? 'left' : 'right';
                                        
                                        const sourceData = type === 'Inventory' ? groupedInventoryRaw : groupedActuals;

                                        return (
                                            <th 
                                                key={dimKey} 
                                                className="p-3 font-bold text-xs border-b border-r border-slate-200 min-w-[120px] bg-slate-100 hover:bg-slate-200 cursor-pointer transition-colors sticky left-0 z-[56] group"
                                            >
                                                <div className="flex items-center gap-1" onClick={() => handleSort(sortIdx)}>
                                                    {label}
                                                    <SortIcon index={sortIdx} />
                                                </div>
                                                <HeaderFilter 
                                                    dimKey={dimKey} 
                                                    align={filterAlign} 
                                                    dimFilters={dimFilters}
                                                    setDimFilters={setDimFilters}
                                                    sourceData={sourceData}
                                                />
                                            </th>
                                        );
                                    })}
                                    {columnConfig.map((col: any, i) => (
                                        <th
                                            key={i}
                                            className={
                                                'p-3 font-bold text-xs border-b border-r border-slate-200 min-w-[100px] bg-slate-100 transition-colors ' +
                                                (col.isDiagnosis
                                                    ? 'text-right hover:bg-slate-200'
                                                    : 'cursor-pointer text-right hover:bg-slate-200')
                                            }
                                            onClick={col.isDiagnosis ? undefined : () => handleSort(i)}
                                        >
                                            {col.isDiagnosis ? (
                                                <div className="flex items-center justify-end gap-1">
                                                    <div
                                                        className="flex min-w-0 flex-1 cursor-pointer items-center justify-end gap-1"
                                                        onClick={() => handleSort(i)}
                                                        title="点击排序"
                                                    >
                                                        <span className="truncate">{col.title}</span>
                                                        <SortIcon index={i} />
                                                    </div>
                                                    <button
                                                        type="button"
                                                        title="标签规则、阈值、显示名与是否显示本列"
                                                        className="shrink-0 rounded p-1 text-slate-500 transition-colors hover:bg-slate-200 hover:text-blue-600"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setSubtableDiagnosisOpen(true);
                                                        }}
                                                    >
                                                        <Settings className="h-3.5 w-3.5" />
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="flex items-center justify-end gap-1">
                                                    {col.headerRender ? col.headerRender : col.title}
                                                    <SortIcon index={i} />
                                                </div>
                                            )}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 bg-white text-xs">
                                {subtableViewFlat.slice(0, visibleCount).map((item) => {
                                    const isP = item.kind === 'parent';
                                    const isC = item.kind === 'sub';
                                    const row = isP ? item.parentRow : item.row;
                                    const firstCh = (isP || isC ? item.children : [row])[0];
                                    const gKey = (isP || isC) ? item.groupKey : null;
                                    const isExp = !!(gKey && expandedParentAsinKeys.includes(gKey));
                                    const rowKey = isP
                                        ? `p-${gKey}`
                                        : isC
                                        ? `c-${gKey}-${(row as { compositeKey?: string }).compositeKey ?? 'x'}`
                                        : `d-${(row as { compositeKey?: string }).compositeKey ?? 'x'}`;

                                    const trClass =
                                        (isC ? 'bg-slate-50/90 ' : 'bg-white ') +
                                        'hover:bg-blue-50/30 transition-colors group';
                                    return (
                                    <tr key={rowKey} className={trClass}>
                                        {selectedDimensions.map((dimKey) => {
                                            const dimCellBg = isC ? 'bg-slate-50/90' : 'bg-white';
                                            if (isC && dimKey === 'parent_asin') {
                                                return (
                                                    <td
                                                        key={dimKey}
                                                        className={`p-2 border-r border-slate-100 font-medium text-slate-500 sticky left-0 z-10 max-w-[200px] group-hover:bg-slate-100/80 ${dimCellBg}`}
                                                    />
                                                );
                                            }
                                            const val = String(row.dimensions[dimKey] ?? '-');
                                            const isLink =
                                                (dimKey === 'child_asin' || dimKey === 'parent_asin') &&
                                                val &&
                                                val !== 'Unknown' &&
                                                !val.startsWith('共 ');
                                            const linkUrl = isLink ? getAmazonProductLink(val, row.sampleCountry) : null;

                                            if (isP && dimKey === 'parent_asin' && gKey != null) {
                                                return (
                                                    <td
                                                        key={dimKey}
                                                        className={`p-3 border-r border-slate-100 font-medium text-slate-700 sticky left-0 z-10 group-hover:bg-blue-50/30 truncate max-w-[200px] ${dimCellBg}`}
                                                    >
                                                        <div className="flex min-w-0 items-center gap-0.5">
                                                            <button
                                                                type="button"
                                                                className="shrink-0 rounded p-0.5 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-800"
                                                                title={isExp ? '折叠' : '展开子行（子 ASIN / 品名）'}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setExpandedParentAsinKeys((arr) =>
                                                                        arr.includes(gKey) ? arr.filter((k) => k !== gKey) : [...arr, gKey]
                                                                    );
                                                                }}
                                                            >
                                                                {isExp ? (
                                                                    <ChevronDown className="h-3.5 w-3.5" />
                                                                ) : (
                                                                    <ChevronRight className="h-3.5 w-3.5" />
                                                                )}
                                                            </button>
                                                            {isLink && val !== 'Unknown' ? (
                                                                <a
                                                                    href={linkUrl!}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="min-w-0 flex items-center gap-0.5 truncate text-blue-600 hover:underline"
                                                                    onClick={e => e.stopPropagation()}
                                                                >
                                                                    {val} <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
                                                                </a>
                                                            ) : (
                                                                <span className="truncate" title={val}>
                                                                    {val}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>
                                                );
                                            }

                                            if (isC && dimKey === 'child_asin') {
                                                return (
                                                    <td
                                                        key={dimKey}
                                                        className={`p-3 border-r border-slate-100 font-medium text-slate-700 sticky left-0 z-10 max-w-[200px] group-hover:bg-slate-100/80 ${dimCellBg} truncate`}
                                                    >
                                                        <span className="block border-l-2 border-slate-200 pl-2">
                                                            {isLink && val !== 'Unknown' ? (
                                                                <a
                                                                    href={linkUrl!}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="inline-flex items-center gap-0.5 text-blue-600 hover:underline"
                                                                    onClick={e => e.stopPropagation()}
                                                                >
                                                                    {val} <ExternalLink className="h-3 w-3 opacity-50" />
                                                                </a>
                                                            ) : (
                                                                val
                                                            )}
                                                        </span>
                                                    </td>
                                                );
                                            }

                                            if (isC && dimKey === 'product_name') {
                                                return (
                                                    <td
                                                        key={dimKey}
                                                        className={`p-3 border-r border-slate-100 font-medium text-slate-700 sticky left-0 z-10 max-w-[220px] group-hover:bg-slate-100/80 ${dimCellBg} truncate`}
                                                    >
                                                        <span
                                                            className="block border-l-2 border-slate-200 pl-2"
                                                            title={val}
                                                        >
                                                            {val}
                                                        </span>
                                                    </td>
                                                );
                                            }

                                            return (
                                                <td
                                                    key={dimKey}
                                                    className={`p-3 border-r border-slate-100 font-medium text-slate-700 sticky left-0 z-10 group-hover:bg-blue-50/30 truncate max-w-[200px] ${dimCellBg}`}
                                                >
                                                    {isLink && val !== 'Unknown' ? (
                                                        <a
                                                            href={linkUrl!}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-blue-600 hover:underline flex items-center gap-1"
                                                            onClick={e => e.stopPropagation()}
                                                        >
                                                            {val} <ExternalLink className="h-3 w-3 opacity-50" />
                                                        </a>
                                                    ) : (
                                                        <span className="truncate" title={val}>
                                                            {val}
                                                        </span>
                                                    )}
                                                </td>
                                            );
                                        })}
                                        {columnConfig.map((col: any, colIdx) => {
                                            const currVal = getValue(row.current, col);
                                            const isClickable = col.isInteractive;
                                            const cellClass = isClickable ? "cursor-pointer hover:bg-blue-100 rounded transition-colors p-1 -m-1" : "";
                                            const ctx = isP ? firstCh : row;
                                            const ctxDim = (ctx as { dimensions: Record<string, string> }).dimensions;

                                            const handleClick = () => {
                                                if (col.triggerCalculator && onOpenCalculator) {
                                                    onOpenCalculator(
                                                        ctxDim['product_name'] || ctxDim['child_asin'], 
                                                        ctxDim['country']
                                                    );
                                                }
                                                if (col.triggerAction && onOpenRefundAnalysis) {
                                                    const contextFilters: Partial<FilterState> = {};
                                                    if (ctxDim['parent_asin']) contextFilters.parentAsins = [ctxDim['parent_asin']];
                                                    if (ctxDim['child_asin'] && !String(ctxDim['child_asin']).startsWith('共 ')) {
                                                        contextFilters.childAsins = [ctxDim['child_asin']];
                                                    }
                                                    if (ctxDim['product_name']) contextFilters.productNames = [ctxDim['product_name']];
                                                    if (ctxDim['country']) contextFilters.countries = [ctxDim['country']];
                                                    if (ctxDim['sub_category']) contextFilters.subCategories = [ctxDim['sub_category']];
                                                    
                                                    onOpenRefundAnalysis(contextFilters);
                                                }
                                                if (col.triggerTrend) {
                                                    setTrendFromTotal(false);
                                                    setTrendDimensions(
                                                        isP
                                                            ? { ...firstCh.dimensions }
                                                            : { ...row.dimensions }
                                                    );
                                                    setTrendModalOpen(true);
                                                }
                                            }

                                            // Note: Structure calc moved inside renderDetailCell for correct Row-based logic
                                            let structureVal: number | null = null;
                                            if (type !== 'Inventory' && showStructure) {
                                                 if (type === 'PL') {
                                                    if (['头程占比','采购占比','仓储占比','FBA费占比','退款占比','佣金占比','广告占比'].includes(col.title)) {
                                                        structureVal = currVal; 
                                                    } else if (col.key === 'sales_amount' || col.key === 'sales_quantity') {
                                                         const grandTotal = getValue(totalData?.current, col);
                                                         structureVal = grandTotal ? currVal / grandTotal : 0;
                                                    }
                                                }
                                            }

                                            return (
                                                <td
                                                    key={colIdx}
                                                    className={
                                                        isC
                                                            ? 'border-r border-slate-100 bg-slate-50/90 p-3 text-right align-top'
                                                            : 'border-r border-slate-100 p-3 text-right align-top'
                                                    }
                                                >
                                                    <div className={cellClass} onClick={isClickable ? handleClick : undefined}>
                                                        {renderDetailCell(
                                                            row.current, 
                                                            row.last, 
                                                            row.year, 
                                                            row.target, 
                                                            col, 
                                                            showStructure, 
                                                            structureVal, 
                                                            type === 'Inventory'
                                                        )}
                                                    </div>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                    );
                                })}
                                {subtableViewFlat.length === 0 && (
                                    <tr>
                                        <td colSpan={selectedDimensions.length + columnConfig.length} className="p-8 text-center text-slate-400">
                                            暂无符合筛选条件的数据
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                            {sortedData.length > 0 && subtableViewFlat.length > 0 && totalData && (
                                <tfoot className="bg-slate-50 border-t-2 border-slate-200 sticky bottom-0 z-30 shadow-inner">
                                    <tr>
                                        <td colSpan={selectedDimensions.length} className="p-3 border-r border-slate-200 font-bold text-slate-800 text-right bg-slate-50 sticky left-0 z-[35]">
                                            总计 (Total)
                                        </td>
                                        {columnConfig.map((col: any, colIdx) => {
                                            const footerInteractive = col.isInteractive;
                                            return (
                                                <td key={colIdx} className="p-3 border-r border-slate-200 text-right align-top bg-slate-50">
                                                    <div
                                                        className={
                                                            footerInteractive
                                                                ? 'cursor-pointer rounded p-1 -m-1 transition-colors hover:bg-blue-100'
                                                                : ''
                                                        }
                                                        onClick={footerInteractive ? () => handleFooterCellClick(col) : undefined}
                                                    >
                                                        {renderDetailCell(
                                                            type === 'Inventory' ? totalData.inventory as InventoryAggregated : totalData.current,
                                                            type !== 'Inventory' ? totalData.last : null,
                                                            type !== 'Inventory' ? totalData.year : null,
                                                            type !== 'Inventory' ? totalData.target : null,
                                                            col,
                                                            showStructure,
                                                            null,
                                                            type === 'Inventory',
                                                            true
                                                        )}
                                                    </div>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                    {type !== 'Inventory' && aiPanelOpen && (
                        <div className="flex max-w-[520px] min-w-[300px] w-[min(440px,42vw)] flex-shrink-0 flex-col border-l border-slate-200 bg-white shadow-[0_0_24px_rgba(15,23,42,0.08)]">
                            <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 px-3 py-2">
                                <span className="flex items-center gap-1.5 text-xs font-bold text-indigo-900">
                                    <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                                    基于当前子表数据
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setAiPromptModalOpen(true)}
                                    className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-indigo-600"
                                    title="编辑提示词与系统设定"
                                >
                                    <Settings className="h-4 w-4" />
                                </button>
                            </div>
                            <div className="custom-scroll min-h-0 flex-1 overflow-y-auto p-3 text-xs">
                                {aiLoading ? (
                                    <div className="flex flex-col items-center justify-center gap-2 py-12 text-indigo-500">
                                        <Loader2 className="h-8 w-8 animate-spin" />
                                        <span>分析中…</span>
                                    </div>
                                ) : aiError ? (
                                    <div className="rounded border border-red-200 bg-red-50 p-3 text-red-700">{aiError}</div>
                                ) : aiReport ? (
                                    <div className="leading-relaxed whitespace-pre-wrap text-slate-700">{aiReport}</div>
                                ) : (
                                    <div className="py-8 text-center text-slate-400">
                                        点击下方按钮，将根据<strong className="text-slate-600">当前子表中列头筛选与排序后的全部数据行</strong>生成 Markdown 分析。
                                    </div>
                                )}
                            </div>
                            <div className="flex-shrink-0 border-t border-slate-200 p-2">
                                <button
                                    type="button"
                                    onClick={runSubtableAi}
                                    disabled={aiLoading || sortedData.length === 0}
                                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2.5 text-sm font-bold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                                >
                                    <Bot className="h-4 w-4" />
                                    开始分析
                                </button>
                            </div>
                        </div>
                    )}
                </div>
             </div>

             {type !== 'Inventory' && (
                <PromptSettingsModal
                    isOpen={aiPromptModalOpen}
                    onClose={() => setAiPromptModalOpen(false)}
                    configKey={type === 'PL' ? SUBTABLE_PL_AI_KEY : SUBTABLE_TRAFFIC_AI_KEY}
                    title={type === 'PL' ? '子表 AI：P&L 提示词' : '子表 AI：流量与广告提示词'}
                    defaultSystemPrompt={DEFAULT_SUBTABLE_AI_SYSTEM}
                    defaultTemplate={DEFAULT_SUBTABLE_AI_TEMPLATE}
                />
             )}

             {type !== 'Inventory' && (
                 <TrendChartModal
                     isOpen={trendModalOpen}
                     onClose={() => {
                         setTrendModalOpen(false);
                         setTrendFromTotal(false);
                     }}
                     rawMonthly={monthlyRawSource}
                     rawWeekly={performanceWeekly}
                     scope={trendScope}
                     sidebarWeeklyMode={!!isWeeklyMode}
                     columns={mergedTrendColumns}
                     targetRows={targetRows}
                 />
             )}

             {type !== 'Inventory' && (
                 <SubtableDiagnosisSettingsModal
                     isOpen={subtableDiagnosisOpen}
                     onClose={() => setSubtableDiagnosisOpen(false)}
                     subType={type === 'PL' ? 'PL' : 'Traffic'}
                     onSaved={() => setDiagnosisSettings(loadSubtableDiagnosisSettings())}
                 />
             )}
        </div>
    );
};

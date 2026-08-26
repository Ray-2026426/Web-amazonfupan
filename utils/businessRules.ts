import {
    ActionItem,
    AggregatedData,
    BusinessIssue,
    BusinessIssueSeverity,
    BusinessRule,
    DiagnosticStep,
    InventoryAggregated,
} from '../types';
import { formatMoneyNoDecimals, formatNumber, formatPercent } from '../utils';

export const DEFAULT_BUSINESS_RULES: BusinessRule[] = [
    {
        id: 'profit-pacing-risk',
        name: '毛利额序时风险',
        category: 'profit',
        description: '毛利额是核心经营目标；低于序时进度时，所有 KR 都要回到毛利额缺口解释。',
        thresholdLabel: '毛利额序时达成 < 90%',
    },
    {
        id: 'sales-pacing-risk',
        name: '销售额 KR 序时风险',
        category: 'goal',
        description: '销售额是支撑毛利额的规模 KR；低于序时时，判断是流量、转化、客单价还是供给问题。',
        thresholdLabel: '销售额 KR 序时达成 < 90%',
    },
    {
        id: 'margin-gap-risk',
        name: '毛利率 KR 缺口',
        category: 'profit',
        description: '毛利率是支撑毛利额的效率 KR；低于目标时，不先追销售额，先确认利润模型是否还能成立。',
        thresholdLabel: '毛利率 KR 低于目标 2 个百分点以上',
    },
    {
        id: 'ad-budget-overrun',
        name: '广告 KR 失控',
        category: 'ads',
        description: '广告花费是支撑毛利额的费用 KR；消耗快于目标或销售贡献时，优先压无效词、低转化活动和异常 CPC。',
        thresholdLabel: '广告预算使用率 > 110%',
    },
    {
        id: 'acos-risk',
        name: '广告效率风险',
        category: 'ads',
        description: '广告花费占广告销售过高时，必须回到关键词、Listing、价格和 VOC 排查。',
        thresholdLabel: 'ACoS > 35%',
    },
    {
        id: 'aged-inventory-risk',
        name: '滞销库存风险',
        category: 'inventory',
        description: '180 天以上 FBA 库龄金额偏高时，库存处理优先于继续拉流量。',
        thresholdLabel: '180 天以上库龄成本占 FBA 成本 > 20%',
    },
    {
        id: 'low-rating-risk',
        name: '口碑转化风险',
        category: 'quality',
        description: '评分偏低会拖累转化和广告效率，需联动评论、退货和 Listing 预期管理。',
        thresholdLabel: '平均评分 < 4.2',
    },
    {
        id: 'data-completeness-risk',
        name: '数据可信度风险',
        category: 'data',
        description: '缺目标、缺对比期或缺关键专题表时，结论要降级为弱判断。',
        thresholdLabel: '存在数据/目标完整性告警',
    },
];

const DAY_MS = 24 * 60 * 60 * 1000;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const ratio = (num: number, den: number) => den ? num / den : 0;

const getDueDate = (severity: BusinessIssueSeverity) => {
    const days = severity === 'critical' ? 1 : severity === 'warning' ? 3 : 7;
    const date = new Date(Date.now() + days * DAY_MS);
    return date.toISOString().slice(0, 10);
};

const compareLine = (current: number, baseline: number | undefined, formatter: (v: number) => string) => {
    if (baseline === undefined || baseline === null || baseline === 0) return '对比期数据不足';
    const diff = ratio(current - baseline, baseline);
    return `${formatter(current)}，对比期 ${formatter(baseline)}，变化 ${diff >= 0 ? '+' : ''}${formatPercent(diff)}`;
};

const buildSalesChain = (
    current: AggregatedData,
    last: AggregatedData | null,
    inventory: InventoryAggregated | null,
): DiagnosticStep[] => {
    const trafficChange = last ? ratio(current.sessions - last.sessions, last.sessions) : 0;
    const cvr = ratio(current.sales_quantity, current.sessions);
    const lastCvr = last ? ratio(last.sales_quantity, last.sessions) : 0;
    const avgTicketChange = last ? ratio(current.avg_ticket - last.avg_ticket, last.avg_ticket) : 0;
    const hasSupplyRisk = !!inventory && inventory.fba_total_qty > 0 && current.fba_sellable_qty <= Math.max(5, current.sales_quantity * 0.15);

    return [
        {
            id: 'traffic',
            label: '流量',
            status: !last ? 'check' : trafficChange < -0.08 ? 'triggered' : 'check',
            evidence: !last ? '缺少可比期，无法判断流量变化' : `Sessions ${compareLine(current.sessions, last.sessions, formatNumber)}`,
            nextAction: '打开流量与广告子表，按 ASIN/负责人拆展示、点击和 Sessions。',
        },
        {
            id: 'conversion',
            label: '转化',
            status: !last ? 'check' : cvr < lastCvr * 0.9 ? 'triggered' : 'check',
            evidence: !last ? `当前转化率 ${formatPercent(cvr)}` : `当前转化率 ${formatPercent(cvr)}，对比期 ${formatPercent(lastCvr)}`,
            nextAction: '联动评论、退货和价格，确认是否是 Listing/VOC/定价拖累。',
        },
        {
            id: 'ticket',
            label: '客单价',
            status: !last ? 'check' : avgTicketChange < -0.08 ? 'triggered' : 'check',
            evidence: !last ? `当前客单价 ${formatMoneyNoDecimals(current.avg_ticket)}` : `客单价变化 ${avgTicketChange >= 0 ? '+' : ''}${formatPercent(avgTicketChange)}`,
            nextAction: '检查是否有低价款占比上升、促销过重或高客单产品断货。',
        },
        {
            id: 'supply',
            label: '供给',
            status: hasSupplyRisk ? 'triggered' : 'check',
            evidence: inventory ? `FBA 可售 ${formatNumber(current.fba_sellable_qty)}，FBA 总库存 ${formatNumber(inventory.fba_total_qty)}` : '未导入库存表',
            nextAction: '若可售不足，先补货/控投放，再讨论拉流量。',
        },
    ];
};

const buildProfitChain = (current: AggregatedData, last: AggregatedData | null): DiagnosticStep[] => {
    const adShare = ratio(current.ad_spend, current.sales_amount);
    const lastAdShare = last ? ratio(last.ad_spend, last.sales_amount) : 0;
    const refundShare = ratio(current.refund_cost, current.sales_amount);
    const costShare = ratio(
        current.procurement_cost + current.first_mile_cost + current.fba_fee + current.platform_commission + current.storage_fee,
        current.sales_amount,
    );

    return [
        {
            id: 'ad-cost',
            label: '广告消耗',
            status: adShare > Math.max(0.18, lastAdShare * 1.15) ? 'triggered' : 'check',
            evidence: `广告费占销售额 ${formatPercent(adShare)}${last ? `，对比期 ${formatPercent(lastAdShare)}` : ''}`,
            nextAction: '按活动/词拆广告花费，优先处理高花费低产出的对象。',
        },
        {
            id: 'refund-cost',
            label: '退款侵蚀',
            status: refundShare > 0.05 ? 'triggered' : 'check',
            evidence: `退款成本占销售额 ${formatPercent(refundShare)}`,
            nextAction: '打开退货专题，按原因聚类和 ASIN 找质量/描述问题。',
        },
        {
            id: 'hard-cost',
            label: '硬成本结构',
            status: costShare > 0.7 ? 'triggered' : 'check',
            evidence: `采购、头程、FBA、佣金、仓储合计占销售额 ${formatPercent(costShare)}`,
            nextAction: '用利润试算器检查涨价、降采、控费后的毛利率。',
        },
    ];
};

export const createActionFromIssue = (issue: BusinessIssue, owner?: string): ActionItem => ({
    id: `${issue.id}-${Date.now()}`,
    issueId: issue.id,
    title: issue.recommendation,
    owner: owner || issue.suggestedOwner,
    dueDate: issue.suggestedDueDate,
    status: 'open',
    createdAt: Date.now(),
    sourceRuleId: issue.ruleId,
});

export const updateActionForIssue = (actions: ActionItem[], issue: BusinessIssue): ActionItem[] => {
    if (actions.some(action => action.issueId === issue.id && action.status !== 'ignored')) return actions;
    return [...actions, createActionFromIssue(issue)];
};

export const generateBusinessIssues = ({
    current,
    last,
    target,
    inventory,
    warnings,
    pacingRatio,
    isWeeklyMode,
}: {
    current: AggregatedData;
    last: AggregatedData | null;
    target: AggregatedData;
    inventory: InventoryAggregated | null;
    warnings: string[];
    pacingRatio: number;
    isWeeklyMode: boolean;
}): BusinessIssue[] => {
    const issues: BusinessIssue[] = [];
    const pacing = clamp(pacingRatio || 1, 0.01, 1);
    const salesPacing = ratio(current.sales_amount, target.sales_amount * pacing);
    const profitPacing = ratio(current.gross_profit, target.gross_profit * pacing);
    const adBudgetPacing = ratio(current.ad_spend, target.ad_spend * pacing);
    const acos = ratio(current.ad_spend, current.ad_sales);
    const agedCost = inventory
        ? inventory.age_181_270_cost + inventory.age_271_330_cost + inventory.age_331_365_cost + inventory.age_365_plus_cost
        : 0;
    const agedShare = inventory ? ratio(agedCost, inventory.fba_total_cost) : 0;
    const owner = '当前筛选负责人';

    if (target.gross_profit > 0 && profitPacing < 0.9) {
        issues.push({
            id: 'issue-profit-pacing',
            ruleId: 'profit-pacing-risk',
            title: '毛利额低于序时进度',
            category: 'profit',
            severity: profitPacing < 0.75 ? 'critical' : 'warning',
            evidence: `当前毛利额 ${formatMoneyNoDecimals(current.gross_profit)}，序时目标 ${formatMoneyNoDecimals(target.gross_profit * pacing)}，序时达成 ${formatPercent(profitPacing)}`,
            impact: '核心目标未达成。继续只追销售额会放大亏损或低效增长。',
            recommendation: '先拆广告、退款和硬成本占比，再判断销售额、毛利率、广告和库存 KR 哪个对毛利额缺口贡献最大。',
            suggestedOwner: owner,
            suggestedDueDate: getDueDate(profitPacing < 0.75 ? 'critical' : 'warning'),
            diagnosticChain: buildProfitChain(current, last),
        });
    }

    if (target.sales_amount > 0 && salesPacing < 0.9) {
        issues.push({
            id: 'issue-sales-pacing',
            ruleId: 'sales-pacing-risk',
            title: '销售额 KR 低于序时进度',
            category: 'goal',
            severity: salesPacing < 0.75 ? 'critical' : 'warning',
            evidence: `当前销售额 ${formatMoneyNoDecimals(current.sales_amount)}，序时 KR ${formatMoneyNoDecimals(target.sales_amount * pacing)}，序时达成 ${formatPercent(salesPacing)}`,
            impact: `规模 KR 存在 ${formatMoneyNoDecimals(Math.max(0, target.sales_amount * pacing - current.sales_amount))} 的序时缺口，需要解释其对毛利额核心目标的影响。`,
            recommendation: '定位销售缺口来自流量、转化、客单价还是供给，并判断它是否正在拖累毛利额。',
            suggestedOwner: owner,
            suggestedDueDate: getDueDate(salesPacing < 0.75 ? 'critical' : 'warning'),
            diagnosticChain: buildSalesChain(current, last, inventory),
        });
    }

    if (target.gross_margin > 0 && current.gross_margin < target.gross_margin - 0.02) {
        issues.push({
            id: 'issue-margin-gap',
            ruleId: 'margin-gap-risk',
            title: '毛利率 KR 低于目标',
            category: 'profit',
            severity: current.gross_margin < target.gross_margin - 0.05 ? 'critical' : 'warning',
            evidence: `当前毛利率 ${formatPercent(current.gross_margin)}，目标 ${formatPercent(target.gross_margin)}，差距 ${formatPercent(current.gross_margin - target.gross_margin)}`,
            impact: '效率 KR 未达标，销售增长不一定能转化为毛利额增长。',
            recommendation: '用利润试算器模拟售价、采购、FBA、广告占比的组合变化，优先看毛利额能否回到序时。',
            suggestedOwner: owner,
            suggestedDueDate: getDueDate('warning'),
            diagnosticChain: buildProfitChain(current, last),
        });
    }

    if (target.ad_spend > 0 && adBudgetPacing > 1.1) {
        issues.push({
            id: 'issue-ad-budget',
            ruleId: 'ad-budget-overrun',
            title: '广告 KR 消耗过快',
            category: 'ads',
            severity: adBudgetPacing > 1.3 ? 'critical' : 'warning',
            evidence: `当前广告花费 ${formatMoneyNoDecimals(current.ad_spend)}，序时预算 ${formatMoneyNoDecimals(target.ad_spend * pacing)}，使用率 ${formatPercent(adBudgetPacing)}`,
            impact: '费用 KR 消耗快于计划，如果没有带来毛利额增长，会直接吃掉核心目标。',
            recommendation: '先停或降出价高花费低转化对象，再扩能贡献毛利额的有效词。',
            suggestedOwner: owner,
            suggestedDueDate: getDueDate(adBudgetPacing > 1.3 ? 'critical' : 'warning'),
            diagnosticChain: [
                {
                    id: 'budget',
                    label: '预算',
                    status: 'triggered',
                    evidence: `广告预算使用率 ${formatPercent(adBudgetPacing)}`,
                    nextAction: '进入广告子表按广告类型、ASIN、负责人排序。',
                },
                {
                    id: 'efficiency',
                    label: '效率',
                    status: acos > 0.35 ? 'triggered' : 'check',
                    evidence: `当前 ACoS ${formatPercent(acos)}`,
                    nextAction: '打开关键词分析，找高花费、低订单、低 CVR 的词。',
                },
            ],
        });
    }

    if (current.ad_sales > 0 && acos > 0.35) {
        issues.push({
            id: 'issue-acos',
            ruleId: 'acos-risk',
            title: '广告效率偏低',
            category: 'ads',
            severity: acos > 0.5 ? 'critical' : 'warning',
            evidence: `广告花费 ${formatMoneyNoDecimals(current.ad_spend)}，广告销售额 ${formatMoneyNoDecimals(current.ad_sales)}，ACoS ${formatPercent(acos)}`,
            impact: '广告正在买低质量销售，可能直接拖累毛利额核心目标。',
            recommendation: '按搜索词四象限处理：高花费低转化先否词或降价，高转化低曝光再加预算。',
            suggestedOwner: owner,
            suggestedDueDate: getDueDate('warning'),
            diagnosticChain: [
                {
                    id: 'search-term',
                    label: '搜索词',
                    status: 'triggered',
                    evidence: '关键词专题可导入搜索词报告并按 CTR/CVR/ACoS 分层。',
                    nextAction: '打开关键词分析，优先处理高点击低转化和高花费无订单词。',
                },
                {
                    id: 'listing-voc',
                    label: 'Listing/VOC',
                    status: 'check',
                    evidence: `平均评分 ${current.average_rating ? current.average_rating.toFixed(2) : '未提供'}`,
                    nextAction: '若 CTR 不低但 CVR 低，检查评论、退货和详情页承诺。',
                },
            ],
        });
    }

    if (inventory && inventory.fba_total_cost > 0 && agedShare > 0.2) {
        issues.push({
            id: 'issue-aged-inventory',
            ruleId: 'aged-inventory-risk',
            title: '180 天以上库存成本偏高',
            category: 'inventory',
            severity: agedShare > 0.35 ? 'critical' : 'warning',
            evidence: `180 天以上库龄成本 ${formatMoneyNoDecimals(agedCost)}，占 FBA 成本 ${formatPercent(agedShare)}`,
            impact: '库存资金被慢销品占用，继续补货或投放会放大库存风险。',
            recommendation: '按 ASIN 拆库龄金额，先做清货、控补货和广告止损。',
            suggestedOwner: owner,
            suggestedDueDate: getDueDate(agedShare > 0.35 ? 'critical' : 'warning'),
            diagnosticChain: [
                {
                    id: 'aging',
                    label: '库龄',
                    status: 'triggered',
                    evidence: `180 天以上占比 ${formatPercent(agedShare)}`,
                    nextAction: '打开库存子表，按 181 天以上成本降序排序。',
                },
                {
                    id: 'sell-through',
                    label: '动销',
                    status: 'check',
                    evidence: `当前销量 ${formatNumber(current.sales_quantity)}，FBA 总库存 ${formatNumber(inventory.fba_total_qty)}`,
                    nextAction: '对慢销但库存高的款，优先清仓而不是继续补货。',
                },
            ],
        });
    }

    if (current.average_rating > 0 && current.average_rating < 4.2) {
        issues.push({
            id: 'issue-low-rating',
            ruleId: 'low-rating-risk',
            title: '评分低于健康线',
            category: 'quality',
            severity: current.average_rating < 4 ? 'critical' : 'warning',
            evidence: `当前平均评分 ${current.average_rating.toFixed(2)}，评论数 ${formatNumber(current.review_count)}`,
            impact: '评分会同时影响自然转化、广告转化和退款概率。',
            recommendation: '打开评论与退货专题，找集中痛点并回到 Listing 预期或产品质量处理。',
            suggestedOwner: owner,
            suggestedDueDate: getDueDate('warning'),
            diagnosticChain: [
                {
                    id: 'reviews',
                    label: '评论痛点',
                    status: 'triggered',
                    evidence: `平均评分 ${current.average_rating.toFixed(2)}`,
                    nextAction: '用评论专题按差评聚类，看是否集中在质量、尺寸、描述或功能。',
                },
                {
                    id: 'refunds',
                    label: '退货原因',
                    status: 'check',
                    evidence: `退款成本 ${formatMoneyNoDecimals(current.refund_cost)}`,
                    nextAction: '用退货专题验证差评痛点是否已经进入退款。',
                },
            ],
        });
    }

    if (warnings.length > 0) {
        issues.push({
            id: 'issue-data-completeness',
            ruleId: 'data-completeness-risk',
            title: '数据可信度需要确认',
            category: 'data',
            severity: 'info',
            evidence: warnings.slice(0, 3).join('；'),
            impact: '部分结论只能作为弱判断，不能直接进入奖惩或预算调整。',
            recommendation: '先修正缺表、目标匹配或对比期问题，再做最终复盘结论。',
            suggestedOwner: '数据负责人',
            suggestedDueDate: getDueDate('info'),
            diagnosticChain: [
                {
                    id: 'coverage',
                    label: '覆盖范围',
                    status: 'triggered',
                    evidence: `${warnings.length} 条数据/目标告警`,
                    nextAction: '打开导入报告或数据诊断，确认缺失表和字段映射。',
                },
            ],
        });
    }

    if (issues.length === 0 && !isWeeklyMode) {
        issues.push({
            id: 'issue-stable-watch',
            ruleId: 'profit-pacing-risk',
            title: '当前未触发高优先级异常',
            category: 'goal',
            severity: 'info',
            evidence: '毛利额核心目标及销售、毛利率、广告、库存和口碑 KR 未触发高风险阈值。',
            impact: '当前更适合做结构优化，而不是救火。',
            recommendation: '优先按毛利额下钻 Top/Bottom ASIN，寻找可复制的正贡献对象。',
            suggestedOwner: owner,
            suggestedDueDate: getDueDate('info'),
            diagnosticChain: [
                {
                    id: 'replicate',
                    label: '正贡献复制',
                    status: 'check',
                    evidence: '未发现系统级异常',
                    nextAction: '进入 P&L 子表，找高毛利且广告占比健康的 ASIN。',
                },
            ],
        });
    }

    const severityRank = { critical: 0, warning: 1, info: 2 };
    const ruleRank: Record<string, number> = {
        'profit-pacing-risk': 0,
        'margin-gap-risk': 1,
        'ad-budget-overrun': 2,
        'acos-risk': 3,
        'aged-inventory-risk': 4,
        'low-rating-risk': 5,
        'sales-pacing-risk': 6,
        'data-completeness-risk': 7,
    };
    return issues
        .sort((a, b) => (
            severityRank[a.severity] - severityRank[b.severity]
            || (ruleRank[a.ruleId] ?? 99) - (ruleRank[b.ruleId] ?? 99)
        ))
        .slice(0, 8);
};

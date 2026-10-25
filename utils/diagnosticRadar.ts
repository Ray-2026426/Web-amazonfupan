import type { AggregatedData, DataRow } from '../types';

/**
 * 经营异常雷达：按固定判断链输出「现象 → 根因候选 → 动作」。
 *
 *   核心指标：毛利额
 *     → 达成率 / 同比 / 环比 是否异常
 *     → 异常则拆三维：销量(Volume) · 客单价(ASP) · 毛利率(Margin)
 *     → 每一维再用「曝光×CTR×CVR×ASP」和「各项成本占比」继续下钻到最底层
 *
 * 输出只给结论 + 证据 + 动作，不给一堆指标。数据不足以下结论的分支会标 needsCheck。
 */

export type Severity = 'critical' | 'warning' | 'info';
export type Dimension = 'volume' | 'asp' | 'margin';

export type Finding = {
    id: string;
    dimension: Dimension;
    severity: Severity;
    /** 现象标题，带数字 */
    title: string;
    /** 判断树上的路径 */
    path: string[];
    /** 支撑证据 */
    evidence: { label: string; value: string }[];
    /** 【动作】 */
    action: string;
    /** 数据能否直接证实；low 表示需要外部核查 */
    confidence: 'high' | 'medium' | 'low';
    /** 需要人工核对的点 */
    checks?: string[];
};

export type RadarReport = {
    core: {
        metric: 'gross_profit';
        value: number;
        attainment: number | null;
        yoy: number | null;
        mom: number | null;
        anomalous: boolean;
        verdict: string;
    };
    /** 三维的量化拆解，用于界面上的小字 */
    mix: {
        salesDelta: number;
        volumeEffect: number;
        aspEffect: number;
        marginEffect: number;
    };
    findings: Finding[];
    normalNotes: string[];
};

const safe = (value: number | null | undefined) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const signedPct = (value: number) => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
const money = (value: number) => (Math.abs(value) >= 10000 ? `${(value / 10000).toFixed(1)} 万` : value.toFixed(0));

type Side = { label: string; data: AggregatedData | null };

/** 相对变化：基准缺失或为 0 时返回 null（避免出现 +∞ 或假结论） */
const change = (current: number, base: number): number | null => {
    if (!Number.isFinite(base) || base === 0) return null;
    return (current - base) / Math.abs(base);
};

/** 比率差（百分点） */
const ratio = (part: number, total: number) => (total > 0 ? part / total : 0);

/** 按 ASIN 汇总销售额，用于判断销售结构（低价款占比）是否变化 */
function revenueByAsin(rows: DataRow[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const row of rows) {
        const key = `${row.shop_name}|${row.child_asin}`;
        map.set(key, (map.get(key) || 0) + safe(row.sales_amount));
    }
    return map;
}

export function buildRadarReport(input: {
    current: AggregatedData;
    last: AggregatedData | null;
    year: AggregatedData | null;
    target: { gross_profit: number; sales_amount: number } | null;
    currentRows?: DataRow[];
    lastRows?: DataRow[];
}): RadarReport {
    const { current, last, year, target, currentRows = [], lastRows = [] } = input;

    const gp = safe(current.gross_profit);
    const sales = safe(current.sales_amount);
    const units = safe(current.sales_quantity);
    const margin = ratio(gp, sales);
    const asp = units > 0 ? sales / units : 0;

    const attainment = target && safe(target.gross_profit) > 0 ? gp / safe(target.gross_profit) : null;
    const yoy = year ? change(gp, safe(year.gross_profit)) : null;
    const mom = last ? change(gp, safe(last.gross_profit)) : null;

    const triggerAttainment = attainment !== null && attainment < 0.9;
    const triggerYoy = yoy !== null && yoy < -0.1;
    const triggerMom = mom !== null && mom < -0.1;
    const anomalous = triggerAttainment || triggerYoy || triggerMom;

    const findings: Finding[] = [];
    const normalNotes: string[] = [];

    // 毛利额 = 销售额 × 毛利率；销售额 = 销量 × ASP
    const base = last || year;
    const baseSales = base ? safe(base.sales_amount) : 0;
    const baseMargin = base ? ratio(safe(base.gross_profit), baseSales) : 0;
    const salesDelta = base ? sales - baseSales : 0;
    const marginEffect = base ? sales * (margin - baseMargin) : 0;
    const volumeEffect = base ? (salesDelta) * baseMargin : 0;
    const baseAsp = base && safe(base.sales_quantity) > 0 ? baseSales / safe(base.sales_quantity) : 0;
    const aspEffect = base ? volumeEffect * 0 : 0; // 占位：量价拆分在下面单独算

    // ---------- 维度一：销量（曝光 × CTR × CVR × ASP） ----------
    const pushVolume = () => {
        if (!base) return;
        const baseUnits = safe(base.sales_quantity);
        const unitChange = change(units, baseUnits);
        const sessionsChange = change(safe(current.sessions), safe(base.sessions));
        const cvr = ratio(units, safe(current.sessions));
        const baseCvr = ratio(baseUnits, safe(base.sessions));
        const impressionsChange = change(safe(current.impressions), safe(base.impressions));
        const ctrChange = change(ratio(safe(current.clicks), safe(current.impressions)), ratio(safe(base.clicks), safe(base.impressions)));
        const cvrChange = change(cvr, baseCvr);
        const naturalShare = ratio(safe(current.natural_orders), safe(current.natural_orders) + safe(current.ad_orders));
        const baseNaturalShare = ratio(safe(base.natural_orders), safe(base.natural_orders) + safe(base.ad_orders));

        if (unitChange !== null && unitChange < -0.08) {
            // 先判断是流量少了还是转化差了
            const trafficDriven = sessionsChange !== null && sessionsChange < -0.05 && (cvrChange === null || cvrChange > -0.05);
            if (trafficDriven) {
                findings.push({
                    id: 'volume-traffic',
                    dimension: 'volume',
                    severity: 'critical',
                    title: `销量 ${signedPct(unitChange)}，主要是流量下降（Sessions ${signedPct(sessionsChange!)}）`,
                    path: ['销量', '展示量下降', '流量入口减少'],
                    evidence: [
                        { label: 'Sessions', value: `${safe(current.sessions).toFixed(0)}（${signedPct(sessionsChange!)}）` },
                        { label: '转化率', value: `${pct(cvr)}（${cvrChange === null ? '—' : signedPct(cvrChange)}）` },
                        { label: '自然订单占比', value: `${pct(naturalShare)}${baseNaturalShare ? `（${signedPct(naturalShare - baseNaturalShare)}）` : ''}` },
                    ],
                    action: naturalShare < baseNaturalShare - 0.05
                        ? '优先查自然位：核心词收录与排名 → 安排漏斗补单/降价刺激；同时核对大盘搜索量是否进入淡季'
                        : '优先查广告：预算是否提前超支、核心词 Bid 是否失去竞争力，必要时提预算/提 Bid',
                    confidence: 'medium',
                    checks: ['核心关键词自然排名是否掉页', '广告后台是否出现预算受限/竞价不足', '搜索词报告是否有明显偏移'],
                });
            } else if (cvrChange !== null && cvrChange < -0.05) {
                findings.push({
                    id: 'volume-cvr',
                    dimension: 'volume',
                    severity: 'critical',
                    title: `转化率 ${signedPct(cvrChange)}，销量被拖累 ${signedPct(unitChange)}`,
                    path: ['销量', '转化率下降'],
                    evidence: [
                        { label: 'CVR', value: `${pct(cvr)}（${signedPct(cvrChange)}）` },
                        { label: '退款成本占比', value: pct(ratio(safe(current.refund_cost), sales)) },
                        { label: '评分', value: safe(current.average_rating).toFixed(2) },
                    ],
                    action: '先排除内部因素：退货率标签、断货/预售、促销结束价格回弹、配送时效；再看竞品是否降价或恶搞差评',
                    confidence: 'medium',
                    checks: ['退款原因分布（缺陷/破损/描述不符）', '是否被贴高退货率标签', '近期是否改过主图/价格'],
                });
            } else if (impressionsChange !== null && impressionsChange < -0.08) {
                findings.push({
                    id: 'volume-impressions',
                    dimension: 'volume',
                    severity: 'warning',
                    title: `广告曝光 ${signedPct(impressionsChange)}，销量 ${signedPct(unitChange)}`,
                    path: ['销量', '展示量下降', '广告流量减少'],
                    evidence: [
                        { label: '广告曝光', value: `${safe(current.impressions).toFixed(0)}（${signedPct(impressionsChange)}）` },
                        { label: '广告花费', value: `${money(safe(current.ad_spend))}（${base ? signedPct(change(safe(current.ad_spend), safe(base.ad_spend)) || 0) : '—'}）` },
                        { label: 'CPC', value: (safe(current.ad_spend) / Math.max(1, safe(current.clicks))).toFixed(2) },
                    ],
                    action: '对比花费与 CPC：花费没降但曝光降 → 提 Bid/换匹配；花费降了 → 预算不足或提前超支，改分时预算',
                    confidence: 'high',
                });
            }
        }

        if (ctrChange !== null && ctrChange < -0.1) {
            findings.push({
                id: 'volume-ctr',
                dimension: 'volume',
                severity: 'warning',
                title: `广告点击率 ${signedPct(ctrChange)}，曝光没少但点的人少了`,
                path: ['销量', '点击率下降'],
                evidence: [
                    { label: 'CTR', value: `${pct(ratio(safe(current.clicks), safe(current.impressions)))}（${signedPct(ctrChange)}）` },
                    { label: '评分', value: `${safe(current.average_rating).toFixed(2)}（评论 ${safe(current.review_count).toFixed(0)}）` },
                ],
                action: '先看自身是否改过主图/标题/价格（改了就回滚再 AB）；否则对比竞品主图与 Coupon 力度，检查首页是否有显眼差评',
                confidence: 'medium',
                checks: ['主图/标题是否近期改动', '竞品主图与价格', '首页差评与评分变化'],
            });
        }

        // 库存与购物车
        const stockNow = safe(current.fba_sellable_qty);
        const stockBase = safe(base.fba_sellable_qty);
        if (stockBase > 0 && stockNow / stockBase < 0.6) {
            findings.push({
                id: 'volume-stock',
                dimension: 'volume',
                severity: 'critical',
                title: `可售库存降到 ${stockBase > 0 ? pct(stockNow / stockBase) : '—'}，可能触发低库存限流`,
                path: ['销量', '运营及系统限制', '低库存保护机制'],
                evidence: [
                    { label: '可售库存', value: `${stockNow.toFixed(0)}（上期 ${stockBase.toFixed(0)}）` },
                    { label: '日均销量', value: (units / Math.max(1, 30)).toFixed(1) },
                ],
                action: '核对补货时效与在途；若已断货，先盯购物车丢失（跟卖/价格竞争力）',
                confidence: 'high',
            });
        }
    };

    // ---------- 维度二：客单价 ----------
    const pushAsp = () => {
        if (!base || baseAsp <= 0 || asp <= 0) return;
        const aspChange = change(asp, baseAsp);
        if (aspChange === null || aspChange > -0.02) return;

        // 销售结构：低价款占比是否上升
        let mixNote: string | null = null;
        if (currentRows.length && lastRows.length) {
            const now = revenueByAsin(currentRows);
            const past = revenueByAsin(lastRows);
            const keys = new Set([...now.keys(), ...past.keys()]);
            let shift = 0;
            for (const key of keys) {
                const nowShare = ratio(now.get(key) || 0, sales || 1);
                const pastShare = ratio(past.get(key) || 0, baseSales || 1);
                shift += Math.abs(nowShare - pastShare);
            }
            mixNote = `销售结构变动幅度 ${pct(shift / 2)}`;
        }

        findings.push({
            id: 'asp-drop',
            dimension: 'asp',
            severity: 'warning',
            title: `客单价 ${signedPct(aspChange)}（${baseAsp.toFixed(1)} → ${asp.toFixed(1)}）`,
            path: ['客单价', '折扣与促销 / 销售结构 / 价格战'],
            evidence: [
                { label: 'ASP', value: `${asp.toFixed(2)}（${signedPct(aspChange)}）` },
                { label: '销量变化', value: signedPct(change(units, safe(base.sales_quantity)) || 0) },
                ...(mixNote ? [{ label: '结构', value: mixNote }] : []),
            ],
            action: '先排促销叠加（Coupon/Deal/BOGO 折上折）；再看低价变体占比是否上升；最后判断是否被动跟进价格战',
            confidence: 'medium',
            checks: ['Coupon/Deal 是否叠加', '各变体销量占比变化', '竞品价格走势'],
        });
    };

    // ---------- 维度三：毛利率 ----------
    const pushMargin = () => {
        if (!base || baseSales <= 0 || sales <= 0) return;
        const marginChange = margin - baseMargin;
        if (marginChange > -0.01) return;

        const items: { key: string; label: string; path: string[]; action: string; checks?: string[] }[] = [
            { key: 'procurement_cost', label: '采购成本', path: ['毛利率', '基础成本', '采购成本占比'], action: '供应链谈判或寻找备用供应商；确认是否因客单价下降被动拉高占比' },
            { key: 'first_mile_cost', label: '头程物流', path: ['毛利率', '基础成本', '头程物流占比'], action: '核运费单价与发货渠道（空运/海运）；检查外箱是否超材/泡重', checks: ['运费单价是否上涨', '外箱尺寸重量是否变化'] },
            { key: 'platform_commission', label: '平台佣金', path: ['毛利率', '基础成本', '平台佣金占比'], action: '检查类目节点是否被错放，申请修正类目' },
            { key: 'refund_cost', label: '退款成本', path: ['毛利率', '基础成本', '退款成本占比'], action: '做退款原因深度分析（缺陷/破损/描述不符），必要时更新变体或改包装', checks: ['退款原因分布', '是否同比/环比突发偏离'] },
            { key: 'fba_fee', label: 'FBA 配送费', path: ['毛利率', '基础成本', 'FBA 配送费占比'], action: '若包装/尺寸变更导致 Fee Tier 升级，立即申请重测（Remeasure）', checks: ['FBA 费率是否升级', '尺寸重量是否被重新测量'] },
            { key: 'storage_fee', label: '仓储费', path: ['毛利率', '基础成本', '仓储费占比'], action: '严控冗余库存，清理长期库龄，提高库容利用率' },
            { key: 'ad_spend', label: '广告（TACOS）', path: ['毛利率', '营销成本', 'TACOS 上升'], action: '拆 ACOS：CPC 飙升→避锋芒打长尾；广告 CVR 跌→查搜索词做否定；自然位下滑→减少核心词内耗', checks: ['CPC 是否飙升', '广告 CVR 与搜索词报告'] },
        ];

        const scored = items.map(item => {
            const nowRatio = ratio(safe((current as any)[item.key]), sales);
            const baseRatio = ratio(safe((base as any)[item.key]), baseSales);
            return { ...item, nowRatio, baseRatio, delta: nowRatio - baseRatio };
        }).filter(item => item.delta > 0.005).sort((a, b) => b.delta - a.delta).slice(0, 3);

        for (const item of scored) {
            findings.push({
                id: `margin-${item.key}`,
                dimension: 'margin',
                severity: item.delta > 0.03 ? 'critical' : 'warning',
                title: `${item.label}占比上升 ${(item.delta * 100).toFixed(1)}pp（毛利率 ${(marginChange * 100).toFixed(1)}pp）`,
                path: item.path,
                evidence: [
                    { label: `${item.label}占销售额`, value: `${pct(item.nowRatio)}（上期 ${pct(item.baseRatio)}）` },
                    { label: '毛利率', value: `${pct(margin)}（${(marginChange * 100).toFixed(1)}pp）` },
                ],
                action: item.action,
                confidence: 'high',
                checks: item.checks,
            });
        }
    };

    pushVolume();
    pushAsp();
    pushMargin();

    const order: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
    findings.sort((a, b) => order[a.severity] - order[b.severity]);

    if (!anomalous) {
        normalNotes.push('毛利额达成率、同比、环比均在阈值内（达成 ≥90%、同比/环比 ≥-10%）');
        normalNotes.push('维持现状，持续日常监控；建议重点关注库存周转与广告占比两项先行指标');
    }

    const verdict = anomalous
        ? `毛利额 ${money(gp)}，${[
            attainment !== null ? `达成 ${pct(attainment)}` : '',
            yoy !== null ? `同比 ${signedPct(yoy)}` : '',
            mom !== null ? `环比 ${signedPct(mom)}` : '',
        ].filter(Boolean).join(' · ')}，已触发诊断`
        : `毛利额 ${money(gp)}，各项在阈值内`;

    return {
        core: { metric: 'gross_profit', value: gp, attainment, yoy, mom, anomalous, verdict },
        mix: { salesDelta, volumeEffect, aspEffect, marginEffect },
        findings: findings.slice(0, 8),
        normalNotes,
    };
}

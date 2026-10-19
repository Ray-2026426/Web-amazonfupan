/**
 * 趋势「一句话结论」生成器
 *
 * 图只回答「长什么样」，运营复盘要的是「所以呢」：
 * 涨了还是跌了、达成没有、拐点在哪。这里把这三个问题压成 1~2 句、
 * 最多 3 个数字，避免又一堆要自己读的指标。
 *
 * 纯函数，不依赖 React / recharts，便于单测。
 */

export type InsightTone = 'strong' | 'pos' | 'neg';

export type InsightSpan = { text: string; tone?: InsightTone };

export interface TrendInsightArgs {
    /** 按时间升序的序列 */
    points: { time: string; value: number }[];
    /** 值格式化（金额 / 百分比 / 计数） */
    formatter: (v: number) => string;
    /** 最后一期的目标值（有目标类指标时传入） */
    target?: number | null;
    /** 趋势变好/变坏的语义：成本类指标「涨」是坏消息 */
    higherIsBetter?: boolean;
    /** 时期短标签，如 25/09；缺省直接显示 key */
    periodLabel?: (time: string) => string;
}

/** 判断成本类指标：这些「涨」不是好消息，结论里不写「上升」而是「走高」 */
const COST_METRIC_RE = /广告花费|广告占比|ACoS|ACOS|CPC|退款|仓储|采购|头程|FBA费|佣金|成本/;

export const isCostMetric = (title: string): boolean => COST_METRIC_RE.test(title);

const pct = (x: number) => `${Math.abs(x * 100).toFixed(1)}%`;
const arrow = (x: number) => (x > 0 ? '▲' : x < 0 ? '▼' : '—');

export function buildTrendInsight({
    points,
    formatter,
    target,
    higherIsBetter = true,
    periodLabel = t => t,
}: TrendInsightArgs): InsightSpan[] {
    const valid = points.filter(p => Number.isFinite(p.value));
    if (valid.length < 2) {
        return [{ text: valid.length === 0 ? '暂无数据' : '仅一期数据，暂不足以判断趋势' }];
    }

    const first = valid[0];
    const last = valid[valid.length - 1];
    const prev = valid[valid.length - 2];
    const n = valid.length;
    const spans: InsightSpan[] = [];

    // 1) 整体走势（首尾对比）
    if (first.value === 0) {
        spans.push({ text: `近 ${n} 期首期为 0，暂不计算整体变化；` });
    } else {
        const change = (last.value - first.value) / Math.abs(first.value);
        if (Math.abs(change) < 0.03) {
            spans.push({ text: `近 ${n} 期基本持平` });
        } else {
            // 成本类指标不用「上升/下降」（涨不一定是坏事），统一用「走高/回落」
            const up = change > 0;
            const word = higherIsBetter ? (up ? '上升' : '下降') : up ? '走高' : '回落';
            spans.push({ text: `近 ${n} 期整体${word} ` }, { text: pct(change), tone: 'strong' });
        }
        spans.push({ text: '；' });
    }

    // 2) 最近一期 + 环比
    spans.push({ text: '最近一期 ' }, { text: formatter(last.value), tone: 'strong' });
    if (prev && prev.value !== 0) {
        const mom = (last.value - prev.value) / Math.abs(prev.value);
        spans.push({ text: `（${periodLabel(last.time)}）环比 ` });
        if (Math.abs(mom) < 0.0005) spans.push({ text: '持平' });
        else spans.push({ text: `${arrow(mom)}${pct(mom)}`, tone: 'strong' });
    }

    // 3) 目标达成
    if (typeof target === 'number' && target > 0) {
        const rate = last.value / target;
        const gap = Math.abs(rate - 1);
        spans.push({ text: `，${rate >= 1 ? '高于目标' : '距目标差'} ` }, { text: pct(gap), tone: rate >= 1 ? 'pos' : 'neg' });
    }
    spans.push({ text: '。' });

    // 4) 区间极值（只在最近一期不是极值时补充，否则等于重复）
    const values = valid.map(p => p.value);
    const maxValue = Math.max(...values);
    const minValue = Math.min(...values);
    const isLastMax = last.value === maxValue;
    const isLastMin = last.value === minValue;
    if (!isLastMax && !isLastMin) {
        const maxPoint = valid.find(p => p.value === maxValue)!;
        const minPoint = valid.find(p => p.value === minValue)!;
        spans.push(
            { text: `区间最高 ${periodLabel(maxPoint.time)}（` },
            { text: formatter(maxValue), tone: 'strong' },
            { text: `），最低 ${periodLabel(minPoint.time)}（` },
            { text: formatter(minValue), tone: 'strong' },
            { text: '）。' }
        );
    } else if (isLastMax && minValue !== maxValue) {
        const minPoint = valid.find(p => p.value === minValue)!;
        spans.push(
            { text: '最近一期为区间最高；区间最低 ' },
            { text: periodLabel(minPoint.time), tone: 'strong' },
            { text: '（' },
            { text: formatter(minValue), tone: 'strong' },
            { text: '）。' }
        );
    }

    return spans;
}

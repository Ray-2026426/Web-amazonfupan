/**
 * 图表视觉令牌（亮 / 暗两套）
 *
 * 为什么单独抽一个文件：
 *   · recharts 的坐标轴、网格、tooltip 都是「内联到 SVG 的 style 属性」，
 *     Tailwind 工具类管不到（本项目的暗色模式靠覆盖工具类实现），
 *     所以颜色必须由 JS 显式下发，否则暗色下图表仍是一块白底 + 灰字。
 *   · 之前每张图各写一套硬编码色值（#e2e8f0 / #64748b / 3px 线 + 白心圆点），
 *     结果同一个系统里的两张图看起来像两个产品。这里集中定义，改一次全对。
 *
 * 视觉参照：Vercel Analytics / Linear / Tremor 的图表——
 * 细线、极淡网格、无点点、悬浮高亮、克制用色。
 */
import { useEffect, useState } from 'react';

export type ChartTheme = {
    isDark: boolean;
    /** 水平网格线（几乎不可见，只用来对齐读数） */
    grid: string;
    /** 坐标轴刻度文字 */
    axisTick: string;
    /** 悬浮十字准星 */
    cursor: string;
    /** 图表所在卡片底色（用于给数据点描边，做「挖空」效果） */
    surface: string;
    tooltipBg: string;
    tooltipBorder: string;
    tooltipShadow: string;
    text: string;
    textMuted: string;
    textSubtle: string;
    positive: string;
    negative: string;
    /** 目标 / 预算线：与「实际」形成稳定语义（实线=实际，虚线=目标） */
    target: string;
    /** 多指标配色序列，按出现顺序取用 */
    series: string[];
};

const LIGHT: ChartTheme = {
    isDark: false,
    grid: '#eef2f7',
    axisTick: '#94a3b8',
    cursor: '#cbd5e1',
    surface: '#ffffff',
    tooltipBg: 'rgba(255, 255, 255, 0.97)',
    tooltipBorder: '#e2e8f0',
    tooltipShadow: '0 18px 40px -20px rgba(15, 23, 42, 0.35), 0 2px 8px -4px rgba(15, 23, 42, 0.12)',
    text: '#0f172a',
    textMuted: '#64748b',
    textSubtle: '#94a3b8',
    positive: '#059669',
    negative: '#e11d48',
    target: '#d97706',
    series: [
        '#2563eb', // 蓝：主指标
        '#0d9488', // 青绿
        '#7c3aed', // 紫
        '#d97706', // 琥珀
        '#e11d48', // 玫红
        '#0891b2', // 青
        '#16a34a', // 绿
        '#c026d3', // 品红
        '#ea580c', // 橙
        '#475569', // 石板灰
    ],
};

const DARK: ChartTheme = {
    isDark: true,
    grid: '#232a33',
    axisTick: '#8b949e',
    cursor: '#484f58',
    surface: '#161b22',
    tooltipBg: 'rgba(13, 17, 23, 0.97)',
    tooltipBorder: '#30363d',
    tooltipShadow: '0 20px 44px -18px rgba(0, 0, 0, 0.85)',
    text: '#e6edf3',
    textMuted: '#8b949e',
    textSubtle: '#6e7681',
    positive: '#3fb950',
    negative: '#f85149',
    target: '#e3b341',
    series: [
        '#60a5fa',
        '#2dd4bf',
        '#a78bfa',
        '#fbbf24',
        '#fb7185',
        '#22d3ee',
        '#4ade80',
        '#e879f9',
        '#fb923c',
        '#94a3b8',
    ],
};

const readIsDark = () => {
    if (typeof document === 'undefined') return false;
    return document.documentElement.classList.contains('dark');
};

/** 跟随 html.dark（主题开关改的是根节点 class），图表因此能随主题实时换色 */
export function useChartTheme(): ChartTheme {
    const [isDark, setIsDark] = useState(readIsDark);

    useEffect(() => {
        const root = document.documentElement;
        const sync = () => setIsDark(root.classList.contains('dark'));
        sync();
        const observer = new MutationObserver(sync);
        observer.observe(root, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);

    return isDark ? DARK : LIGHT;
}

export const seriesColor = (theme: ChartTheme, index: number): string =>
    theme.series[index % theme.series.length];

/** 坐标轴用的紧凑数字：1.2k / 3.4M / 12 */
export function compactNumber(value: number): string {
    const abs = Math.abs(value);
    if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 0 : 1)}B`;
    if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
    if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
    return String(Math.round(value));
}

/** 坐标轴刻度：金额加货币符号，比率转百分比，其余走紧凑数字 */
export function compactTick(
    value: number,
    opts: { isMoney?: boolean; isPercent?: boolean; symbol?: string } = {}
): string {
    if (!Number.isFinite(value)) return '';
    if (opts.isPercent) return `${(value * 100).toFixed(0)}%`;
    const body = compactNumber(value);
    if (opts.isMoney) return `${opts.symbol ?? '$'}${body}`;
    return body;
}

/**
 * 环比变化：用于 tooltip 的「较上期」。
 * 只返回方向，颜色由调用方按主题取（positive / negative），避免把配色写死在工具函数里。
 * 注意：这里只描述「涨/跌」，不暗示「好/坏」——广告花费涨了并不一定是好事。
 */
export function formatDelta(current: number, previous: number | undefined | null): {
    text: string;
    direction: 'up' | 'down' | 'flat';
} | null {
    if (previous === undefined || previous === null) return null;
    if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
    if (previous === 0) {
        if (current === 0) return { text: '持平', direction: 'flat' };
        return { text: '新增', direction: 'up' };
    }
    const ratio = (current - previous) / Math.abs(previous);
    if (!Number.isFinite(ratio)) return null;
    if (Math.abs(ratio) < 0.0005) return { text: '持平', direction: 'flat' };
    const arrow = ratio > 0 ? '▲' : '▼';
    return { text: `${arrow} ${Math.abs(ratio * 100).toFixed(1)}%`, direction: ratio > 0 ? 'up' : 'down' };
}

/* ------------------------------------------------------------------ *
 * 时间标签：横轴短标签与悬浮用完整标签，统一在此处理
 * ------------------------------------------------------------------ */

const MONTH_KEY_RE = /^(\d{4})-(\d{2})$/;
const WEEK_KEY_RE = /^(\d{4})-W(\d{2})$/;

/** 横轴短标签：月 → 25/03；周 → W15（跨年时补两位年份，如 26W01） */
export function buildAxisTickLabels(keys: string[], isWeekly: boolean): Record<string, string> {
    const labels: Record<string, string> = {};
    let lastYear = '';
    keys.forEach(key => {
        const m = isWeekly ? key.match(WEEK_KEY_RE) : key.match(MONTH_KEY_RE);
        const year = m ? m[1].slice(2) : '';
        if (isWeekly) {
            labels[key] = year && year !== lastYear ? `${year}W${m?.[2] ?? ''}` : `W${m?.[2] ?? ''}`;
        } else {
            // 月：始终带两位年份，避免「1月」在同轴出现两次无法区分
            labels[key] = m ? `${year}/${m[2]}` : key;
        }
        lastYear = year;
    });
    return labels;
}

/** 悬浮提示标题：月 → 2025年5月；周 → 2025 第15周（3/2–3/8） */
export function formatPeriodLabel(
    key: string,
    weekRange?: (weekYear: number, week: number) => { start: Date; end: Date }
): { title: string; subtitle?: string } {
    const m = key.match(MONTH_KEY_RE);
    if (m) return { title: `${m[1]}年${Number(m[2])}月` };
    const w = key.match(WEEK_KEY_RE);
    if (w) {
        const base = { title: `${w[1]} 第${Number(w[2])}周` };
        if (!weekRange) return base;
        const { start, end } = weekRange(Number(w[1]), Number(w[2]));
        const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
        return { ...base, subtitle: `${fmt(start)}–${fmt(end)}` };
    }
    return { title: key };
}

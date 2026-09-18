/**
 * 生成 dark-theme.css —— 暗色模式工具类覆盖表。
 *
 * 为什么需要生成器：暗色模式靠「html.dark 下覆盖工具类」实现，覆盖必须覆盖到
 * 源码里真正用到的每一个类。手写清单漏了 300 多个类中的绝大多数（bg-red-50、
 * bg-amber-50、text-amber-900 之类），暗色下这些浅色底仍然是近白色，就是「刺眼」的根因。
 *
 * 生成规则是「按属性 + 色相 + 色阶」推导暗色取值，而不是逐类硬编码：
 *   - 中性色（slate/gray/zinc/neutral/stone）的 bg 分两套语义：
 *       · 不透明 / 高透明度(≥60%) 的 50~300 是「面板表面」→ 映射成深色表面
 *       · 低透明度(≤50%) 的 50 是「斑马纹 / hover 高亮」→ 映射成极淡白色 tint
 *         （深色卡片上比卡片更亮一点点，才是正确的条纹观感）
 *   - 彩色 50~300 的 bg 是「浅色 tint 底」→ 映射成同色相半透明 tint
 *   - 彩色 400+ 的 bg 是「实心强调色（按钮/指示灯）」→ 保持不动
 *   - 彩色 text 的 600+ 是「浅底上的深字」→ 提亮到 -200/-300/-400 档
 *   - 彩色 text 的 ≤400 本来就是浅色（深底上的字）→ 保持不动
 *   - border / ring / divide 的 100~300 → 同色相半透明，保持「描边可见但不刺眼」
 *
 * 用法：node scripts/gen-dark-theme.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, scanPalette, escapeClass } from './scan-palette.mjs';

/* ------------------------------------------------------------------ *
 * 暗色调色板基准（参考 GitHub Dark，数据密集型界面久看不累）
 * ------------------------------------------------------------------ */
const SURFACE = {
    page: '#0d1117',
    card: '#161b22',
    subtle: '#1c2128',
    chip: '#21262d',
    raised: '#2d333b',
    lineStrong: '#3e4651',
    line: '#30363d',
    lineSoft: '#21262d',
    text: '#e6edf3',
    textDim: '#c9d1d9',
    textMuted: '#8b949e',
    textFaint: '#9aa4ae',
    textBright: '#dde3ea',
    textMax: '#f0f6fc',
    tint: '177, 186, 196', // 中性「比卡片更亮一点点」的 tint
};

const NEUTRAL_HUES = new Set(['slate', 'gray', 'zinc', 'neutral', 'stone']);

/** 每个色相在暗色下的 rgb（用于半透明 tint）与 200/300/400 文字档 */
const HUE = {
    red: { rgb: [248, 113, 113], 200: '#fecaca', 300: '#fca5a5', 400: '#f87171' },
    orange: { rgb: [251, 146, 60], 200: '#fed7aa', 300: '#fdba74', 400: '#fb923c' },
    amber: { rgb: [251, 191, 36], 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24' },
    yellow: { rgb: [250, 204, 21], 200: '#fef08a', 300: '#fde047', 400: '#facc15' },
    lime: { rgb: [163, 230, 53], 200: '#d9f99d', 300: '#bef264', 400: '#a3e635' },
    green: { rgb: [74, 222, 128], 200: '#bbf7d0', 300: '#86efac', 400: '#4ade80' },
    emerald: { rgb: [52, 211, 153], 200: '#a7f3d0', 300: '#6ee7b7', 400: '#34d399' },
    teal: { rgb: [45, 212, 191], 200: '#99f6e4', 300: '#5eead4', 400: '#2dd4bf' },
    cyan: { rgb: [34, 211, 238], 200: '#a5f3fc', 300: '#67e8f9', 400: '#22d3ee' },
    sky: { rgb: [56, 189, 248], 200: '#bae6fd', 300: '#7dd3fc', 400: '#38bdf8' },
    blue: { rgb: [88, 166, 255], 200: '#cae8ff', 300: '#a5d6ff', 400: '#79c0ff' },
    indigo: { rgb: [129, 140, 248], 200: '#c7d2fe', 300: '#a5b4fc', 400: '#818cf8' },
    violet: { rgb: [167, 139, 250], 200: '#ddd6fe', 300: '#c4b5fd', 400: '#a78bfa' },
    purple: { rgb: [192, 132, 252], 200: '#e9d5ff', 300: '#d8b4fe', 400: '#c084fc' },
    fuchsia: { rgb: [232, 121, 249], 200: '#f5d0fe', 300: '#f0abfc', 400: '#e879f9' },
    pink: { rgb: [244, 114, 182], 200: '#fbcfe8', 300: '#f9a8d4', 400: '#f472b6' },
    rose: { rgb: [251, 113, 133], 200: '#fecdd3', 300: '#fda4af', 400: '#fb7185' },
};

/** 中性色：bg 表面 / bg 半透明暗面 / text / border-ring */
const NEUTRAL = {
    bgSolid: {
        50: SURFACE.subtle, 100: SURFACE.chip, 200: SURFACE.raised, 300: SURFACE.lineStrong,
        400: '#4d5762', 500: '#5c6773', 600: '#444c56',
        700: SURFACE.chip, 800: SURFACE.card, 900: SURFACE.page, 950: '#010409',
    },
    bgAlphaRgb: { 50: [28, 33, 40], 100: [33, 38, 45], 200: [45, 51, 59], 300: [62, 70, 81] },
    text: {
        50: SURFACE.textMax, 100: SURFACE.textMax, 200: SURFACE.textBright, 300: SURFACE.textDim,
        400: SURFACE.textFaint, 500: SURFACE.textMuted, 600: SURFACE.textDim, 700: SURFACE.textDim,
        800: SURFACE.text, 900: SURFACE.text, 950: SURFACE.text,
    },
    line: {
        50: SURFACE.lineSoft, 100: SURFACE.lineSoft, 200: SURFACE.line, 300: SURFACE.lineStrong,
        400: '#4d5762', 500: '#57606a', 600: '#5c6773',
        700: SURFACE.line, 800: SURFACE.line, 900: SURFACE.lineSoft, 950: SURFACE.lineSoft,
    },
};

/* ------------------------------------------------------------------ *
 * 取值推导
 * ------------------------------------------------------------------ */
const hexToRgb = (hex) => {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const rgba = (rgb, a) => `rgba(${rgb.join(', ')}, ${Number(a.toFixed(3))})`;

/** 彩色浅 tint 底（bg 的 50~300）基础不透明度 */
const TINT_BG_ALPHA = { 50: 0.15, 100: 0.22, 200: 0.3, 300: 0.38 };
/** 彩色描边（border / ring / divide 的 100~300）基础不透明度 */
const TINT_LINE_ALPHA = { 50: 0.2, 100: 0.28, 200: 0.4, 300: 0.5 };

/**
 * 推导单个工具类在暗色下应取的声明值。
 * @returns {{prop: string, value: string} | null} null = 暗色下无需覆盖（原值已经合适）
 */
function darkDeclaration({ prop, hue, shade, opacity }) {
    const neutral = NEUTRAL_HUES.has(hue);

    if (prop === 'bg') {
        if (neutral) {
            if (shade == null) return null;
            if (opacity != null) {
                // 深色 + 半透明 = 模态遮罩 / 深色浮层，叠在深色底上本来就是对的，保持不动
                if (shade >= 600) return null;
                // 浅色 + 低透明度 = 斑马纹 / hover 高亮：深色卡片上要「比卡片亮一点点」
                if (opacity <= 50) {
                    return { prop: 'background-color', value: rgba(hexToRgb('#b1bac4'), 0.02 + 0.0008 * opacity) };
                }
                // 浅色 + 高透明度 = 当作面板表面用 → 深色表面（保留透明度）
                const rgb = NEUTRAL.bgAlphaRgb[shade];
                if (!rgb) return null;
                return { prop: 'background-color', value: rgba(rgb, opacity / 100) };
            }
            const v = NEUTRAL.bgSolid[shade];
            return v ? { prop: 'background-color', value: v } : null;
        }
        // 彩色：>=400 是实心强调色（按钮 / 指示灯），暗色下保持不动
        if (shade == null || shade >= 400) return null;
        const base = TINT_BG_ALPHA[shade];
        if (base == null) return null;
        const a = opacity == null ? base : Math.max(0.1, base * (opacity / 100));
        return { prop: 'background-color', value: rgba(HUE[hue].rgb, a) };
    }

    if (prop === 'text') {
        if (neutral) {
            const v = NEUTRAL.text[shade];
            if (!v) return null;
            if (opacity != null) return { prop: 'color', value: rgba(hexToRgb(v), opacity / 100) };
            return { prop: 'color', value: v };
        }
        // 彩色 <=400 本来就是浅色（深底上的字），不动
        if (shade == null || shade <= 400) return null;
        const tone = HUE[hue];
        const v = shade <= 600 ? tone[400] : shade === 700 ? tone[300] : tone[200];
        if (opacity != null) return { prop: 'color', value: rgba(hexToRgb(v), opacity / 100) };
        return { prop: 'color', value: v };
    }

    if (prop === 'border' || prop === 'divide') {
        const decl = prop === 'divide' ? 'border-color' : 'border-color';
        if (neutral) {
            const v = NEUTRAL.line[shade];
            if (!v) return null;
            if (opacity != null) return { prop: decl, value: rgba(hexToRgb(v), opacity / 100) };
            return { prop: decl, value: v };
        }
        if (shade == null || shade >= 400) return null;
        const base = TINT_LINE_ALPHA[shade];
        if (base == null) return null;
        const a = opacity == null ? base : base * (opacity / 100);
        return { prop: decl, value: rgba(HUE[hue].rgb, a) };
    }

    if (prop === 'ring') {
        if (neutral) {
            const v = NEUTRAL.line[shade];
            if (!v) return null;
            const val = opacity != null ? rgba(hexToRgb(v), opacity / 100) : v;
            return { prop: '--tw-ring-color', value: val };
        }
        if (shade == null || shade >= 400) return null;
        const base = TINT_LINE_ALPHA[shade];
        if (base == null) return null;
        const a = opacity == null ? base : base * (opacity / 100);
        return { prop: '--tw-ring-color', value: rgba(HUE[hue].rgb, a) };
    }

    // from / via / to（渐变停靠色）与 shadow-*（阴影颜色）在暗色下保持不变：
    // 渐变本身就是饱和色/半透明色，阴影则被 index.css 的全局规则统一压掉。
    return null;
}

/* ------------------------------------------------------------------ *
 * 变体前缀 → 选择器
 * ------------------------------------------------------------------ */
const PSEUDO = {
    hover: ':hover',
    focus: ':focus',
    'focus-within': ':focus-within',
    'focus-visible': ':focus-visible',
    active: ':active',
    disabled: ':disabled',
    even: ':nth-child(even)',
    odd: ':nth-child(odd)',
    first: ':first-child',
    last: ':last-child',
    placeholder: '::placeholder',
};

function buildSelector(token, variants) {
    let suffix = '';
    let ancestor = '';
    for (const v of variants) {
        if (v === 'group-hover') {
            ancestor += '.group:hover ';
        } else if (v === 'group-focus') {
            ancestor += '.group:focus ';
        } else if (PSEUDO[v]) {
            suffix += PSEUDO[v];
        } else {
            // 未知变体：宁可报错，也不要悄悄生成一条永不生效的规则
            throw new Error(`未处理的变体前缀 "${v}"（token: ${token}）。请补充 PSEUDO 映射。`);
        }
    }
    return `html.dark ${ancestor}.${escapeClass(token)}${suffix}`;
}

/* ------------------------------------------------------------------ *
 * 非调色板工具类（white / black 系列）与图表、SVG 的暗色处理
 * 这些不走扫描（white/black 不在 HUES 里），但同样必须覆盖。
 * ------------------------------------------------------------------ */
const EXTRA_SECTION = `
/* ---------- white / black 系列 ----------
 * 说明：bg-white/* 的低透明度（10/15/20）用于「彩色深底上的浅色叠层」，
 * 暗色下保持半透明白才是对的，因此不做覆盖；只有 60 以上（当作面板表面用）
 * 以及 hover/focus 态的纯白才需要变暗。
 */
html.dark .bg-white { background-color: ${SURFACE.card} !important; }
html.dark .bg-white\\/60 { background-color: rgba(22, 27, 34, 0.60) !important; }
html.dark .bg-white\\/70 { background-color: rgba(22, 27, 34, 0.70) !important; }
html.dark .bg-white\\/75 { background-color: rgba(22, 27, 34, 0.75) !important; }
html.dark .bg-white\\/80 { background-color: rgba(22, 27, 34, 0.80) !important; }
html.dark .bg-white\\/85 { background-color: rgba(22, 27, 34, 0.85) !important; }
html.dark .bg-white\\/90 { background-color: rgba(22, 27, 34, 0.90) !important; }
html.dark .bg-white\\/95 { background-color: rgba(22, 27, 34, 0.95) !important; }
html.dark .hover\\:bg-white:hover,
html.dark .focus\\:bg-white:focus { background-color: ${SURFACE.card} !important; }
html.dark .hover\\:bg-white\\/50:hover { background-color: rgba(${SURFACE.tint}, 0.12) !important; }

html.dark .border-white,
html.dark .border-white\\/60,
html.dark .border-white\\/70,
html.dark .border-white\\/80,
html.dark .border-white\\/90 { border-color: ${SURFACE.line} !important; }

html.dark .ring-white\\/70 { --tw-ring-color: rgba(48, 54, 61, 0.90) !important; }

/* ---------- 图表 / SVG ----------
 * 图表把颜色写在 SVG 属性上（stroke="#e2e8f0" 等），属性选择器 + CSS 属性
 * 可以覆盖呈现属性（presentation attribute 优先级最低），所以不必改组件代码。
 */
html.dark [stroke="#e2e8f0"],
html.dark [stroke="#f1f5f9"],
html.dark [stroke="#f8fafc"],
html.dark [stroke="#cbd5e1"] { stroke: ${SURFACE.line} !important; }

html.dark [stroke="#94a3b8"] { stroke: #4d5762 !important; }

html.dark [fill="white"],
html.dark [fill="#fff"],
html.dark [fill="#ffffff"] { fill: ${SURFACE.text} !important; }

/* Recharts：坐标轴刻度、参考线、hover 指示线与 Tooltip 都是内联样式，
 * 内联样式不能被普通 CSS 覆盖，必须 !important。
 */
html.dark .recharts-cartesian-axis-tick-value { fill: ${SURFACE.textMuted} !important; }
html.dark .recharts-cartesian-axis-line,
html.dark .recharts-cartesian-axis-tick-line { stroke: ${SURFACE.line} !important; }
html.dark .recharts-tooltip-cursor { stroke: ${SURFACE.lineStrong} !important; }
html.dark .recharts-default-tooltip {
    background-color: rgba(33, 38, 45, 0.96) !important;
    border-color: ${SURFACE.line} !important;
    color: ${SURFACE.text} !important;
}
html.dark .recharts-tooltip-label { color: ${SURFACE.text} !important; }
html.dark .recharts-legend-item-text { color: ${SURFACE.textDim} !important; }
html.dark .recharts-reference-line line { stroke: #4d5762 !important; }
`;

/* ------------------------------------------------------------------ *
 * 生成
 * ------------------------------------------------------------------ */
const ORDER = ['bg', 'text', 'border', 'divide', 'ring', 'from', 'via', 'to', 'fill', 'stroke', 'placeholder'];

/** Tailwind v3 的标准色阶。出现别的数字说明类名写错了（Tailwind 不会生成任何样式）。 */
const VALID_SHADES = new Set([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]);

const PROP_TITLE = {
    bg: '背景色 bg-*',
    text: '文字色 text-*',
    border: '边框色 border-*',
    divide: '分隔线 divide-*',
    ring: '外描边 ring-*',
    from: '渐变起点 from-*（暗色下保持原样，仅列出以便核对）',
    via: '渐变中点 via-*（同上）',
    to: '渐变终点 to-*（同上）',
    shadow: '阴影色 shadow-*（由 index.css 统一压掉）',
};

function generate() {
    const { summary, tokens } = scanPalette();

    // 无效色阶检测：Tailwind 里不存在 slate-850 之类的颜色，
    // 这类类名不会生成任何样式（等于没写），必须当错误报出来。
    const invalid = tokens.filter((t) => t.shade != null && !VALID_SHADES.has(t.shade));
    if (invalid.length) {
        const msg = invalid
            .map((t) => `  ${t.token}  ← ${t.files.slice(0, 3).join(', ')}`)
            .join('\n');
        throw new Error(
            `发现无效的 Tailwind 颜色类名（该色阶不存在，样式不会生效，请修正源码）：\n${msg}`,
        );
    }

    const grouped = new Map();
    const skipped = [];
    const rules = [];

    for (const t of tokens) {
        const decl = darkDeclaration(t);
        if (!decl) {
            skipped.push(t);
            continue;
        }
        const selector = buildSelector(t.token, t.variants);
        rules.push({ prop: t.prop, selector, decl, token: t.token });
        if (!grouped.has(t.prop)) grouped.set(t.prop, []);
        grouped.get(t.prop).push({ selector, decl });
    }

    const parts = [];
    parts.push(`/*
 * dark-theme.css —— 暗色模式工具类覆盖表（自动生成，请勿手改）
 *
 * 由 scripts/gen-dark-theme.mjs 根据源码里实际用到的 ${summary.distinctTokens} 个
 * 调色板工具类（共 ${summary.totalOccurrences} 处）生成。
 * 重新生成： node scripts/gen-dark-theme.mjs
 * 校验覆盖率：node scripts/verify-dark-theme.mjs
 *
 * 设计要点见生成器顶部注释；核心是「按属性 + 色相 + 色阶推导」而不是逐类硬编码，
 * 因此不会再出现「漏了某个 bg-*-50 导致暗色下露出白块」的问题。
 */

`);

    const orderedProps = [...ORDER.filter((p) => grouped.has(p)), ...[...grouped.keys()].filter((p) => !ORDER.includes(p))];

    for (const prop of orderedProps) {
        const items = grouped.get(prop);
        parts.push(`/* ---------- ${PROP_TITLE[prop] || prop} （${items.length} 条） ---------- */`);
        for (const { selector, decl } of items) {
            parts.push(`${selector} { ${decl.prop}: ${decl.value} !important; }`);
        }
        parts.push('');
    }

    parts.push(EXTRA_SECTION.trim());
    parts.push('');

    if (skipped.length) {
        parts.push('/* ---------- 暗色下无需覆盖的类（原值已适配深色底，仅作核对） ----------');
        parts.push(`   共 ${skipped.length} 个：${skipped.map((s) => s.token).join('、')}`);
        parts.push('*/');
        parts.push('');
    }

    return { css: parts.join('\n'), summary, generated: rules.length, skipped: skipped.length };
}

const { css, summary, generated, skipped } = generate();
const outFile = path.join(ROOT, 'dark-theme.css');
fs.writeFileSync(outFile, css, 'utf8');

console.log('已生成:', path.relative(ROOT, outFile));
console.log('  扫描到调色板类:', summary.distinctTokens, `（共 ${summary.totalOccurrences} 处用法）`);
console.log('  生成覆盖规则  :', generated);
console.log('  无需覆盖      :', skipped);
console.log('  用到的变体    :', summary.usedVariants.join(', ') || '(无)');

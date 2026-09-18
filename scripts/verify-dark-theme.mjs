/**
 * 校验暗色主题的完整性与正确性。
 *
 * 本项目在沙箱里跑不了浏览器截图，所以把「看起来刺眼」翻译成可断言的不变量：
 *
 *   1. 覆盖率     —— 源码里用到的每一个调色板类，要么有覆盖规则，要么在「有意不覆盖」白名单里。
 *                    这条直接对应原始 bug：手写清单漏了 360 个类里的绝大多数。
 *   2. 亮度不变量 —— 每一条生成的 background-color 合成到页面底色后必须「确实是深的」；
 *                    每一条生成的 color（文字）必须是「确实是亮的」。
 *                    这条直接对应症状「眼睛痛」：漏覆盖的 bg-red-50 / bg-amber-50 等
 *                    在深色页面里就是一块块接近纯白的高亮面。
 *   3. 可重现性   —— 覆盖表与源码保持同步（没有已删掉的旧类残留）。
 *   4. 结构与冲突 —— 括号配平、@import 位置合法、同选择器无属性冲突。
 *   5. 解析器校验 —— 用 postcss 真解析一遍，并验证类名转义可正确往返
 *                    （转义错了选择器就永远匹配不到元素，且浏览器静默丢弃）。
 *
 * 用法：node scripts/verify-dark-theme.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, scanPalette } from './scan-palette.mjs';

const PAGE_BG = '#0d1117';

let failures = 0;
let checks = 0;

function ok(name, detail = '') {
    checks += 1;
    console.log(`  \u2713 ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail) {
    checks += 1;
    failures += 1;
    console.log(`  \u2717 ${name}\n      ${detail}`);
}

/* ------------------------------------------------------------------ *
 * 颜色工具
 * ------------------------------------------------------------------ */
function parseColor(str) {
    const s = str.trim();
    let m = s.match(/^#([0-9a-f]{6})$/i);
    if (m) {
        const h = m[1];
        return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
    }
    m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
    if (m) {
        return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
    }
    return null;
}

/** 把半透明色合成到不透明背景上 */
function composite(fg, bg) {
    if (fg.a >= 1) return { r: fg.r, g: fg.g, b: fg.b, a: 1 };
    return {
        r: fg.r * fg.a + bg.r * (1 - fg.a),
        g: fg.g * fg.a + bg.g * (1 - fg.a),
        b: fg.b * fg.a + bg.b * (1 - fg.a),
        a: 1,
    };
}

/** WCAG 相对亮度（0=黑 1=白） */
function luminance({ r, g, b }) {
    const f = (v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/* ------------------------------------------------------------------ *
 * 解析样式表
 * ------------------------------------------------------------------ */
const themePath = path.join(ROOT, 'dark-theme.css');
const indexPath = path.join(ROOT, 'index.css');
const themeCss = fs.readFileSync(themePath, 'utf8');
const indexCss = fs.readFileSync(indexPath, 'utf8');

/** 去注释：注释会把文件头并进第一条规则的选择器，导致首条规则被漏算 */
function stripComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** 抽取所有「选择器 + 声明块」规则（生成物是扁平的，没有嵌套规则） */
function parseRules(css) {
    const rules = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    for (const m of css.matchAll(re)) {
        const selector = m[1].trim();
        if (!selector) continue;
        const decls = m[2]
            .split(';')
            .map((d) => d.trim())
            .filter(Boolean)
            .map((d) => {
                const i = d.indexOf(':');
                return { prop: d.slice(0, i).trim(), value: d.slice(i + 1).trim() };
            });
        if (decls.length) rules.push({ selector, decls });
    }
    return rules;
}

/** 从选择器里精确提取类名（反转义 \: 与 \/ 等） */
function classesInSelector(selector) {
    const out = new Set();
    for (const m of selector.matchAll(/\.((?:[^\\\s>+~,{:]|\\.)+)/g)) {
        out.add(m[1].replace(/\\(.)/g, '$1'));
    }
    return out;
}

const themeRules = parseRules(stripComments(themeCss));

/** 覆盖表里出现过的全部类名（dark 是根标记，不算工具类） */
const coveredClasses = new Set();
for (const r of themeRules) {
    for (const c of classesInSelector(r.selector)) {
        if (c !== 'dark') coveredClasses.add(c);
    }
}

const PALETTE_RE = /(?:bg|text|border|ring|divide|from|via|to|fill|stroke|placeholder|shadow|outline|decoration|accent|caret)-/;

console.log('暗色主题校验\n');

/* ------------------------------------------------------------------ *
 * 1. 覆盖率
 * ------------------------------------------------------------------ */
console.log('[1/5] 覆盖率：源码用到的调色板类是否都有暗色规则');
{
    const { summary, tokens } = scanPalette();

    // 白名单：确实不需要覆盖的类。判定依据 =
    //   bg      >=400            实心强调色（按钮 / 指示灯），暗色下原样正确
    //   bg      >=600 且带透明度  模态遮罩 / 深色浮层，叠在深色底上本来就对
    //   text    <=400            浅色调，本来就是「深底上的字」
    //   border/ring/divide >=400 实心强调色描边
    //   from/via/to              渐变停靠色，本身就是饱和色或半透明色
    //   shadow                   由 index.css 的全局规则统一压掉
    const reasonOf = (t) => {
        if (t.prop === 'shadow') return 'shadow 由 index.css 统一压掉';
        if (['from', 'via', 'to'].includes(t.prop)) return '渐变停靠色，暗色下保持';
        if (t.shade == null) return null;
        if (t.prop === 'bg') return t.shade >= 400 ? '实心强调色背景' : null;
        if (t.prop === 'text') return t.shade <= 400 ? '浅色文字（深底上的字）' : null;
        if (t.prop === 'border' || t.prop === 'ring' || t.prop === 'divide') {
            return t.shade >= 400 ? '实心强调色描边' : null;
        }
        return null;
    };

    const uncovered = [];
    for (const t of tokens) {
        if (coveredClasses.has(t.token)) continue;
        if (reasonOf(t)) continue;
        uncovered.push(t);
    }

    if (uncovered.length === 0) {
        ok('全部覆盖', `${summary.distinctTokens} 个类（${summary.totalOccurrences} 处用法）全部命中覆盖规则或白名单`);
    } else {
        fail(
            `有 ${uncovered.length} 个类既没有覆盖规则也不在白名单里`,
            uncovered.slice(0, 15).map((t) => `${t.token}  (${t.files[0]})`).join('\n      '),
        );
    }
}

/* ------------------------------------------------------------------ *
 * 2. 亮度不变量（直接对应「刺眼」症状）
 * ------------------------------------------------------------------ */
console.log('\n[2/5] 亮度不变量：暗色下不该出现亮底，也不该出现暗字');
{
    const pageBg = parseColor(PAGE_BG);

    const BG_MAX_LUM = 0.16;   // 背景合成后的相对亮度上限（#161b22 约 0.011，最亮的 #3e4651 约 0.055）
    const TEXT_MIN_LUM = 0.22; // 文字亮度下限（#8b949e 约 0.30）

    const brightBg = [];
    const darkText = [];

    for (const rule of themeRules) {
        for (const { prop, value } of rule.decls) {
            const clean = value.replace(/\s*!important\s*$/, '');
            const parsed = parseColor(clean);
            if (!parsed) continue;

            if (prop === 'background-color') {
                const lum = luminance(composite(parsed, pageBg));
                if (lum > BG_MAX_LUM) brightBg.push({ selector: rule.selector, value: clean, lum: lum.toFixed(3) });
            } else if (prop === 'color') {
                const lum = luminance(composite(parsed, pageBg));
                if (lum < TEXT_MIN_LUM) darkText.push({ selector: rule.selector, value: clean, lum: lum.toFixed(3) });
            }
        }
    }

    if (brightBg.length === 0) ok('没有亮色背景', `所有 background-color 合成后亮度 <= ${BG_MAX_LUM}`);
    else fail(
        `有 ${brightBg.length} 条背景在暗色下偏亮（会形成刺眼白块）`,
        brightBg.slice(0, 12).map((b) => `${b.selector} → ${b.value} (亮度 ${b.lum})`).join('\n      '),
    );

    if (darkText.length === 0) ok('没有暗色文字', `所有 color 亮度 >= ${TEXT_MIN_LUM}`);
    else fail(
        `有 ${darkText.length} 条文字在暗色下偏暗（会看不清）`,
        darkText.slice(0, 12).map((b) => `${b.selector} → ${b.value} (亮度 ${b.lum})`).join('\n      '),
    );
}

/* ------------------------------------------------------------------ *
 * 3. 可重现性
 * ------------------------------------------------------------------ */
console.log('\n[3/5] 可重现性：覆盖表是否与源码同步');
{
    const header = themeCss.split('\n').find((l) => l.includes('自动生成'));
    if (header) ok('生成物带「请勿手改」标识');
    else fail('生成物缺少标识', '应在文件头注明由脚本生成');

    // 生成物里不该残留源码中已不存在的类（说明改完源码没重新生成）
    const { tokens } = scanPalette();
    const tokenSet = new Set(tokens.map((t) => t.token));
    // 非调色板的手写覆盖（white/black 系列、图表 SVG）不参与「过期」判定
    const EXTRA_CLASSES = /^(bg-white|hover:bg-white|focus:bg-white|border-white|ring-white|recharts-)/;
    const stale = [];
    for (const cls of coveredClasses) {
        if (!PALETTE_RE.test(cls)) continue;
        if (EXTRA_CLASSES.test(cls)) continue;
        if (!tokenSet.has(cls)) stale.push(cls);
    }
    if (stale.length === 0) ok('没有残留的过期规则', '覆盖表与源码一致');
    else fail(`有 ${stale.length} 条过期规则（请重新运行生成器）`, [...new Set(stale)].slice(0, 15).join(', '));
}

/* ------------------------------------------------------------------ *
 * 4. 结构与冲突
 * ------------------------------------------------------------------ */
console.log('\n[4/5] 结构与冲突');
{
    const balance = (css, name) => {
        const open = (css.match(/\{/g) || []).length;
        const close = (css.match(/\}/g) || []).length;
        if (open === close) ok(`${name} 括号配平`, `共 ${open} 个规则块`);
        else fail(`${name} 括号不配平`, `{ × ${open}，} × ${close}`);
    };
    balance(themeCss, 'dark-theme.css');
    balance(indexCss, 'index.css');

    // 覆盖表必须真的被加载：index.html 里要有指向它的 <link>，
    // 且必须排在 index.css 之后（同为 !important 时后加载者胜出）。
    const htmlPath = path.join(ROOT, 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    const iIndex = html.indexOf('/index.css');
    const iDark = html.indexOf('/dark-theme.css');
    if (iDark === -1) {
        fail('index.html 没有引入 dark-theme.css', '覆盖表不会被加载，暗色模式等于没修');
    } else if (iIndex === -1 || iDark < iIndex) {
        fail('dark-theme.css 的引入顺序不对', '应排在 index.css 之后');
    } else {
        ok('index.html 引入了 dark-theme.css', '且顺序在 index.css 之后');
    }

    const conflicts = [];
    const bySelector = new Map();
    for (const rule of themeRules) {
        for (const d of rule.decls) {
            const key = `${rule.selector}|${d.prop}`;
            if (bySelector.has(key) && bySelector.get(key) !== d.value) {
                conflicts.push(`${key}: ${bySelector.get(key)} vs ${d.value}`);
            }
            bySelector.set(key, d.value);
        }
    }
    if (conflicts.length === 0) ok('没有同选择器属性冲突');
    else fail('选择器内属性冲突', conflicts.slice(0, 10).join('\n      '));

    // 关键回归点：这批类曾经在暗色下保持近白色，是「刺眼」的直接原因
    const regressions = [
        'bg-red-50', 'bg-orange-50', 'bg-amber-50', 'bg-yellow-50', 'bg-green-50',
        'bg-blue-50', 'bg-indigo-50', 'bg-purple-50', 'bg-emerald-50', 'bg-sky-50',
        'bg-gray-50', 'bg-blue-100', 'bg-red-100', 'bg-orange-100', 'bg-yellow-100',
        'bg-green-100', 'bg-indigo-100', 'bg-purple-100',
        'text-amber-900', 'text-amber-950', 'text-red-800', 'text-slate-950',
        'border-red-100', 'border-orange-100', 'border-blue-100', 'border-gray-100',
        'bg-white/95',
    ];
    const missing = regressions.filter((cls) => !coveredClasses.has(cls));
    if (missing.length === 0) ok('历史刺眼类全部已有规则', `抽查 ${regressions.length} 个`);
    else fail('历史刺眼类仍未被覆盖', missing.join(', '));
}

/* ------------------------------------------------------------------ *
 * 5. 解析器校验
 * ------------------------------------------------------------------ */
console.log('\n[5/5] 解析器校验（转义 / 语法）');
{
    let postcss = null;
    try {
        postcss = (await import('postcss')).default;
    } catch {
        // postcss 是 vite 的传递依赖，未声明在 package.json；缺失时跳过而不是判失败
        ok('跳过 postcss 校验', '环境里没有 postcss（vite 的传递依赖）');
    }

    if (postcss) {
        for (const [name, css] of [['dark-theme.css', themeCss], ['index.css', indexCss]]) {
            try {
                const root = postcss.parse(css, { from: name });
                let rules = 0;
                root.walkRules(() => { rules += 1; });
                ok(`${name} 可被 postcss 解析`, `${rules} 条规则`);
            } catch (e) {
                fail(`${name} 解析失败`, e.message);
            }
        }
    }

    // 转义往返：`.hover\:bg-white\/50:hover` 反解回来必须正好是真实类名，
    // 否则选择器匹配不到元素，而浏览器会静默丢弃这类规则。
    const badEscape = [];
    for (const cls of coveredClasses) {
        const roundTrip = cls.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`).replace(/\\(.)/g, '$1');
        if (roundTrip !== cls) badEscape.push(cls);
    }
    if (badEscape.length === 0) ok('类名转义可正确往返', `${coveredClasses.size} 个类名`);
    else fail('类名转义往返失败', badEscape.slice(0, 10).join(', '));

    const badSelector = themeRules.map((r) => r.selector).filter((s) => /\\$/.test(s) || /[{}]/.test(s));
    if (badSelector.length === 0) ok('没有畸形选择器');
    else fail('存在畸形选择器', badSelector.slice(0, 10).join(' | '));
}

console.log(`\n${failures === 0 ? '全部通过' : '存在失败项'}：${checks - failures}/${checks} 项通过`);
process.exit(failures === 0 ? 0 : 1);

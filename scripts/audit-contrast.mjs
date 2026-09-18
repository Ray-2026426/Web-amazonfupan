/**
 * 一次性审计：找出「实心亮色底 + 被提亮的深色文字」这种危险组合。
 *
 * 背景：生成器只覆盖 bg 的 50~300（浅 tint 底），>=400 的实心强调色保持原样；
 * 而 text 的 >=500 会被提亮。如果某个元素同时用了「亮色实心底」和「原本的深色字」，
 * 提亮后就会出现「浅字压浅底」——亮色底上的字反而变淡。
 *
 * 这里扫真实 className 片段，把这种组合列出来人工核对。
 * 用法：node scripts/audit-contrast.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './scan-palette.mjs';

const HUES = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'scripts', '.chrome-debug', '.chrome-debug2', '.chrome-debug3', '.tmp-esbuild']);

const TOKEN_RE = new RegExp(
    `(?<![\\w:.-])((?:[a-z-]+:)*(bg|text)-(${HUES})-(\\d{2,3})(?:\\/\\d{1,3})?)(?![\\w-])`,
    'g',
);

/** 「视觉上很亮」的色相：这些实心底上的深色文字被提亮会掉对比度 */
const BRIGHT_HUES = new Set(['yellow', 'amber', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'orange']);

const files = [];
function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
            if (SKIP_DIRS.has(e.name)) continue;
            walk(path.join(dir, e.name));
        } else if (/\.tsx?$/.test(e.name)) {
            files.push(path.join(dir, e.name));
        }
    }
}
walk(ROOT);

let pairs = 0;
let risky = 0;
const riskyList = [];

for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const txt = fs.readFileSync(file, 'utf8');

    // 按引号切出 className 片段（模板字符串 / 单引号 / 双引号）
    const fragRe = /[`"']([^`"'\n]{0,400})[`"']/g;
    for (const fm of txt.matchAll(fragRe)) {
        const frag = fm[1];
        if (!frag.includes('bg-')) continue;

        const bgs = [];
        const txs = [];
        for (const t of frag.matchAll(TOKEN_RE)) {
            const full = t[1];
            const prop = t[2];
            const hue = t[3];
            const shade = Number(t[4]);
            if (prop === 'bg' && shade >= 400 && shade <= 700) bgs.push({ full, hue, shade });
            if (prop === 'text' && shade >= 500) txs.push({ full, hue, shade });
        }

        const solid = bgs.filter((b) => !b.full.includes('/'));
        if (!solid.length || !txs.length) continue;
        pairs += 1;

        const bright = solid.filter((b) => BRIGHT_HUES.has(b.hue));
        if (bright.length) {
            risky += 1;
            riskyList.push({ rel, bg: bright.map((b) => b.full), text: txs.map((t) => t.full) });
        }
    }
}

console.log(`检查了 ${pairs} 组「实心底 + 深色字」，其中可疑 ${risky} 组\n`);
for (const r of riskyList) {
    console.log(`${r.rel}`);
    console.log(`   bg  : ${r.bg.join(', ')}`);
    console.log(`   text: ${r.text.join(', ')}\n`);
}

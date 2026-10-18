#!/usr/bin/env node
/**
 * 构建产物体积预算检查（对应 `npm run bundle:check`）。
 *
 * 背景：历史文档里 package.json 已声明该脚本，但文件缺失，导致 `npm run check` 中断。
 * 这里补一个最小可用实现：只做「文件级预算」，不依赖打包器的模块图，
 * 目标是防止首屏 JS / CSS 在后续迭代中悄悄膨胀。
 *
 * 预算（gzip 后）：
 *   · 入口 JS（dist/index.html 里 type=module 引用的那个）  <= 180 KB
 *   · 整站 CSS（dist/assets/*.css 合计）                    <= 60 KB
 *   · 单文件告警（非入口）                                  > 500 KB 仅提示，不失败
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const ASSETS = path.join(DIST, 'assets');

const ENTRY_BUDGET_KB = 180;
const CSS_BUDGET_KB = 60;

if (!fs.existsSync(DIST)) {
    console.error('✗ 找不到 dist/，请先执行 npm run build');
    process.exit(1);
}

const gzipSize = (file) => zlib.gzipSync(fs.readFileSync(file)).length;

const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const entryMatch = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/i);
if (!entryMatch) {
    console.error('✗ dist/index.html 里没有找到 type="module" 入口脚本');
    process.exit(1);
}
const entryName = path.basename(entryMatch[1]);

const files = fs.existsSync(ASSETS)
    ? fs.readdirSync(ASSETS).filter((f) => /\.(js|css)$/i.test(f))
    : [];

let cssTotal = 0;
const rows = [];
for (const name of files) {
    const full = path.join(ASSETS, name);
    const raw = fs.statSync(full).size;
    const gz = gzipSize(full);
    if (name.endsWith('.css')) cssTotal += gz;
    rows.push({ name, raw, gz });
}

rows.sort((a, b) => b.gz - a.gz);

const fmt = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const entry = rows.find((r) => r.name === entryName);

console.log('构建体积（gzip）');
console.log('─'.repeat(72));
for (const r of rows.slice(0, 12)) {
    console.log(`${r.name.padEnd(42)} ${fmt(r.gz).padStart(10)}`);
}
if (rows.length > 12) console.log(`… 其余 ${rows.length - 12} 个文件略`);
console.log('─'.repeat(72));
console.log(`入口 JS   ${entry ? fmt(entry.gz) : '(未找到)'}  / 预算 ${ENTRY_BUDGET_KB} KB`);
console.log(`CSS 合计  ${fmt(cssTotal)}  / 预算 ${CSS_BUDGET_KB} KB`);

const errors = [];
if (entry && entry.gz / 1024 > ENTRY_BUDGET_KB) {
    errors.push(`入口 JS ${fmt(entry.gz)} 超过预算 ${ENTRY_BUDGET_KB} KB`);
}
if (cssTotal / 1024 > CSS_BUDGET_KB) {
    errors.push(`CSS 合计 ${fmt(cssTotal)} 超过预算 ${CSS_BUDGET_KB} KB`);
}

for (const r of rows) {
    if (r.name !== entryName && r.gz / 1024 > 500) {
        console.log(`· 提示：${r.name} 达 ${fmt(r.gz)}（> 500 KB），建议按需加载`);
    }
}

if (errors.length) {
    console.error('\n✗ 体积预算未通过：');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
}
console.log('\n✓ 体积预算通过');

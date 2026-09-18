/**
 * 正确性校验：把「逐店铺拉取后的行汇总」与「领星返回的 total_sum」逐个店铺对账。
 * 如果一致，说明分页与店铺循环没有漏数据；不一致说明拉取有 bug。
 * 用法：node scripts/_verify-report.mjs --date 2026-09-17
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './scan-palette.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const DATE = arg('date', '2026-09-17');
const DIR = path.join(ROOT, '.lingxing-probe', 'cache', DATE);

const num = (v) => {
    if (v === null || v === undefined || v === '') return 0;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
};

const files = fs.readdirSync(DIR).filter((f) => f.startsWith('pp-') && f.endsWith('.json'));
console.log(`对账 ${files.length} 个店铺（数据目录 ${path.relative(ROOT, DIR)}）\n`);

let grandRowAmount = 0;
let grandSumAmount = 0;
let grandRowVolume = 0;
let grandSumVolume = 0;
let totalRows = 0;
let activeRows = 0;
const mismatches = [];

for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    const rows = d.list || [];
    const ts = d.total_sum || {};
    const rowAmount = rows.reduce((s, r) => s + num(r.amount), 0);
    const rowVolume = rows.reduce((s, r) => s + num(r.volume), 0);
    const sumAmount = num(ts.amount);
    const sumVolume = num(ts.volume);

    grandRowAmount += rowAmount;
    grandSumAmount += sumAmount;
    grandRowVolume += rowVolume;
    grandSumVolume += sumVolume;
    totalRows += rows.length;
    activeRows += rows.filter((r) => num(r.volume) > 0 || num(r.amount) > 0 || num(r.impressions) > 0 || num(r.spend) > 0).length;

    // 允许 0.01 的浮点误差
    if (Math.abs(rowAmount - sumAmount) > 0.02 || rowVolume !== sumVolume) {
        mismatches.push({ shop: f.replace('pp-', '').replace('.json', ''), rows: rows.length, total: d.total, rowAmount, sumAmount, rowVolume, sumVolume });
    }
}

console.log('=== 逐店铺对账（行汇总 vs 领星 total_sum）===');
console.log(`  店铺数            : ${files.length}`);
console.log(`  对账不一致的店铺  : ${mismatches.length}`);
if (mismatches.length) {
    console.log('  不一致明细（前 10 个）:');
    for (const m of mismatches.slice(0, 10)) {
        console.log(`    店铺 ${m.shop}: 行数=${m.rows} total=${m.total}`);
        console.log(`      销售额 行汇总=${m.rowAmount.toFixed(2)}  领星汇总=${m.sumAmount.toFixed(2)}`);
        console.log(`      销量   行汇总=${m.rowVolume}  领星汇总=${m.sumVolume}`);
    }
} else {
    console.log('  ✓ 所有店铺的行汇总与领星 total_sum 完全一致 → 分页与店铺循环没有漏数据');
}

console.log('\n=== 全局合计 ===');
console.log(`  总行数            : ${totalRows}`);
console.log(`  有活动的行        : ${activeRows}  (${(activeRows / totalRows * 100).toFixed(1)}%)`);
console.log(`  零活动行(可过滤)  : ${totalRows - activeRows}`);
console.log(`  销售额(行汇总)    : ${grandRowAmount.toFixed(2)}`);
console.log(`  销售额(领星汇总)  : ${grandSumAmount.toFixed(2)}`);
console.log(`  销量(行汇总)      : ${grandRowVolume}`);
console.log(`  销量(领星汇总)    : ${grandSumVolume}`);

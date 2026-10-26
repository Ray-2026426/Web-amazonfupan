#!/usr/bin/env node
/**
 * 云端体检：把最近数据覆盖、同步记录、补数队列、异常标记一次打印出来。
 * 只读，不改任何数据。
 */
const BASE = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || '';
if (!BASE || !KEY) {
    console.error('缺少 SUPABASE_URL / SUPABASE_SECRET_KEY');
    process.exit(1);
}

const headers = {
    apikey: KEY,
    ...(KEY.startsWith('eyJ') ? { Authorization: `Bearer ${KEY}` } : {}),
};

async function get(path) {
    const response = await fetch(`${BASE}/rest/v1/${path}`, { headers });
    if (!response.ok) return { error: `HTTP ${response.status}: ${(await response.text()).slice(0, 160)}` };
    return response.json();
}

const coverage = await get('v_fact_daily_coverage?select=date,rows,sales_amount,gross_profit&order=date.desc&limit=10');
console.log('=== 最近 10 天覆盖（v_fact_daily_coverage）===');
if (Array.isArray(coverage)) {
    for (const row of coverage) console.log(`${row.date}  行数 ${row.rows}  销售额 ${Number(row.sales_amount).toFixed(2)}  毛利 ${Number(row.gross_profit).toFixed(2)}`);
} else console.log(coverage.error);

const checks = await get('daily_checks?select=date,diff_ratio,checked_at&order=date.desc&limit=10');
console.log('\n=== 最近 10 天对账（daily_checks）===');
if (Array.isArray(checks)) {
    if (!checks.length) console.log('（空：说明对账还没写入，或表不存在）');
    for (const row of checks) console.log(`${row.date}  差异 ${row.diff_ratio === null ? '—' : `${(Number(row.diff_ratio) * 100).toFixed(1)}%`}  检查于 ${row.checked_at}`);
} else console.log(checks.error);

const runs = await get('sync_runs?select=started_at,finished_at,status,range_from,range_to,rows_daily,error&order=started_at.desc&limit=6');
console.log('\n=== 最近 6 次同步记录 ===');
if (Array.isArray(runs)) {
    for (const row of runs) console.log(`${row.started_at}  ${row.status}  ${row.range_from}~${row.range_to}  行 ${row.rows_daily}${row.error ? `  错误 ${String(row.error).slice(0, 80)}` : ''}`);
} else console.log(runs.error);

const requests = await get('sync_requests?select=id,dates,status,created_at,note&order=created_at.desc&limit=6');
console.log('\n=== 补数队列最近 6 条 ===');
if (Array.isArray(requests)) {
    if (!requests.length) console.log('（空）');
    for (const row of requests) console.log(`#${row.id}  ${row.status}  ${Array.isArray(row.dates) ? row.dates.slice(0, 4).join(',') : row.dates}  ${row.created_at}${row.note ? `  ${row.note}` : ''}`);
} else console.log(requests.error);

const images = await get('rpc/image_stats');
console.log('\n=== 图片表 ===');
console.log(images && !images.error ? JSON.stringify(images) : (images?.error || '无'));

const inv = await get('fact_inventory?select=date&order=date.desc&limit=1');
console.log('\n=== 库存快照最新日期 ===');
console.log(Array.isArray(inv) ? (inv[0]?.date || '（空）') : inv.error);

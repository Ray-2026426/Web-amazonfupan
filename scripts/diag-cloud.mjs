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
console.log('\n=== 图片表（RPC）===');
console.log(images && !images.error ? JSON.stringify(images) : (images?.error || '无'));

/** 用 PostgREST 的 count 头统计，不依赖任何 SQL 函数 */
async function countOf(table, query = 'select=id') {
    const response = await fetch(`${BASE}/rest/v1/${table}?${query}`, {
        method: 'HEAD',
        headers: { ...headers, Prefer: 'count=exact' },
    });
    if (!response.ok) return `HTTP ${response.status}`;
    const range = response.headers.get('content-range') || '';
    return Number(range.split('/')[1]) || 0;
}
console.log('\n=== 图片表（count 统计）===');
console.log('product_images 总数:', await countOf('product_images'));
console.log('product_images 已匹配 ASIN:', await countOf('product_images', 'select=id&asin=not.is.null'));
console.log('product_links（SKU↔ASIN 对照）:', await countOf('product_links'));

// 23 号亏损归因：按 ASIN 找出最烧钱的成本项
const lossDate = process.argv[2] || '2026-10-23';
const lossRows = await get(`fact_daily?select=asin,product_name,sales_amount,gross_profit,refund_cost,first_mile_cost,storage_fee,fba_fee,procurement_cost,platform_commission,ad_spend&date=eq.${lossDate}&limit=3000`);
console.log(`\n=== ${lossDate} 亏损归因（Top 8 按成本合计）===`);
if (Array.isArray(lossRows)) {
    const scored = lossRows.map(row => {
        const cost = ['refund_cost', 'first_mile_cost', 'storage_fee', 'fba_fee', 'procurement_cost', 'platform_commission', 'ad_spend']
            .reduce((sum, key) => sum + Math.abs(Number(row[key] || 0)), 0);
        return { ...row, cost };
    }).sort((a, b) => b.cost - a.cost).slice(0, 8);
    for (const row of scored) {
        console.log(`${row.asin} | 销售额 ${Number(row.sales_amount).toFixed(0)} | 毛利 ${Number(row.gross_profit).toFixed(0)} | 退款 ${Number(row.refund_cost).toFixed(0)} | 头程 ${Number(row.first_mile_cost).toFixed(0)} | 仓储 ${Number(row.storage_fee).toFixed(0)} | FBA ${Number(row.fba_fee).toFixed(0)} | 采购 ${Number(row.procurement_cost).toFixed(0)} | 广告 ${Number(row.ad_spend).toFixed(0)}`);
    }
} else console.log(lossRows.error);

const inv = await get('fact_inventory?select=date&order=date.desc&limit=1');
console.log('\n=== 库存快照最新日期 ===');
console.log(Array.isArray(inv) ? (inv[0]?.date || '（空）') : inv.error);

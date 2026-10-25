#!/usr/bin/env node
/**
 * 定时同步「漏跑自愈」看门狗。
 *
 * 为什么需要：GitHub 的 cron 会延迟甚至整次跳过（实测漏过 08:10 那次），
 * 数据就悄悄停在昨天以前，没有任何提示。这个脚本每天跑一次：
 *   · 查云端最新数据日期
 *   · 落后于「昨天」就把缺失的日期写进 sync_requests 队列
 *   · 队列由 sync-queue.yml 消费，页面也能看到进度
 *
 * 运行环境：SUPABASE_URL / SUPABASE_SECRET_KEY
 */
const BASE = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || '';
if (!BASE || !KEY) {
    console.error('缺少 SUPABASE_URL / SUPABASE_SECRET_KEY');
    process.exit(1);
}

const headers = {
    apikey: KEY,
    'Content-Type': 'application/json',
    ...(KEY.startsWith('eyJ') ? { Authorization: `Bearer ${KEY}` } : {}),
};

const iso = (date) => date.toISOString().slice(0, 10);
const DAY = 86400000;

async function getLatestDate() {
    const response = await fetch(`${BASE}/rest/v1/v_fact_daily_coverage?select=date&order=date.desc&limit=1`, { headers });
    if (!response.ok) throw new Error(`读取覆盖失败：HTTP ${response.status}`);
    const rows = await response.json();
    return Array.isArray(rows) && rows[0] ? rows[0].date : null;
}

async function enqueue(dates) {
    const response = await fetch(`${BASE}/rest/v1/sync_requests`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ dates, status: 'pending' }),
    });
    if (!response.ok) throw new Error(`写入队列失败：HTTP ${response.status}`);
}

const yesterday = new Date(Date.now() - DAY);
const target = iso(yesterday);

const latest = await getLatestDate();
if (!latest) {
    console.log('云端还没有任何数据，跳过（先跑一次全量回补）');
    process.exit(0);
}
if (latest >= target) {
    console.log(`最新数据 ${latest} 已覆盖到昨天 ${target}，无需补数`);
    process.exit(0);
}

// 补齐 latest 之后到昨天之间的日期，最多 7 天（更早的缺口交给「数据质量」页手动补）
const dates = [];
for (let time = Date.parse(`${latest}T00:00:00Z`) + DAY; time <= Date.parse(`${target}T00:00:00Z`); time += DAY) {
    dates.push(iso(new Date(time)));
}
const batch = dates.slice(-7);
console.log(`最新数据 ${latest}，落后 ${dates.length} 天；入队 ${batch.length} 天：${batch.join(', ')}`);
await enqueue(batch);
console.log('已写入 sync_requests，等待队列任务消费');

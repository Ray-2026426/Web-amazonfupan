#!/usr/bin/env node
/**
 * 补数队列消费者：把 sync_requests 里 pending 的日期逐个跑掉。
 *
 * 为什么要队列：Vercel 上没有领星密钥，也不该把 GitHub 令牌硬塞进前端；
 * 页面只负责把「要补哪几天」写进数据库，真正的同步由这个定时任务执行。
 *
 * 运行环境需要：SUPABASE_URL / SUPABASE_SECRET_KEY / LINGXING_MCP_KEY
 * 用法：node scripts/sync/consume-queue.mjs   （工作流里每 10 分钟跑一次）
 */
import { spawnSync } from 'node:child_process';

const BASE = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || '';
if (!BASE || !KEY) {
    console.error('缺少 SUPABASE_URL / SUPABASE_SECRET_KEY，无法消费队列');
    process.exit(1);
}

const headers = {
    apikey: KEY,
    'Content-Type': 'application/json',
    ...(KEY.startsWith('eyJ') ? { Authorization: `Bearer ${KEY}` } : {}),
};

async function request(path, init = {}) {
    const response = await fetch(`${BASE}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    if (!response.ok) throw new Error(`${path} → HTTP ${response.status}`);
    return response.json().catch(() => null);
}

const pending = await request('sync_requests?select=id,dates,status&status=eq.pending&order=created_at.asc&limit=5');
if (!Array.isArray(pending) || pending.length === 0) {
    console.log('队列为空');
    process.exit(0);
}

let failures = 0;
for (const row of pending) {
    const dates = Array.isArray(row.dates) ? row.dates : JSON.parse(row.dates || '[]');
    if (!dates.length) {
        await request(`sync_requests?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'failed', note: '日期为空', processed_at: new Date().toISOString() }) });
        continue;
    }
    console.log(`处理请求 #${row.id}：${dates.length} 天（${dates[0]} ~ ${dates[dates.length - 1]}）`);
    await request(`sync_requests?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'running' }) });

    // 补数按天比较慢，一次最多 30 天，避免单个请求跑爆工作流时限
    const batch = dates.slice(0, 30);
    const result = spawnSync(process.execPath, ['scripts/sync/run.mjs', '--dates', batch.join(','), '--upload'], { stdio: 'inherit' });
    const ok = result.status === 0;
    if (!ok) failures += 1;

    await request(`sync_requests?id=eq.${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
            status: ok ? 'done' : 'failed',
            processed_at: new Date().toISOString(),
            note: ok ? null : `exit ${result.status}`,
        }),
    });
    console.log(`请求 #${row.id} ${ok ? '完成' : '失败'}`);
}

process.exit(failures ? 1 : 0);

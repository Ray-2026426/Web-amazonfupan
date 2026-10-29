#!/usr/bin/env node
/**
 * 判断「云端是否已覆盖到昨天」。
 * 输出 stale（需要同步）或 fresh（已是最新）。
 *
 * 用途：定时任务每天安排多次，只要第一次成功，后面的直接跳过，避免多余请求。
 */
const BASE = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || '';
if (!BASE || !KEY) {
    console.log('stale');
    process.exit(0);
}

const headers = {
    apikey: KEY,
    ...(KEY.startsWith('eyJ') ? { Authorization: `Bearer ${KEY}` } : {}),
};

const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
try {
    const response = await fetch(`${BASE}/rest/v1/v_fact_daily_coverage?select=date&order=date.desc&limit=1`, { headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows = await response.json();
    const latest = Array.isArray(rows) && rows[0] ? rows[0].date : null;
    if (latest && latest >= yesterday) {
        console.log('fresh');
        console.log(`最新数据 ${latest} 已覆盖到昨天 ${yesterday}`);
    } else {
        console.log('stale');
        console.log(`最新数据 ${latest || '无'}，目标 ${yesterday}`);
    }
} catch (error) {
    console.log('stale');
    console.log(`检查失败（按需要同步处理）：${String(error.message || error).slice(0, 120)}`);
}

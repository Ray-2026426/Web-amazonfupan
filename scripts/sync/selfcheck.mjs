#!/usr/bin/env node
/**
 * 配置自检：跑同步之前先确认「密钥能用、表存在」。
 *
 * 为什么单独做：正式同步要跑好几分钟、几十次接口调用，
 * 如果密钥/URL 填错，往往跑完 20 分钟才报错，很难判断是哪一步的问题。
 * 这里只做 2~3 次最轻的请求，错了立刻告诉你怎么改。
 *
 * 用法：
 *   node scripts/sync/selfcheck.mjs
 * 环境变量：
 *   LINGXING_MCP_KEY                 领星 MCP 密钥（必需）
 *   SUPABASE_URL                     形如 https://xxxx.supabase.co（必需）
 *   SUPABASE_SECRET_KEY              服务端 secret key（写库用；自检读表也行）
 *   SUPABASE_PUBLISHABLE_KEY         可选，浏览器用的只读 key（自检会顺带验证它能否读）
 */
import { createClient } from '../lingxing-client.mjs';

const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => console.log(`  ❌ ${m}`);
const info = (m) => console.log(`  ·  ${m}`);

let failures = 0;
const fail = (m) => {
    failures += 1;
    bad(m);
};

const LINGXING_KEY = process.env.LINGXING_MCP_KEY;
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
const ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

console.log('\n=== 1. 领星 MCP 密钥 ===');
if (!LINGXING_KEY) {
    fail('没有 LINGXING_MCP_KEY（GitHub Secret 里要叫这个名字；本地跑就 set LINGXING_MCP_KEY=...）');
} else {
    info(`密钥长度 ${LINGXING_KEY.length}，前缀 ${LINGXING_KEY.slice(0, 4)}***`);
    try {
        const client = createClient({ key: LINGXING_KEY, intervalMs: 500 });
        const shops = await client.call('get_my_sids', null);
        const list = (shops && shops.list) || [];
        const real = list.filter((s) => !s.is_concept);
        ok(`能取到店铺列表：${list.length} 个（其中实体店铺 ${real.length} 个）`);
        if (real.length === 0) fail('店铺数为 0：这个密钥可能没有店铺权限');
        else if (real.length < 5) info(`店铺只有 ${real.length} 个，确认是不是只授权了部分店铺`);
    } catch (e) {
        const msg = String(e.message || e);
        fail(`调用失败：${msg.slice(0, 200)}`);
        if (/code=102|无效|invalid/i.test(msg)) info('密钥无效或已过期 → 去领星后台重新生成');
        if (/code=429|风控/i.test(msg)) info('触发限流 → 等几分钟再试');
        if (/ENOTFOUND|fetch failed|ECONN/i.test(msg)) info('网络不通 → 换网络重试（国内服务器/GitHub 机器表现可能不同）');
    }
}

console.log('\n=== 2. Supabase 连接与建表 ===');
if (!SUPABASE_URL) {
    fail('没有 SUPABASE_URL');
} else if (!SUPABASE_URL.startsWith('https://')) {
    fail(`SUPABASE_URL 格式不对（应该是 https://xxxx.supabase.co）：${SUPABASE_URL}`);
} else {
    ok(`URL：${SUPABASE_URL}`);
}

async function probeTable(table, key, label) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (res.status === 200) {
        const rows = await res.json();
        ok(`${label}（${table}）可读，现有 ${Array.isArray(rows) ? rows.length : '?'} 行（limit 1 探测）`);
        return true;
    }
    const text = (await res.text()).slice(0, 200);
    if (res.status === 404) {
        fail(`${table} 不存在 → 去 Supabase 的 SQL Editor 执行 db/schema.sql`);
    } else if (res.status === 401 || res.status === 403) {
        fail(`${table} 无权限（HTTP ${res.status}）→ key 可能用了 anon 之外/错的，或 RLS 没建`);
    } else {
        fail(`${table} 读取失败 HTTP ${res.status}: ${text}`);
    }
    return false;
}

if (SUPABASE_URL && SERVICE_KEY) {
    info('用 SUPABASE_SECRET_KEY 探测表与视图…');
    if (await probeTable('sync_runs', SERVICE_KEY, '同步记录表')) {
        // 表存在 → 再确认 fact_daily 与视图
        await probeTable('fact_daily', SERVICE_KEY, '日明细表');
        await probeTable('v_fact_month', SERVICE_KEY, '月汇总视图');
        await probeTable('v_fact_week', SERVICE_KEY, '周汇总视图');
    }
} else if (SUPABASE_URL) {
    fail('没有 SUPABASE_SECRET_KEY（GitHub Actions 写库必须用服务端 secret key）');
}

if (SUPABASE_URL && ANON_KEY) {
    console.log('\n=== 3. 浏览器用的 anon key（前端读数据会用）===');
    const res = await fetch(`${SUPABASE_URL}/rest/v1/v_fact_month?select=*&limit=1`, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    });
    if (res.status === 200) ok('anon key 能读月汇总视图（说明只读策略生效）');
    else fail(`anon key 读视图失败 HTTP ${res.status}：${(await res.text()).slice(0, 160)}`);
} else {
    info('\n（未提供 SUPABASE_ANON_KEY，跳过前端只读 key 检查；接前端时再加）');
}

console.log(`\n=== 结果：${failures === 0 ? '全部通过，可以跑同步了' : `${failures} 项未通过，先按上面的提示修`} ===\n`);
process.exit(failures === 0 ? 0 : 1);

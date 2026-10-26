#!/usr/bin/env node
/**
 * 每日经营摘要推送到飞书群。
 *
 * 只做一件事：把「昨天赚了多少、有没有异常」推到群里，让问题找人而不是人找问题。
 * 需要环境变量：
 *   SUPABASE_URL / SUPABASE_SECRET_KEY  —— 读数据
 *   FEISHU_WEBHOOK                       —— 飞书自定义机器人 Webhook（没配就跳过）
 */
const BASE = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || '';
const WEBHOOK = process.env.FEISHU_WEBHOOK || '';

if (!WEBHOOK) {
    console.log('未配置 FEISHU_WEBHOOK，跳过推送');
    process.exit(0);
}
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
    if (!response.ok) return null;
    return response.json();
}

const money = (value) => {
    const n = Number(value) || 0;
    return Math.abs(n) >= 10000 ? `${(n / 10000).toFixed(1)} 万` : n.toFixed(0);
};
const pct = (value) => `${((Number(value) || 0) * 100).toFixed(1)}%`;

const [days, checks] = await Promise.all([
    get('v_fact_daily_coverage?select=date,rows,sales_amount,gross_profit&order=date.desc&limit=3'),
    get('daily_checks?select=date,diff_ratio&order=date.desc&limit=3'),
]);

if (!Array.isArray(days) || days.length === 0) {
    console.log('云端没有数据，跳过');
    process.exit(0);
}

const latest = days[0];
const previous = days[1];
const diffMap = new Map((Array.isArray(checks) ? checks : []).map(row => [row.date, row.diff_ratio]));
const mom = previous && Number(previous.gross_profit) !== 0
    ? (Number(latest.gross_profit) - Number(previous.gross_profit)) / Math.abs(Number(previous.gross_profit))
    : null;
const margin = Number(latest.sales_amount) > 0 ? Number(latest.gross_profit) / Number(latest.sales_amount) : 0;
const diff = diffMap.get(latest.date);

const alerts = [];
if (Number(latest.gross_profit) < 0) alerts.push('毛利为负（亏损日）');
if (diff !== null && diff !== undefined && Math.abs(Number(diff)) > 0.02) alerts.push(`与领星差异 ${pct(diff)}`);
if (Number(latest.rows) < 200) alerts.push(`只入库 ${latest.rows} 行，疑似同步不全`);

const lines = [
    `**毛利额** ${money(latest.gross_profit)}（毛利率 ${pct(margin)}${mom === null ? '' : `，环比 ${mom >= 0 ? '+' : ''}${pct(mom)}`}）`,
    `**销售额** ${money(latest.sales_amount)} · **行数** ${latest.rows}`,
    `**对账差异** ${diff === null || diff === undefined ? '—' : pct(diff)}`,
];
if (alerts.length) lines.push(`⚠️ ${alerts.join(' · ')}`);
lines.push(alerts.length ? '建议打开看板「经营异常雷达」定位根因' : '指标在阈值内，维持日常监控');

const card = {
    msg_type: 'interactive',
    card: {
        config: { wide_screen_mode: true },
        header: {
            template: alerts.length ? 'red' : 'green',
            title: { tag: 'plain_text', content: `经营日报 · ${latest.date}` },
        },
        elements: [
            { tag: 'div', text: { tag: 'lark_md', content: lines.join('\n') } },
            { tag: 'hr' },
            { tag: 'note', elements: [{ tag: 'plain_text', content: '数据来源：领星 → 云端；每日同步后自动推送' }] },
        ],
    },
};

const response = await fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(card),
});
const body = await response.text();
if (!response.ok || /"code":\s*[1-9]/.test(body)) {
    console.error(`飞书推送失败 HTTP ${response.status}: ${body.slice(0, 200)}`);
    process.exit(1);
}
console.log(`已推送 ${latest.date} 的经营日报`);

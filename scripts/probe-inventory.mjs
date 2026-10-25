#!/usr/bin/env node
/**
 * 探测：领星 MCP 里跟「库存」相关的工具，以及返回字段。
 * 只在 Actions 里跑（需要 LINGXING_MCP_KEY）。
 */
import { createClient, fetchCatalog } from './lingxing-client.mjs';

const client = createClient({ intervalMs: 1500, verbose: true });
const catalog = await fetchCatalog(client, null);
console.log(`工具总数：${catalog.length}`);

const KEYWORD = /库存|inventory|warehouse|fba|仓储|在途|可售/i;
const hits = catalog.filter((tool) => KEYWORD.test(`${tool.toolId || ''} ${tool.displayName || ''} ${tool.description || ''}`));
console.log(`匹配到 ${hits.length} 个：`);
for (const tool of hits) {
    console.log(`- ${tool.toolId} | ${tool.displayName} | ${String(tool.description || '').replace(/\s+/g, ' ').slice(0, 90)}`);
}

const shops = (await client.call('get_my_sids', null)).list || [];
const shop = shops.find((item) => !item.is_concept) || shops[0];
const sid = String(shop?.id || '');
console.log(`店铺样例：id=${sid}`);

// 试几个最像库存查询的工具
const candidates = hits
    .filter((tool) => /inventory|库存/i.test(`${tool.toolId} ${tool.displayName}`))
    .slice(0, 4);

for (const tool of candidates) {
    console.log(`\n=== ${tool.toolId} 入参 ===`);
    try {
        const schema = await client.gateway('search', { toolId: tool.toolId });
        console.log(JSON.stringify(schema?.inputSchema || schema).slice(0, 900));
    } catch (error) {
        console.log(`schema 失败：${String(error.message || error).slice(0, 150)}`);
    }
    const attempts = [
        [{ sid, offset: 0, length: 5 }, 'sid'],
        [{ sids: sid, offset: 0, length: 5 }, 'sids'],
        [{ offset: 0, length: 5 }, '无店铺参数'],
    ];
    for (const [params, label] of attempts) {
        try {
            const data = await client.call(tool.toolId, params);
            const list = data?.list || data?.data || [];
            const first = Array.isArray(list) ? list[0] : list;
            console.log(`[${label}] 成功 ${Array.isArray(list) ? list.length : '?'} 行，字段：`);
            console.log(Object.keys(first || {}).join(', '));
            console.log(`样例：${JSON.stringify(first).slice(0, 500)}`);
            break;
        } catch (error) {
            console.log(`[${label}] 失败：${String(error.message || error).slice(0, 120)}`);
        }
    }
}

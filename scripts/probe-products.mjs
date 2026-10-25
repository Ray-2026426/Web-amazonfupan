#!/usr/bin/env node
/**
 * 一次性探测：领星 MCP 里跟「产品管理 / 商品图片」相关的工具，以及它们的入参 schema。
 * 只在 Actions 里跑（需要 LINGXING_MCP_KEY），输出打印到日志供人看。
 */
import { createClient, fetchCatalog } from './lingxing-client.mjs';

const client = createClient({ intervalMs: 1500, verbose: true });

const catalog = await fetchCatalog(client, null);
console.log(`工具总数：${catalog.length}`);
console.log(`目录条目字段：${Object.keys(catalog[0] || {}).join(', ')}`);

const KEYWORD = /产品|商品|图片|image|product|local_inventory|listing/i;
const hits = catalog.filter((tool) => KEYWORD.test(`${tool.toolId || ''} ${tool.displayName || ''} ${tool.description || ''}`));
console.log(`匹配到 ${hits.length} 个相关工具：`);
for (const tool of hits) {
    const desc = String(tool.description || '').replace(/\s+/g, ' ').slice(0, 110);
    console.log(`- ${tool.toolId} | ${tool.displayName} | ${desc}`);
}

// 打印前 8 个的入参 schema
for (const tool of hits.slice(0, 8)) {
    try {
        const schema = await client.gateway('search', { toolId: tool.toolId });
        console.log(`\n=== ${tool.toolId} 入参 ===`);
        console.log(JSON.stringify(schema).slice(0, 1200));
    } catch (error) {
        console.log(`\n=== ${tool.toolId} 入参读取失败：${String(error.message || error).slice(0, 160)}`);
    }
}

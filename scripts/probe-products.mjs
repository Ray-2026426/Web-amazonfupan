#!/usr/bin/env node
/**
 * 一次性探测：领星 MCP 里跟「产品管理」相关的工具，以及产品图片 URL 的字段名。
 * 只在 Actions 里跑（需要 LINGXING_MCP_KEY），输出打印到日志供人看。
 */
import { createClient, fetchCatalog } from './lingxing-client.mjs';

const client = createClient({ intervalMs: 1500, verbose: true });

const catalog = await fetchCatalog(client, null);
console.log(`工具总数：${catalog.length}`);
if (catalog[0]) console.log(`目录条目字段：${Object.keys(catalog[0]).join(', ')}`);

const KEYWORD = /产品|商品|product|item|image|图片|图片链接|素材/i;
const hits = catalog.filter((tool) => KEYWORD.test(`${tool.id || ''} ${tool.name || ''} ${tool.title || ''} ${tool.description || ''}`));
console.log(`匹配到 ${hits.length} 个可能相关的工具：`);
for (const tool of hits) {
    const desc = String(tool.description || tool.desc || '').replace(/\s+/g, ' ').slice(0, 160);
    console.log(`- ${tool.id} | ${tool.name || tool.title || ''} | ${desc}`);
}

// 打印这几个工具的入参 schema，看看能不能按 ASIN / MSKU 查
for (const tool of hits.slice(0, 6)) {
    try {
        const schema = await client.gateway('search', { toolId: tool.id });
        console.log(`\n=== ${tool.id} 入参 ===`);
        console.log(JSON.stringify(schema).slice(0, 1500));
    } catch (error) {
        console.log(`\n=== ${tool.id} 入参读取失败：${String(error.message || error).slice(0, 200)}`);
    }
}

#!/usr/bin/env node
/**
 * 探测二：Listing / 产品报表类接口的返回字段，重点找图片 URL。
 */
import { createClient } from './lingxing-client.mjs';

const client = createClient({ intervalMs: 1500, verbose: true });

const shops = (await client.call('get_my_sids', null)).list || [];
const shop = shops.find((item) => !item.is_concept) || shops[0];
console.log(`店铺样例：id=${shop?.id} name=${shop?.name || shop?.seller_name || ''}`);
const sid = String(shop?.id || '');

const probes = [
    ['erp_listing', { sids: sid, offset: 0, length: 5 }],
    ['analytics_show_product_list', { seller_id: sid, start_date: '2026-10-01', end_date: '2026-10-20', offset: 0, length: 5 }],
];

for (const [toolId, params] of probes) {
    try {
        const schema = await client.gateway('search', { toolId });
        console.log(`\n=== ${toolId} 入参 ===`);
        console.log(JSON.stringify(schema?.inputSchema || schema).slice(0, 900));
    } catch (error) {
        console.log(`\n=== ${toolId} schema 失败：${String(error.message || error).slice(0, 160)}`);
    }
    try {
        const data = await client.call(toolId, params);
        const list = data?.list || data?.data || [];
        const first = Array.isArray(list) ? list[0] : list;
        console.log(`=== ${toolId} 返回 ${Array.isArray(list) ? list.length : '?'} 行，字段：`);
        console.log(Object.keys(first || {}).join(', '));
        const urls = [];
        const walk = (obj, prefix) => {
            for (const [key, value] of Object.entries(obj || {})) {
                const path = prefix ? `${prefix}.${key}` : key;
                if (typeof value === 'string' && /^https?:\/\//.test(value)) urls.push(`${path} = ${value.slice(0, 120)}`);
                else if (value && typeof value === 'object') walk(value, path);
            }
        };
        walk(first, '');
        console.log(urls.length ? `图片/链接字段：\n${urls.slice(0, 10).join('\n')}` : '没有找到 http(s) 链接字段');
    } catch (error) {
        console.log(`=== ${toolId} 调用失败：${String(error.message || error).slice(0, 200)}`);
    }
}

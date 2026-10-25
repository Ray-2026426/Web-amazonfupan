#!/usr/bin/env node
/**
 * 探测三：把 erp_listing（Listing 列表）彻底调通，看它是否带主图 URL。
 * 关键点：领星网关偶尔要求「调用前重新拉一次工具列表」，这里强制刷新后再调。
 */
import { createClient } from './lingxing-client.mjs';

const client = createClient({ intervalMs: 1500, verbose: true });

const shops = (await client.call('get_my_sids', null)).list || [];
const shop = shops.find((item) => !item.is_concept) || shops[0];
const sid = String(shop?.id || '');
console.log(`店铺样例：id=${sid}`);

const schema = await client.gateway('search', { toolId: 'erp_listing' });
console.log('完整入参：');
console.log(JSON.stringify(schema?.inputSchema || schema));

// 强制刷新一次工具列表，再调用
await client.rpc('tools/list', {});
await client.gateway('help', { limit: 50, offset: 0 });

const attempts = [
    [{ sids: sid, offset: 0, length: 5 }, 'sids + 分页'],
    [{ sids: sid, offset: 0, length: 5, sort_field: 'msku', sort_type: 'asc' }, 'sids + 排序'],
];

for (const [params, label] of attempts) {
    try {
        const data = await client.call('erp_listing', params);
        const list = data?.list || data?.data || [];
        const first = Array.isArray(list) ? list[0] : list;
        console.log(`\n[${label}] 成功，${Array.isArray(list) ? list.length : '?'} 行`);
        console.log(`字段：${Object.keys(first || {}).join(', ')}`);
        const urls = [];
        const walk = (obj, prefix) => {
            for (const [key, value] of Object.entries(obj || {})) {
                const path = prefix ? `${prefix}.${key}` : key;
                if (typeof value === 'string' && /^https?:\/\//.test(value)) urls.push(`${path} = ${value.slice(0, 130)}`);
                else if (value && typeof value === 'object') walk(value, path);
            }
        };
        walk(first, '');
        console.log(urls.length ? `链接字段：\n${urls.slice(0, 10).join('\n')}` : '没有 http(s) 链接字段');
        console.log(`样例行：${JSON.stringify(first).slice(0, 800)}`);
        break;
    } catch (error) {
        console.log(`\n[${label}] 失败：${String(error.message || error).slice(0, 240)}`);
    }
}

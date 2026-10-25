#!/usr/bin/env node
/**
 * 探测二：get_fba_stock_list 的返回结构（字段名 + 分页字段）。
 */
import { createClient } from './lingxing-client.mjs';

const client = createClient({ intervalMs: 1500, verbose: true });

const shops = (await client.call('get_my_sids', null)).list || [];
const shop = shops.find((item) => !item.is_concept) || shops[0];
const sid = String(shop?.id || '');
console.log(`店铺：${sid}`);

const schema = await client.gateway('search', { toolId: 'get_fba_stock_list' });
const props = schema?.inputSchema?.properties || {};
console.log(`入参字段：${Object.keys(props).join(', ')}`);
console.log(`必填：${JSON.stringify(schema?.inputSchema?.required || [])}`);

const data = await client.call('get_fba_stock_list', {
    sid,
    offset: 0,
    length: 20,
    is_hide_zero_stock: '0',
    is_parant_asin_merge: '0',
});
console.log(`顶层键：${Object.keys(data || {}).join(', ')}`);
const text = JSON.stringify(data);
console.log(`原始片段：${text.slice(0, 1200)}`);

const list = data?.list || data?.data || data?.rows || [];
const first = Array.isArray(list) ? list[0] : null;
if (first) {
    console.log('首行字段：');
    console.log(Object.keys(first).join(', '));
    console.log(`首行样例：${JSON.stringify(first).slice(0, 800)}`);
} else {
    console.log('没有取到列表，试着打印 total：', data?.total, data?.data?.total);
}

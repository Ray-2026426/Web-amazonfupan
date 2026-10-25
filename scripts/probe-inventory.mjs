#!/usr/bin/env node
/**
 * 探测：get_fba_stock_list 的返回结构，结果写到 reports/probe-inventory.json 并随工作流提交。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from './lingxing-client.mjs';

const out = { at: new Date().toISOString(), shop: null, schema: null, topKeys: [], sample: null, sampleKeys: [], total: null, error: null };

try {
    const client = createClient({ intervalMs: 1500, verbose: true });
    const shops = (await client.call('get_my_sids', null)).list || [];
    const shop = shops.find((item) => !item.is_concept) || shops[0];
    out.shop = { id: shop?.id, count: shops.length };

    const schema = await client.gateway('search', { toolId: 'get_fba_stock_list' });
    out.schema = schema?.inputSchema || schema;

    const data = await client.call('get_fba_stock_list', {
        sid: String(shop?.id || ''),
        offset: 0,
        length: 20,
        is_hide_zero_stock: '0',
        is_parant_asin_merge: '0',
    });
    out.topKeys = Object.keys(data || {});
    out.total = data?.total ?? data?.data?.total ?? null;
    const list = data?.list || data?.data?.list || data?.data || [];
    const first = Array.isArray(list) ? list[0] : null;
    out.sampleKeys = first ? Object.keys(first) : [];
    out.sample = first ? JSON.stringify(first).slice(0, 3000) : JSON.stringify(data).slice(0, 2000);
} catch (error) {
    out.error = String(error.message || error).slice(0, 400);
}

const file = path.join(process.cwd(), 'reports', 'probe-inventory.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out).slice(0, 1500));

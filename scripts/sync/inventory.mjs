#!/usr/bin/env node
/**
 * 每日库存快照（领星 get_fba_stock_list → Supabase fact_inventory）。
 *
 * 每天跑一次，按「日期 + 店铺 + MSKU」存一行，字段直接对齐领星库存报表：
 *   可售 / 预留 / 在途(已发/收货中/处理中) / 不可售 / 在库合计 / 可售天数 / 售罄率 / 总成本 / 图片
 */
import { createClient } from '../lingxing-client.mjs';

const BASE = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || '';
const DAY = process.argv.includes('--date') ? process.argv[process.argv.indexOf('--date') + 1] : null;
const DATE = DAY || new Date(Date.now() - 86400000).toISOString().slice(0, 10); // 默认昨天
const PAGE = 200;

const num = (value) => {
    const n = Number(String(value ?? '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
};
const text = (value) => (value === null || value === undefined ? null : String(value).slice(0, 500));

function headers() {
    return {
        apikey: KEY,
        'Content-Type': 'application/json',
        ...(KEY.startsWith('eyJ') ? { Authorization: `Bearer ${KEY}` } : {}),
    };
}

async function insertBatch(rows) {
    const response = await fetch(`${BASE}/rest/v1/fact_inventory?on_conflict=date,sid,msku`, {
        method: 'POST',
        headers: { ...headers(), Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows),
    });
    if (!response.ok) throw new Error(`写入失败 HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
}

async function clearDate() {
    const response = await fetch(`${BASE}/rest/v1/fact_inventory?date=eq.${DATE}`, { method: 'DELETE', headers: headers() });
    if (!response.ok) throw new Error(`清理旧数据失败 HTTP ${response.status}`);
}

const client = createClient({ intervalMs: 1300, verbose: true });
const shops = (await client.call('get_my_sids', null)).list || [];
const active = shops.filter((shop) => !shop.is_concept);
console.log(`日期 ${DATE}，店铺 ${active.length} 个`);

const rows = [];
let calls = 0;
for (const shop of active) {
    const sid = String(shop.id);
    let offset = 0;
    let total = null;
    while (total === null || offset < total) {
        const data = await client.call('get_fba_stock_list', {
            sid,
            offset,
            length: PAGE,
            is_hide_zero_stock: '0',
            is_parant_asin_merge: '0',
        });
        calls += 1;
        const list = data?.list || [];
        if (total === null) total = Number(data?.total || 0);
        for (const item of list) {
            const msku = text(item.sku || item.seller_sku || item.msku);
            if (!msku) continue;
            rows.push({
                date: DATE,
                sid,
                asin: text(item.asin),
                msku,
                fnsku: text(item.fnsku),
                product_name: text(item.product_name || item.name),
                shop_name: text(item.seller_name || shop.name),
                parent_asin: text(item.parent_asin_real || (Array.isArray(item.parent_asin_arr) ? item.parent_asin_arr[0] : null)),
                fulfillable: num(item.afn_fulfillable_quantity),
                reserved: num(item.afn_reserved_quantity),
                inbound_shipped: num(item.afn_inbound_shipped_quantity),
                inbound_receiving: num(item.afn_inbound_receiving_quantity),
                inbound_working: num(item.afn_inbound_working_quantity),
                researching: num(item.afn_researching_quantity),
                unsellable: num(item.afn_unsellable_quantity),
                total_onhand: num(item.total_onhand_quantity ?? item.quantity),
                days_of_supply: num(item.historical_days_of_supply),
                sell_through: num(item.sell_through),
                health: text(item.fba_inventory_level_health_status || item.warn_status_name),
                unit_cost: num(item.cg_price ?? item.quantity_price),
                total_cost: num(item.total_cost ?? item.total_amount),
                pic_url: text(item.pic_url || item.small_image_url),
            });
        }
        offset += PAGE;
        if (list.length === 0) break;
        if (offset > 20000) break;
    }
    console.log(`  店铺 ${sid}（${shop.name || ''}）：${total ?? '?'} 行`);
}

console.log(`共 ${rows.length} 行，调用 ${calls} 次`);
if (!rows.length) {
    console.log('没有库存数据，跳过写入');
    process.exit(0);
}

await clearDate();
for (let i = 0; i < rows.length; i += 500) {
    await insertBatch(rows.slice(i, i + 500));
}
console.log(`已写入 fact_inventory：${rows.length} 行（${DATE}）`);

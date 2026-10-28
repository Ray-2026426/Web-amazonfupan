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

let ageColumnReady = true;

const withoutAge = (list) => list.map(({ age_raw: _ignored, ...rest }) => rest);
const postRows = (list) => fetch(`${BASE}/rest/v1/fact_inventory?on_conflict=date,sid,msku`, {
    method: 'POST',
    headers: { ...headers(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(list),
});

async function insertBatch(rows) {
    let response = await postRows(ageColumnReady ? rows : withoutAge(rows));
    if (response.ok) return;
    const detail = (await response.text()).slice(0, 300);
    // 还没跑最新 schema 时没有 age_raw 列：降级写入，别让整次快照失败
    if (ageColumnReady && /age_raw/.test(detail)) {
        ageColumnReady = false;
        console.log('  表里还没有 age_raw 列（跑一次 db/schema.sql 即可启用库龄），本次先跳过库龄');
        response = await postRows(withoutAge(rows));
        if (response.ok) return;
        throw new Error(`写入失败 HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    throw new Error(`写入失败 HTTP ${response.status}: ${detail}`);
}

async function clearDate() {
    const response = await fetch(`${BASE}/rest/v1/fact_inventory?date=eq.${DATE}`, { method: 'DELETE', headers: headers() });
    if (!response.ok) throw new Error(`清理旧数据失败 HTTP ${response.status}`);
}

const client = createClient({ intervalMs: 1300, verbose: true });

/**
 * 领星库存明细里的库龄字段（字段名以 inv_age_*_days 为准），
 * 归一成前端使用的 8 个分桶；其它派生字段（如 0_to_90）忽略，避免重复计数。
 */
const AGE_FIELDS = {
    age_0_30: 'inv_age_0_to_30_days',
    age_31_60: 'inv_age_31_to_60_days',
    age_61_90: 'inv_age_61_to_90_days',
    age_91_180: 'inv_age_91_to_180_days',
    age_181_270: 'inv_age_181_to_270_days',
    age_271_330: 'inv_age_271_to_330_days',
    age_331_365: 'inv_age_331_to_365_days',
    age_365_plus: 'inv_age_365_plus_days',
};

function ageRaw(item) {
    const out = {};
    for (const [bucket, field] of Object.entries(AGE_FIELDS)) {
        const value = num(item?.[field]);
        if (value) out[bucket] = value;
    }
    return Object.keys(out).length ? out : null;
}

/** 领星库存接口偶发 code=500 内部错误：退避重试 3 次 */
async function fetchStockPage(params, attempt = 1) {
    try {
        return await client.call('get_fba_stock_list', params);
    } catch (error) {
        const message = String(error?.message || error);
        if (!/code=500|code=504|超时|timeout|429/i.test(message) || attempt >= 3) throw error;
        const waitMs = 8000 * attempt;
        console.log(`  接口报错「${message.slice(0, 60)}」，${waitMs / 1000}s 后重试（第 ${attempt + 1} 次）`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        return fetchStockPage(params, attempt + 1);
    }
}

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
        const data = await fetchStockPage({
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
                age_raw: ageRaw(item),
            });
        }
        if (!globalThis.__loggedRow && list[0]) {
            globalThis.__loggedRow = true;
            const sample = {};
            for (const key of ['afn_fulfillable_quantity','afn_reserved_quantity','afn_inbound_shipped_quantity','afn_inbound_receiving_quantity','afn_inbound_working_quantity','afn_unsellable_quantity','total_onhand_quantity','total_fulfillable_quantity','available_total','quantity','sku','asin','fnsku','pic_url','cg_price','total_amount','inv_age_0_to_30_days','inv_age_365_plus_days']) {
                sample[key] = list[0][key];
            }
            console.log('原始行样例：' + JSON.stringify(sample));
        }
        if (!globalThis.__loggedKeys && list[0]) {
            globalThis.__loggedKeys = true;
            console.log('  原始字段样例：' + Object.keys(list[0]).join(','));
        }
        offset += PAGE;
        if (list.length === 0) break;
        if (offset > 20000) break;
    }
    console.log(`  店铺 ${sid}（${shop.name || ''}）：${total ?? '?'} 行`);
}

/**
 * 同一店铺里同一个 MSKU 可能因为多 FNSKU / 多 ASIN 出现多行，
 * 直接 upsert 会报 "ON CONFLICT DO UPDATE command cannot affect row a second time"。
 * 这里按主键 (date, sid, msku) 先去重：保留在库数量最大的那一行（更接近真实库存）。
 */
const deduped = new Map();
for (const row of rows) {
    const key = `${row.date}|${row.sid}|${row.msku}`;
    const existing = deduped.get(key);
    if (!existing || Number(row.total_onhand || 0) > Number(existing.total_onhand || 0)) {
        deduped.set(key, row);
    }
}
const uniqueRows = [...deduped.values()];
if (uniqueRows.length !== rows.length) {
    console.log(`同一 MSKU 多行：${rows.length} → 去重后 ${uniqueRows.length} 行`);
}

console.log(`共 ${uniqueRows.length} 行，调用 ${calls} 次`);
if (!uniqueRows.length) {
    console.log('没有库存数据，跳过写入');
    process.exit(0);
}

await clearDate();
for (let i = 0; i < uniqueRows.length; i += 500) {
    await insertBatch(uniqueRows.slice(i, i + 500));
}
console.log(`已写入 fact_inventory：${uniqueRows.length} 行（${DATE}）`);

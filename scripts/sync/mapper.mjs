/**
 * 领星 API 返回 → 本系统 DataRow 的纯转换层
 *
 * 单独抽出来的原因（重要）：
 *   · 领星返回的字段名、类型、嵌套结构和 DataRow 差别很大（金额是 "0.00" 字符串、
 *     品牌/店铺/品类是数组、成本要从「订单利润」表按 sid|asin 归并），
 *     这套映射一旦散落在脚本里，入库和导出就会各写一份，迟早对不上。
 *   · 这里全是纯函数，可以用真实接口快照做离线单测（见 selftest.mjs），
 *     不依赖网络、不依赖密钥。
 *
 * 口径约定（与现有 Excel 报表保持一致）：
 *   · 成本类字段一律取绝对值（领星返回时常为负数）
 *   · 毛利额来自「订单利润」的 gross_profit，不从销售额推算
 *   · 销售额 / 广告销售额保留原币种（币种记在 snapshot.meta.currency）
 */

/** 领星大量金额字段是字符串，统一转数字 */
export const num = (v) => {
    if (v === null || v === undefined || v === '') return 0;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
};

export const abs = (v) => Math.abs(num(v));

/** 品类取二级分类：categories 是数组，元素形如 "A:B:C" 或 {name} */
export function categoryLevel2(categories) {
    const first = Array.isArray(categories) ? categories[0] : categories;
    if (!first) return '';
    const raw = typeof first === 'string' ? first : first.name || first.category_name || '';
    const parts = String(raw)
        .split(/[\\:>/|]/)
        .map((s) => s.trim())
        .filter(Boolean);
    return parts[1] || parts[0] || '';
}

/** 店铺维度：优先用行内的 seller_store_countries，回落店铺列表 */
function shopMeta(shop, row) {
    const sc = (row.seller_store_countries || [])[0] || {};
    return {
        sid: String(row.sid || shop?.id || ''),
        shop_name: sc.seller_name || shop?.name || '',
        country: sc.country || shop?.country || '',
    };
}

const EMPTY_COST = {
    refund_amount: 0,
    gross_profit: 0,
    first_mile: 0,
    fba_fee: 0,
    storage_fee: 0,
    purchase: 0,
    commission: 0,
};

/** 「有活动」判定：任一经纬度非 0 才保留，避免把整个 ASIN 目录（97% 是零）搬进库 */
const ACTIVE_FIELDS = ['volume', 'amount', 'order_items', 'impressions', 'clicks', 'spend', 'sessions_total', 'ad_order_quantity'];

export function isActiveRow(row) {
    return ACTIVE_FIELDS.some((k) => num(row[k]) !== 0);
}

/**
 * 单行转换。
 * @param {object} args
 * @param {object} args.shop   店铺对象（get_my_sids 的一行）
 * @param {object} args.row    query_product_performance_asin_lists 的一行
 * @param {object} [args.cost] 同一 (sid, asin) 的成本（来自订单利润归并）
 * @param {string} args.date   YYYY-MM-DD
 */
export function toDataRow({ shop, row, cost, date, override }) {
    const meta = shopMeta(shop, row);
    const c = cost || EMPTY_COST;
    const asin = row.asin || '-';
    const data = {
        id: `${meta.sid}|${asin}|${date}`,
        date,
        /** 数据库主键用的两个维度（DataRow 本身不需要，但入库需要） */
        sid: meta.sid,
        asin,
        country: meta.country,
        shop_name: meta.shop_name,
        brand: (row.brands || [])[0] || '',
        manager: (row.principal_names || [])[0] || '',
        sub_category: categoryLevel2(row.categories),
        parent_asin: (row.parent_asins || [])[0]?.parent_asin || row.parent_asin || '',
        child_asin: asin,
        // 领星 item_name 是 Amazon 标题，不是内部品名。品名在 price_list[].local_name。
        product_name: (() => {
            const prices = row.price_list || [];
            const best = prices.reduce((a, b) => num(b?.volume) > num(a?.volume) ? b : a, prices[0]);
            return best?.local_name || prices.find((p) => p?.local_name)?.local_name || row.local_name || '';
        })(),

        sales_quantity: num(row.volume),
        sales_amount: num(row.amount),
        gross_profit: num(c.gross_profit),
        fba_sellable_qty: num(row.afn_fulfillable_quantity),
        sessions: num(row.sessions_total),

        first_mile_cost: abs(c.first_mile),
        procurement_cost: abs(c.purchase),
        storage_fee: abs(c.storage_fee),
        fba_fee: abs(c.fba_fee),
        refund_cost: abs(c.refund_amount),
        platform_commission: abs(c.commission),

        ad_spend: abs(row.spend),
        ad_sales: abs(row.ad_sales_amount),
        ad_orders: num(row.ad_order_quantity),
        sp_spend: abs(row.ads_sp_cost),
        sp_sales: abs(row.ads_sp_sales),
        sd_spend: abs(row.ads_sd_cost),
        sd_sales: abs(row.ads_sd_sales),
        sb_spend: abs(row.shared_ads_sb_cost),
        sb_sales: abs(row.shared_ads_sb_sales),
        sbv_spend: abs(row.shared_ads_sbv_cost),
        sbv_sales: abs(row.shared_ads_sbv_sales),

        impressions: num(row.impressions),
        clicks: num(row.clicks),
        natural_orders: num(row.nature_order_items),
        natural_clicks: num(row.nature_click),

        rating: num(row.avg_star),
        review_count: num(row.reviews_count),
    };
    for (const field of ['brand', 'manager', 'sub_category', 'parent_asin', 'product_name']) {
        if (override?.[field] !== null && override?.[field] !== undefined) data[field] = override[field];
    }
    return data;
}

/** 订单利润行（msku 粒度）→ key `${sid}|${asin}` → 累加成本 */
export function mergeOrderProfit(opRows, { firstMileField = 'logistics_costs', asinRules = new Map() } = {}) {
    const map = new Map();
    for (const r of opRows || []) {
        const pl = (r.price_list || [])[0] || {};
        const sid = String((r.sids || [])[0] ?? pl.sid ?? '');
        const localSku = String(pl.local_sku || pl.seller_sku || r.msku || '');
        const asin = asinRules.get(`${sid}|${localSku}`) || pl.asin;
        if (!asin || !sid) continue;
        const key = `${sid}|${asin}`;
        const cur = map.get(key) || { ...EMPTY_COST };
        cur.refund_amount += abs(r.refund_amount);
        cur.gross_profit += num(r.gross_profit);
        cur.first_mile += abs(r[firstMileField]);
        cur.fba_fee += abs(r.fulfillment_fee);
        cur.storage_fee += abs(r.fba_storage_fee);
        cur.purchase += abs(r.purchase_costs);
        cur.commission += abs(r.selling_fee);
        map.set(key, cur);
    }
    return map;
}

/* ------------------------------------------------------------------ *
 * 周口径：与前端 utils.ts 完全一致（周日起算，周序号年可能跨公历年）
 * ------------------------------------------------------------------ */

const MS_PER_DAY = 86400000;

function startOfSundayWeek(d) {
    const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    copy.setDate(copy.getDate() - copy.getDay());
    return copy;
}

function firstSundayWeekOfYear(year) {
    return startOfSundayWeek(new Date(year, 0, 1));
}

/** YYYY-MM-DD → "YYYY-Www"（周序号年 + 周序号），与前端 formatBusinessWeekFromDateStr 同算法 */
export function weekKeyFromDate(dateStr) {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    if (!y || !m || !d) return 'Unknown';
    const target = startOfSundayWeek(new Date(y, m - 1, d));
    for (const tryY of [y - 1, y, y + 1]) {
        const first = firstSundayWeekOfYear(tryY);
        const next = firstSundayWeekOfYear(tryY + 1);
        if (target >= first && target < next) {
            const week = Math.floor((target - first) / (MS_PER_DAY * 7)) + 1;
            return `${tryY}-W${String(week).padStart(2, '0')}`;
        }
    }
    return 'Unknown';
}

export const monthKeyFromDate = (dateStr) => String(dateStr).slice(0, 7);

/* ------------------------------------------------------------------ *
 * 聚合：日明细 → 月度 / 周度行（与上传表同口径，可加总指标直接相加，
 * 比率类不落库，由前端按分子/分母重算）
 * ------------------------------------------------------------------ */

const SUM_FIELDS = [
    'sales_quantity', 'sales_amount', 'gross_profit', 'sessions',
    'first_mile_cost', 'procurement_cost', 'storage_fee', 'fba_fee', 'refund_cost', 'platform_commission',
    'ad_spend', 'ad_sales', 'ad_orders', 'sp_spend', 'sp_sales', 'sd_spend', 'sd_sales',
    'sb_spend', 'sb_sales', 'sbv_spend', 'sbv_sales', 'impressions', 'clicks',
    'natural_orders', 'natural_clicks', 'review_count',
];

const DIM_FIELDS = ['country', 'shop_name', 'brand', 'manager', 'sub_category', 'parent_asin', 'child_asin', 'product_name'];

/**
 * @param {Array} rows 日明细
 * @param {'month'|'week'} granularity
 * @returns {{rows: Array, periodOf: (r:any)=>string}}
 */
export function aggregateRows(rows, granularity) {
    const periodOf = granularity === 'week' ? (r) => weekKeyFromDate(r.date) : (r) => monthKeyFromDate(r.date);
    const buckets = new Map();

    for (const r of rows) {
        const period = periodOf(r);
        const key = [period, ...DIM_FIELDS.map((f) => r[f] ?? '')].join('|');
        let acc = buckets.get(key);
        if (!acc) {
            acc = { id: key, period, date: period };
            for (const f of DIM_FIELDS) acc[f] = r[f];
            /** 数据库主键维度：月度/周度行同样需要 sid、asin */
            acc.sid = r.sid ?? '';
            acc.asin = r.asin ?? r.child_asin ?? '';
            for (const f of SUM_FIELDS) acc[f] = 0;
            // 库存/评分是「快照值」，聚合时取最后一天
            acc.fba_sellable_qty = 0;
            acc.rating = 0;
            acc._lastDate = '';
            buckets.set(key, acc);
        }
        for (const f of SUM_FIELDS) acc[f] += num(r[f]);
        if (r.date >= acc._lastDate) {
            acc._lastDate = r.date;
            acc.fba_sellable_qty = num(r.fba_sellable_qty);
            acc.rating = num(r.rating);
        }
    }

    const out = [...buckets.values()].map(({ _lastDate, ...rest }) => rest);
    return { rows: out, periodOf };
}

/* ------------------------------------------------------------------ *
 * 校验：宁可整批失败，也不要把半份数据写进库
 * ------------------------------------------------------------------ */

export function validateSnapshot({ dailyRows, rawPPRows, shops, dates, currency, failedShopCalls = 0 }) {
    const errors = [];
    const warnings = [];

    if (!dailyRows.length) errors.push('转换后 0 行，中止');
    if (!Array.isArray(shops) || shops.length === 0) errors.push('店铺列表为空');
    if (!dates.length) errors.push('日期区间为空');
    if (failedShopCalls > 0) errors.push(`${failedShopCalls} 个店铺查询失败，拒绝发布不完整数据`);

    // 店铺覆盖：有销量的店铺必须都被拉到
    const shopsWithSales = new Set(dailyRows.filter((r) => r.sales_amount > 0).map((r) => r.shop_name));
    if (shopsWithSales.size === 0) warnings.push('所选区间内没有任何销售额');

    // 成本匹配率：太低通常意味着订单利润表口径/币种不对
    const matched = dailyRows.filter((r) => Math.abs(r.gross_profit) > 0).length;
    const matchRate = dailyRows.length ? matched / dailyRows.length : 0;
    if (matchRate < 0.5) {
        warnings.push(`成本匹配率偏低（${(matchRate * 100).toFixed(1)}%）：检查币种 ${currency} 与订单利润口径`);
    }

    // 原始行数与入库行数（滤掉零活动是预期的）
    const zeroFiltered = Math.max(0, (rawPPRows || 0) - dailyRows.length);
    if (rawPPRows && dailyRows.length / rawPPRows < 0.005) {
        warnings.push(`保留率异常低（${rawPPRows} → ${dailyRows.length}），请确认 isActiveRow 判定`);
    }

    // 负毛利不一定错，但突然大面积负毛利要提示
    const negative = dailyRows.filter((r) => r.gross_profit < 0).length;
    if (negative / Math.max(1, dailyRows.length) > 0.3) {
        warnings.push(`负毛利行占比 ${((negative / dailyRows.length) * 100).toFixed(0)}%，请核对成本口径`);
    }

    return { ok: errors.length === 0, errors, warnings, zeroFiltered, costMatchRate: matchRate };
}

export { SUM_FIELDS, DIM_FIELDS, EMPTY_COST };

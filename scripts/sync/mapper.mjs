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

import { ABS_FIELDS, DEFAULT_FIELD_PATHS } from '../../shared/field-mapping.mjs';

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

/* ------------------------------------------------------------------ *
 * 字段映射：web 字段 ← 领星字段路径
 *
 * 领星 MCP 返回的字段名会变（例如品名从 item_name 改成 price_list[].local_name），
 * 所以「取哪个字段」做成云端可配置的映射表，改配置即可，不用发版。
 *
 * 路径语法：
 *   brands[]                    数组里第一个非空元素
 *   parent_asins[].parent_asin  数组里第一个非空的子字段
 *   seller_store_countries[0].country  指定下标
 *   categories[]@level(2)       取到值后按分隔符切分并取第 2 段（二级分类）
 *   price_list[].local_name@max(volume)  取 volume 最大的那个元素的 local_name
 * ------------------------------------------------------------------ */

export { DEFAULT_FIELD_PATHS };

const PATH_RE = /^([A-Za-z0-9_]+)(?:\[(\d*)\])?(?:\.([A-Za-z0-9_]+))?$/;

function toText(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'object') return String(value.name ?? value.value ?? '').trim();
    return String(value).trim();
}

/** 按映射路径从领星行里取值；取不到返回 ''，由调用方决定回落值 */
export function resolveField(row, path) {
    if (!row || !path) return '';
    let raw = String(path).trim();
    let transform = '';
    const at = raw.indexOf('@');
    if (at > 0) {
        transform = raw.slice(at + 1);
        raw = raw.slice(0, at);
    }
    const match = PATH_RE.exec(raw);
    if (!match) return '';

    const [, key, index, sub] = match;
    const read = (item) => {
        if (!sub) return toText(item);
        const value = sub.split('.').reduce((acc, part) => (acc == null ? undefined : acc[part]), item);
        return toText(value);
    };

    let value = '';
    const field = row[key];
    if (index === undefined) {
        value = read(field);
    } else if (Array.isArray(field)) {
        if (index === '') {
            const maxMatch = /^max\(([A-Za-z0-9_]+)\)$/.exec(transform);
            if (maxMatch) {
                const best = field.reduce((a, b) => (num(b?.[maxMatch[1]]) > num(a?.[maxMatch[1]]) ? b : a), field[0]);
                value = read(best);
            } else {
                for (const item of field) {
                    const candidate = read(item);
                    if (candidate) { value = candidate; break; }
                }
            }
        } else {
            value = read(field[Number(index)]);
        }
    }

    const levelMatch = /^level\((\d+)\)$/.exec(transform);
    if (levelMatch && value) {
        const parts = String(value).split(/[\\:>/|]/).map((s) => s.trim()).filter(Boolean);
        value = parts[Number(levelMatch[1]) - 1] || parts[0] || '';
    }
    return value;
}

/** 映射表（Map 或普通对象）合并到默认值，缺项回落到默认路径 */
function normalizeFieldMap(fieldMap) {
    if (!fieldMap) return DEFAULT_FIELD_PATHS;
    const entries = fieldMap instanceof Map ? [...fieldMap.entries()] : Object.entries(fieldMap);
    const result = { ...DEFAULT_FIELD_PATHS };
    for (const [key, value] of entries) {
        if (typeof value === 'string' && value.trim()) result[key] = value.trim();
    }
    return result;
}

const EMPTY_COST = {
    refund_amount: 0,
    gross_profit: 0,
    logistics_costs: 0,
    fulfillment_fee: 0,
    fba_storage_fee: 0,
    purchase_costs: 0,
    selling_fee: 0,
};

/** 「有活动」判定：任一经纬度非 0 才保留，避免把整个 ASIN 目录（97% 是零）搬进库 */
const ACTIVE_FIELDS = ['volume', 'amount', 'order_items', 'impressions', 'clicks', 'spend', 'sessions_total', 'ad_order_quantity'];

export function isActiveRow(row) {
    return ACTIVE_FIELDS.some((k) => num(row[k]) !== 0);
}

/** 旧的品名取值逻辑，作为映射解析不到时的兜底 */
function legacyProductName(row) {
    const prices = row.price_list || [];
    const best = prices.reduce((a, b) => (num(b?.volume) > num(a?.volume) ? b : a), prices[0]);
    return best?.local_name || prices.find((p) => p?.local_name)?.local_name || row.local_name || '';
}

/** 按「pp. / op.」前缀取值：op 取自成本对象，pp 取自产品表现行 */
function readValue(row, cost, path) {
    const text = String(path || '').trim();
    const match = /^(pp|op)\.(.+)$/.exec(text);
    if (!match) return resolveField(row, text);
    if (match[1] === 'op') return cost ? cost[match[2]] ?? '' : '';
    return resolveField(row, match[2]);
}

/**
 * 单行转换。
 * @param {object} args
 * @param {object} args.shop   店铺对象（get_my_sids 的一行）
 * @param {object} args.row    query_product_performance_asin_lists 的一行
 * @param {object} [args.cost] 同一 (sid, asin) 的成本（来自订单利润归并）
 * @param {string} args.date   YYYY-MM-DD
 * @param {Map<string,string>|object} [args.fieldMap] 云端字段映射（web 字段 → 领星字段路径）
 */
export function toDataRow({ shop, row, cost, date, fieldMap }) {
    const meta = shopMeta(shop, row);
    const c = cost || EMPTY_COST;
    const paths = normalizeFieldMap(fieldMap);
    const pickText = (field, fallback = '') => toText(readValue(row, c, paths[field])) || fallback;
    const pickNumber = (field) => {
        const value = num(readValue(row, c, paths[field]));
        return ABS_FIELDS.has(field) ? Math.abs(value) : value;
    };
    const asin = pickText('asin') || '-';
    const data = {
        id: `${meta.sid}|${asin}|${date}`,
        date,
        /** 数据库主键用的两个维度（DataRow 本身不需要，但入库需要） */
        sid: meta.sid,
        asin,
        country: pickText('country', meta.country),
        shop_name: pickText('shop_name', meta.shop_name),
        brand: pickText('brand'),
        manager: pickText('manager'),
        sub_category: pickText('sub_category') || categoryLevel2(row.categories),
        parent_asin: pickText('parent_asin') || row.parent_asin || '',
        child_asin: asin,
        // 领星 item_name 是 Amazon 标题，不是内部品名。品名默认取 price_list 里销量最大的 local_name。
        product_name: pickText('product_name') || legacyProductName(row),

        sales_quantity: pickNumber('sales_quantity'),
        order_quantity: pickNumber('order_quantity'),
        sales_amount: pickNumber('sales_amount'),
        gross_profit: pickNumber('gross_profit'),
        fba_sellable_qty: pickNumber('fba_sellable_qty'),
        sessions: pickNumber('sessions'),

        first_mile_cost: pickNumber('first_mile_cost'),
        procurement_cost: pickNumber('procurement_cost'),
        storage_fee: pickNumber('storage_fee'),
        fba_fee: pickNumber('fba_fee'),
        refund_cost: pickNumber('refund_cost'),
        platform_commission: pickNumber('platform_commission'),

        ad_spend: pickNumber('ad_spend'),
        ad_sales: pickNumber('ad_sales'),
        ad_orders: pickNumber('ad_orders'),
        sp_spend: pickNumber('sp_spend'),
        sp_sales: pickNumber('sp_sales'),
        sd_spend: pickNumber('sd_spend'),
        sd_sales: pickNumber('sd_sales'),
        sb_spend: pickNumber('sb_spend'),
        sb_sales: pickNumber('sb_sales'),
        sbv_spend: pickNumber('sbv_spend'),
        sbv_sales: pickNumber('sbv_sales'),

        impressions: pickNumber('impressions'),
        clicks: pickNumber('clicks'),
        natural_orders: pickNumber('natural_orders'),
        natural_clicks: pickNumber('natural_clicks'),

        rating: pickNumber('rating'),
        review_count: pickNumber('review_count'),
    };
    return data;
}

/**
 * 「只有成本、当天没有销量」的 ASIN。
 *
 * 为什么需要：领星「订单利润」里，仓储费/头程/退款这类一次性成本会砸在某一天的某些 ASIN 上，
 * 而「产品表现」当天没有这些 ASIN 的行（没销量就没记录）。只按产品表现建行会把这些成本丢掉，
 * 导致日毛利偏高（实测 1~18%）。这里把它们补成「有成本、无销量」的行，日合计才能和领星对齐。
 */
export function toCostOnlyRow({ shop, asin, cost, date, meta }) {
    const c = cost || EMPTY_COST;
    const sid = String(shop?.id ?? '');
    return {
        id: `${sid}|${asin}|${date}`,
        date,
        sid,
        asin,
        country: shop?.country || '',
        shop_name: shop?.name || '',
        brand: '',
        manager: meta?.manager || '',
        sub_category: '',
        parent_asin: '',
        child_asin: asin,
        product_name: meta?.product_name || '',

        sales_quantity: 0,
        order_quantity: 0,
        sales_amount: 0,
        gross_profit: num(c.gross_profit),
        fba_sellable_qty: 0,
        sessions: 0,

        first_mile_cost: abs(c.logistics_costs),
        procurement_cost: abs(c.purchase_costs),
        storage_fee: abs(c.fba_storage_fee),
        fba_fee: abs(c.fulfillment_fee),
        refund_cost: abs(c.refund_amount),
        platform_commission: abs(c.selling_fee),

        ad_spend: 0, ad_sales: 0, ad_orders: 0,
        sp_spend: 0, sp_sales: 0, sd_spend: 0, sd_sales: 0,
        sb_spend: 0, sb_sales: 0, sbv_spend: 0, sbv_sales: 0,

        impressions: 0, clicks: 0, natural_orders: 0, natural_clicks: 0,
        rating: 0, review_count: 0,
    };
}

/** 成本行是否值得入库：全零成本的行不加，避免刷出大量空行 */
export function hasMeaningfulCost(cost) {
    if (!cost) return false;
    const total =
        Math.abs(num(cost.gross_profit)) +
        Math.abs(num(cost.logistics_costs)) +
        Math.abs(num(cost.purchase_costs)) +
        Math.abs(num(cost.fba_storage_fee)) +
        Math.abs(num(cost.fulfillment_fee)) +
        Math.abs(num(cost.refund_amount)) +
        Math.abs(num(cost.selling_fee));
    return total > 0.005;
}

/** 订单利润行（msku 粒度）→ key `${sid}|${asin}` → 累加成本 */
export function mergeOrderProfit(opRows, { firstMileField = 'logistics_costs' } = {}) {
    const map = new Map();
    for (const r of opRows || []) {
        const pl = (r.price_list || [])[0] || {};
        const sid = String((r.sids || [])[0] ?? pl.sid ?? '');
        const asin = pl.asin;
        if (!asin || !sid) continue;
        const key = `${sid}|${asin}`;
        const cur = map.get(key) || { ...EMPTY_COST };
        cur.refund_amount += abs(r.refund_amount);
        cur.gross_profit += num(r.gross_profit);
        cur.logistics_costs += abs(r[firstMileField]);
        cur.fulfillment_fee += abs(r.fulfillment_fee);
        cur.fba_storage_fee += abs(r.fba_storage_fee);
        cur.purchase_costs += abs(r.purchase_costs);
        cur.selling_fee += abs(r.selling_fee);
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
    'sales_quantity', 'order_quantity', 'sales_amount', 'gross_profit', 'sessions',
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

export function validateSnapshot({ dailyRows, rawPPRows, shops, dates, currency, failedShopCalls = 0, reconciliations = [] }) {
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

    /*
     * 对账（唯一可信的校验方式）：
     * 拿「我算出来的当日毛利合计」对比「领星自己在订单利润里返回的 total_sum.gross_profit」。
     *
     * 为什么不用「负毛利行占比」当警报：领星是 MSKU/天 粒度，仓储费、头程、退款这些一次性成本
     * 会砸在某一天的某个 SKU 上，导致大量行当天为负——实测 2026-09-17 有 59% 的 MSKU 行为负，
     * 但合计毛利 9.47% 与领星自己报的 9.47% 完全一致。用行占比判断会误报。
     */
    const negative = dailyRows.filter((r) => r.gross_profit < 0).length;
    const negativeShare = dailyRows.length ? negative / dailyRows.length : 0;

    for (const c of reconciliations) {
        if (c.expectedGrossProfit === null || c.expectedGrossProfit === undefined) continue;
        const expected = Number(c.expectedGrossProfit);
        const actual = Number(c.actualGrossProfit);
        /*
         * 阈值 10%（不是 3%）：
         * 领星「订单利润」的合计包含「当天没销量但有成本」的 ASIN（只发生仓储/头程/退款的日子），
         * 这些行在「产品表现」里没有对应记录，我们按零活动过滤会丢掉，导致毛利合计偏高。
         * 实测 2026-09-17 差 +5.0%，属于已知口径差异；超过 10% 才说明真的映射错了。
         */
        const tolerance = Math.max(1, Math.abs(expected) * 0.1);
        if (Math.abs(actual - expected) > tolerance) {
            warnings.push(
                `${c.date} 毛利合计与领星偏差 ${(((actual - expected) / Math.abs(expected || 1)) * 100).toFixed(1)}%：` +
                    `我算 ${actual.toFixed(2)} vs 领星 ${expected.toFixed(2)}，超过 10% 阈值，请核对成本映射`
            );
        }
    }

    return {
        ok: errors.length === 0,
        errors,
        warnings,
        zeroFiltered,
        costMatchRate: matchRate,
        negativeShare,
        reconciliations,
    };
}

export { SUM_FIELDS, DIM_FIELDS, EMPTY_COST };

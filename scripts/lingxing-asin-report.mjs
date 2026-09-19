/**
 * 领星 → 「ASIN 维度业绩日报」导出（Excel）。
 *
 * 数据来源两张表拼接（用户明确指定的业务口径）：
 *   · 产品表现 query_product_performance_asin_lists —— 销量/流量/广告/评分/库存
 *   · 订单利润 query_order_profit_list              —— 成本结构（采购/头程/FBA/仓储/佣金/退款）
 *
 * 三个已实测确认的关键点：
 *   1. 产品表现默认按「跨店铺」聚合（一行可能含 20 个店铺）→ 必须逐个店铺传 sids 查询。
 *   2. 订单利润没有 sids 参数（传了会静默返回空）→ 用 summary_field='msku'，
 *      MSKU 天然属于单个店铺，实测 100% 单店行；再用 price_list[0].asin 归并到 ASIN。
 *   3. 订单利润的成本字段是负数，而 app 的口径是绝对值 → 统一取绝对值。
 *
 * 用法：
 *   set LINGXING_MCP_KEY=xxx
 *   node scripts/lingxing-asin-report.mjs --date 2026-09-17 --currency USD
 */
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { ROOT } from './scan-palette.mjs';
import { createClient } from './lingxing-client.mjs';

/* ------------------------------------------------------------------ *
 * 参数
 * ------------------------------------------------------------------ */
/**
 * 分页参数类型按工具而异（踩过的坑）：
 *   · query_product_performance_asin_lists → offset/length 是 integer，传数字
 *   · query_order_profit_list              → offset/length 是 string，必须传字符串！
 * 传错类型时网关返回 422「工具参数定义已更新，请刷新工具列表后重新调用」——
 * 这条报错和类型完全无关，极具误导性，别被它带偏去反复刷新工具列表。
 */
const STRING_PAGING_TOOLS = new Set(['query_order_profit_list']);

const args = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(`--${n}`);

const DATE = args('date', '2026-09-17');
const CURRENCY = args('currency', 'USD');
/**
 * 输出目录。默认写到仓库下的 reports/。
 * 用 --out 可以直接写到桌面等任意位置（注意：写到工作区之外需要相应权限）：
 *   node scripts/lingxing-asin-report.mjs --date 2026-09-16 --out "C:\Users\A\Desktop\领星ASIN日报"
 */
const OUT_DIR = args('out', null) ? path.resolve(args('out', null)) : path.join(ROOT, 'reports');
const CACHE_DIR = path.join(ROOT, '.lingxing-probe', 'cache', DATE);
const PAGE = 1000; // 实测可接受的最大页长

/**
 * 头程费用对应哪个字段 —— 领星有两个近义字段，实测值不同（-2.24 vs -2.18）。
 * 默认取 logistics_costs（物流/头程费）。若你确认应为 afn_logistics_costs，改这里即可。
 */
const FIRST_MILE_FIELD = 'logistics_costs';

/**
 * 二级分类：categories[0] 形如 "B-GJ工具\A戒指尺\戒指测量"，取第 2 段。
 * 段内带有排序用的单字母前缀（如 "A戒指尺"），如需去掉把 STRIP_LEVEL_PREFIX 设为 true。
 */
const CATEGORY_LEVEL = 2;
const STRIP_LEVEL_PREFIX = false;

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */
const num = (v) => {
    if (v === null || v === undefined || v === '') return 0;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
};
/** 成本字段取绝对值：领星返回负数，app/报表口径要正数 */
const abs = (v) => Math.abs(num(v));

function categoryLevel2(raw) {
    if (!raw) return '';
    const parts = String(raw).split('\\');
    let seg = parts[CATEGORY_LEVEL - 1] ?? '';
    if (STRIP_LEVEL_PREFIX) seg = seg.replace(/^[A-Za-z]\s*/, '');
    return seg;
}

/**
 * 【品名规则 —— 已与业务确认，勿改】
 *
 * 领星里三个"名字"字段含义完全不同：
 *   · item_name                = Amazon 商品**标题**（英文长标题），**不是品名**
 *   · 顶层 local_name          = 实测**恒为 null**，不可用
 *   · price_list[].local_name  = **品名**（如 "戒指条-黑-放大镜-美规数字-1pcs"）← 要的是这个
 *
 * 一个 ASIN 可能对应多个 MSKU（price_list 多项），各自品名不同。
 * 取 price_list 中 **volume 最大** 的那一项的品名作为该 ASIN 的代表品名；
 * 若该项品名为空，退回第一个非空品名。
 *
 * 实测覆盖率：有活动的行里 99.8%（1107/1109），其余是领星自己就没维护品名。
 * 这种情况**宁可留空，也不要用标题顶替** —— 标题不是品名，混用会让下游
 * 按品名做的分组/透视全部失真。
 */
function productName(row) {
    const pl = row.price_list || [];
    if (pl.length) {
        const best = pl.reduce((a, b) => (num(b?.volume) > num(a?.volume) ? b : a), pl[0]);
        if (best?.local_name) return best.local_name;
        const any = pl.find((p) => p?.local_name);
        if (any) return any.local_name;
    }
    return row.local_name || '';
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(CACHE_DIR, { recursive: true });

const client = createClient({ intervalMs: 1300 });
let calls = 0;
const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

/** 带本地缓存的分页拉取，避免调试时反复打接口 */
async function fetchPaged(toolId, baseParams, cacheKey) {
    const cacheFile = path.join(CACHE_DIR, `${cacheKey}.json`);
    if (!has('no-cache') && fs.existsSync(cacheFile)) {
        return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    }
    const asString = STRING_PAGING_TOOLS.has(toolId);
    const rows = [];
    let offset = 0;
    let total = null;
    let sum = null;
    while (total === null || rows.length < total) {
        const d = await client.call(toolId, {
            ...baseParams,
            offset: asString ? String(offset) : offset,
            length: asString ? String(PAGE) : PAGE,
        });
        calls += 1;
        if (total === null) { total = d.total ?? 0; sum = d.total_sum ?? null; }
        const page = d.list || [];
        rows.push(...page);
        offset += PAGE;
        if (page.length === 0) break;
        if (offset > 200000) break;
    }
    const out = { total, total_sum: sum, list: rows };
    fs.writeFileSync(cacheFile, JSON.stringify(out), 'utf8');
    return out;
}

/* ------------------------------------------------------------------ *
 * 1. 店铺列表
 * ------------------------------------------------------------------ */
log(`开始：日期 ${DATE}，币种 ${CURRENCY}`);
const shopsRaw = await client.call('get_my_sids', null);
calls += 1;
const shops = (shopsRaw.list || []).filter((s) => !s.is_concept);
log(`店铺数 ${shops.length}（已排除概念店铺 ${(shopsRaw.list || []).length - shops.length} 个）`);

/* ------------------------------------------------------------------ *
 * 2. 订单利润（msku 粒度 → 单店铺），归并成 (sid|asin) → 成本
 * ------------------------------------------------------------------ */
log('拉取订单利润（按 MSKU 汇总，会归并到 ASIN）…');
const op = await fetchPaged('query_order_profit_list', {
    start_date: DATE, end_date: DATE, currency_type: CURRENCY, summary_field: 'msku',
    turn_on_summary: '1', sort_type: 'desc', source_service: 'mcp',
    external_service_mark: 1, date_summary_type: 1, search_type: 2, service_type: 1,
}, 'order-profit-msku');
log(`  订单利润 ${op.list.length} 行（total ${op.total}），归并中…`);

/** key = `${sid}|${asin}` → 累加的成本 */
const costMap = new Map();
for (const r of op.list) {
    const pl = (r.price_list || [])[0] || {};
    const asin = pl.asin;
    // 单店行的 sid 取 sids[0]；price_list[0].sid 亦可，二者一致
    const sid = String((r.sids || [])[0] ?? pl.sid ?? '');
    if (!asin || !sid) continue;
    const key = `${sid}|${asin}`;
    const cur = costMap.get(key) || {
        refund_amount: 0, gross_profit: 0,
        first_mile: 0, fba_fee: 0, storage_fee: 0, purchase: 0, commission: 0,
    };
    cur.refund_amount += abs(r.refund_amount);
    cur.gross_profit += num(r.gross_profit);
    cur.first_mile += abs(r[FIRST_MILE_FIELD]);
    cur.fba_fee += abs(r.fulfillment_fee);
    cur.storage_fee += abs(r.fba_storage_fee);
    cur.purchase += abs(r.purchase_costs);
    cur.commission += abs(r.selling_fee);
    costMap.set(key, cur);
}
log(`  成本归并完成：${costMap.size} 个 (店铺,ASIN) 组合`);

/* ------------------------------------------------------------------ *
 * 3. 产品表现（逐店铺，ASIN 粒度）
 * ------------------------------------------------------------------ */
log('拉取产品表现（逐店铺）…');
const ppRows = [];
let done = 0;
let ppMissing = 0;
for (const s of shops) {
    const sid = String(s.id);
    try {
        const d = await fetchPaged('query_product_performance_asin_lists', {
            start_date: DATE, end_date: DATE, date_view_type: 'day', date_view_order_type: 1,
            summary_field: 'asin', turn_on_summary: 1, currency_code: CURRENCY,
            date_range_type: 0, sids: sid,
        }, `pp-${sid}`);
        for (const r of (d.list || [])) ppRows.push({ sid, shop: s, row: r });
    } catch (e) {
        ppMissing += 1;
        log(`  店铺 ${sid} (${s.name}) 失败: ${e.message.slice(0, 100)}`);
    }
    done += 1;
    if (done % 20 === 0) log(`  进度 ${done}/${shops.length}，累计 ${ppRows.length} 行`);
}
log(`产品表现合计 ${ppRows.length} 行，失败店铺 ${ppMissing} 个`);

/* ------------------------------------------------------------------ *
 * 4. 拼接 + 组表（严格按用户给定顺序）
 * ------------------------------------------------------------------ */
const COLUMNS = [
    // 维度
    { h: 'ASIN', get: (x) => x.row.asin, fmt: 'text', w: 14 },
    { h: '父ASIN', get: (x) => (x.row.parent_asins || [])[0]?.parent_asin || x.row.parent_asin || '', fmt: 'text', w: 14 },
    { h: '店铺', get: (x) => (x.row.seller_store_countries || [])[0]?.seller_name || x.shop.name, fmt: 'text', w: 26 },
    { h: '国家', get: (x) => (x.row.seller_store_countries || [])[0]?.country || x.shop.country, fmt: 'text', w: 10 },
    { h: '负责人', get: (x) => (x.row.principal_names || [])[0] || '', fmt: 'text', w: 12 },
    { h: '品名', get: (x) => productName(x.row), fmt: 'text', w: 40 },
    { h: '二级分类', get: (x) => categoryLevel2((x.row.categories || [])[0]), fmt: 'text', w: 16 },
    { h: '品牌', get: (x) => (x.row.brands || [])[0] || '', fmt: 'text', w: 14 },
    // 经营结果
    { h: '销量', get: (x) => num(x.row.volume), fmt: 'int', w: 9 },
    { h: '销售额', get: (x) => num(x.row.amount), fmt: 'money', w: 13 },
    { h: '订单量', get: (x) => num(x.row.order_items), fmt: 'int', w: 9 },
    { h: '退款金额', get: (x) => x.cost.refund_amount, fmt: 'money', w: 12 },
    { h: '评分', get: (x) => num(x.row.avg_star), fmt: 'dec2', w: 8 },
    { h: '评论数', get: (x) => num(x.row.reviews_count), fmt: 'int', w: 10 },
    { h: '订单毛利润', get: (x) => x.cost.gross_profit, fmt: 'money', w: 13 },
    { h: 'FBA-可售', get: (x) => num(x.row.afn_fulfillable_quantity), fmt: 'int', w: 11 },
    // 流量
    { h: 'Sessions-Total', get: (x) => num(x.row.sessions_total), fmt: 'int', w: 15 },
    { h: 'CVR', get: (x) => num(x.row.cvr), fmt: 'pct', w: 9 },
    { h: '销量CVR', get: (x) => num(x.row.volume_cvr), fmt: 'pct', w: 10 },
    // 广告
    { h: '广告花费', get: (x) => num(x.row.spend), fmt: 'money', w: 12 },
    { h: 'SP广告费', get: (x) => num(x.row.ads_sp_cost), fmt: 'money', w: 11 },
    { h: 'SD广告费', get: (x) => num(x.row.ads_sd_cost), fmt: 'money', w: 11 },
    { h: 'SB广告费', get: (x) => num(x.row.shared_ads_sb_cost), fmt: 'money', w: 11 },
    { h: 'SBV广告费', get: (x) => num(x.row.shared_ads_sbv_cost), fmt: 'money', w: 11 },
    { h: '广告销售额', get: (x) => num(x.row.ad_sales_amount), fmt: 'money', w: 13 },
    { h: 'SP广告销售额', get: (x) => num(x.row.ads_sp_sales), fmt: 'money', w: 14 },
    { h: 'SD广告销售额', get: (x) => num(x.row.ads_sd_sales), fmt: 'money', w: 14 },
    { h: 'SB广告销售额', get: (x) => num(x.row.shared_ads_sb_sales), fmt: 'money', w: 14 },
    { h: 'SBV广告销售额', get: (x) => num(x.row.shared_ads_sbv_sales), fmt: 'money', w: 15 },
    { h: '广告订单量', get: (x) => num(x.row.ad_order_quantity), fmt: 'int', w: 11 },
    { h: '展示', get: (x) => num(x.row.impressions), fmt: 'int', w: 11 },
    { h: '点击', get: (x) => num(x.row.clicks), fmt: 'int', w: 9 },
    { h: 'CTR', get: (x) => num(x.row.ctr), fmt: 'pct', w: 9 },
    { h: '广告CVR', get: (x) => num(x.row.ad_cvr), fmt: 'pct', w: 10 },
    { h: 'CPC', get: (x) => num(x.row.cpc), fmt: 'money', w: 9 },
    { h: 'ROAS', get: (x) => num(x.row.roas), fmt: 'dec2', w: 9 },
    { h: 'ACOS', get: (x) => num(x.row.acos), fmt: 'pct', w: 9 },
    { h: 'ACoAS', get: (x) => num(x.row.acoas), fmt: 'pct', w: 9 },
    { h: 'ASoAS', get: (x) => num(x.row.asoas), fmt: 'pct', w: 9 },
    // 自然流量
    { h: '自然点击量', get: (x) => num(x.row.nature_click), fmt: 'int', w: 12 },
    { h: '自然订单量', get: (x) => num(x.row.nature_order_items), fmt: 'int', w: 12 },
    { h: '自然CVR', get: (x) => num(x.row.nature_cvr), fmt: 'pct', w: 11 },
    // 成本（来自订单利润，已取绝对值）
    { h: '头程费用', get: (x) => x.cost.first_mile, fmt: 'money', w: 12 },
    { h: 'FBA费用', get: (x) => x.cost.fba_fee, fmt: 'money', w: 12 },
    { h: '仓储费用', get: (x) => x.cost.storage_fee, fmt: 'money', w: 12 },
    { h: '采购费用', get: (x) => x.cost.purchase, fmt: 'money', w: 12 },
    { h: '佣金费用', get: (x) => x.cost.commission, fmt: 'money', w: 12 },
];

const EMPTY_COST = { refund_amount: 0, gross_profit: 0, first_mile: 0, fba_fee: 0, storage_fee: 0, purchase: 0, commission: 0 };
const records = ppRows.map((x) => {
    const cost = costMap.get(`${x.sid}|${x.row.asin}`) || EMPTY_COST;
    return { ...x, cost, matched: costMap.has(`${x.sid}|${x.row.asin}`) };
});

/**
 * 过滤「零活动」行。
 * 产品表现会返回整个 ASIN 目录（实测当天 45,789 行里只有 1,072 行有活动，97.7% 是零），
 * 全量导出既难读又臃肿。默认只保留当天有任何活动迹象的行；
 * 需要完整目录时加 --include-empty。
 */
const isActive = (r) => ['volume', 'amount', 'order_items', 'impressions', 'clicks', 'spend', 'sessions_total', 'ad_order_quantity']
    .some((k) => num(r.row[k]) !== 0);

const allCount = records.length;
const activeRecords = has('include-empty') ? records : records.filter(isActive);
log(`过滤零活动行：${allCount} → ${activeRecords.length} 行（保留当天有销量的，去掉 ${allCount - activeRecords.length} 行零活动）`);

// 按销售额倒序（报表最常用的看数顺序）
activeRecords.sort((a, b) => num(b.row.amount) - num(a.row.amount));

const matchedCount = activeRecords.filter((r) => r.matched).length;
log(`拼接结果：${activeRecords.length} 行，其中 ${matchedCount} 行匹配到订单利润成本（${(matchedCount / Math.max(1, activeRecords.length) * 100).toFixed(1)}%）`);

/* ------------------------------------------------------------------ *
 * 5. 写 Excel
 * ------------------------------------------------------------------ */
const FMT = {
    text: null,
    int: '#,##0',
    money: '#,##0.00',
    dec2: '0.00',
    pct: '0.00%',
};

log('生成 Excel…');
const wb = new ExcelJS.Workbook();
wb.creator = '亚马逊业绩报告 / 领星 MCP 同步';
const ws = wb.addWorksheet(`ASIN日报 ${DATE}`, {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }],
});

ws.columns = COLUMNS.map((c) => ({ header: c.h, key: c.h, width: c.w }));

// 表头样式
const header = ws.getRow(1);
header.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
header.height = 28;

for (const rec of activeRecords) {
    const row = ws.addRow(COLUMNS.map((c) => c.get(rec)));
    COLUMNS.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        const fmt = FMT[c.fmt];
        if (fmt) cell.numFmt = fmt;
        cell.font = { size: 10 };
        if (['ASIN', '父ASIN', '店铺', '国家', '负责人', '二级分类', '品牌'].includes(c.h)) {
            cell.alignment = { vertical: 'middle', horizontal: 'left' };
        } else {
            cell.alignment = { vertical: 'middle', horizontal: 'right' };
        }
    });
}

// 自动筛选 + 淡边框
ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };

const outFile = path.join(OUT_DIR, `领星ASIN日报_${DATE}_${CURRENCY}.xlsx`);
await wb.xlsx.writeFile(outFile);

/* ------------------------------------------------------------------ *
 * 6. 数据健康告警（很重要：流量未同步时不能默默输出空值）
 * ------------------------------------------------------------------ */
const warn = [];
const sumSessionsTotal = activeRecords.reduce((s, r) => s + num(r.row.sessions_total), 0);
const sumClicks = activeRecords.reduce((s, r) => s + num(r.row.clicks), 0);
const sumAmount = activeRecords.reduce((s, r) => s + num(r.row.amount), 0);
const sumVolume = activeRecords.reduce((s, r) => s + num(r.row.volume), 0);
const negNature = activeRecords.filter((r) => num(r.row.nature_click) < 0).length;

if (sumSessionsTotal === 0 && sumClicks > 0) {
    warn.push(`Sessions-Total 合计为 0（但展示/点击有数据）→ 领星该日期的【流量数据尚未同步】。`
        + `受影响列：Sessions-Total / CVR / 销量CVR / 自然点击量 / 自然CVR。`);
}
if (negNature > 0) {
    warn.push(`有 ${negNature} 行的「自然点击量」为负数 → 是流量缺失时的残差计算结果，同样源于流量未同步。`);
}
if (activeRecords.length - matchedCount > 0) {
    warn.push(`有 ${activeRecords.length - matchedCount} 行没有匹配到订单利润成本（这些行的成本列会是 0）。`);
}

console.log('\n' + '='.repeat(64));
console.log(`已生成：${path.relative(ROOT, outFile)}`);
console.log(`  行数        : ${activeRecords.length}`);
console.log(`  列数        : ${COLUMNS.length}`);
console.log(`  合计销售额  : ${sumAmount.toFixed(2)} ${CURRENCY}`);
console.log(`  合计销量    : ${sumVolume}`);
console.log(`  合计 Sessions-Total : ${sumSessionsTotal}`);
console.log(`  合计点击    : ${sumClicks}`);
console.log(`  接口调用    : ${calls} 次`);
if (warn.length) {
    console.log('\n⚠️  数据健康告警:');
    for (const w of warn) console.log('  · ' + w);
}
console.log('='.repeat(64));

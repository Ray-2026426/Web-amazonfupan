#!/usr/bin/env node
/**
 * 领星 → 看板数据同步（每天定时跑这个）
 *
 * 用法：
 *   node scripts/sync/run.mjs --from 2026-09-16 --to 2026-09-17
 *   node scripts/sync/run.mjs --days 3                      # 从 T-3 到 T-1
 *   node scripts/sync/run.mjs --fixtures --days 1            # 用 .lingxing-probe 里的真实接口快照离线跑
 *   node scripts/sync/run.mjs --days 30 --out data/snapshot  # 首次回补
 *
 * 密钥：环境变量 LINGXING_MCP_KEY（不进仓库、不进浏览器）。--fixtures 模式不需要密钥。
 *
 * 产物（默认写到 data/snapshot/）：
 *   latest.json         —— 前端直接读的快照（daily / monthly / weekly + meta）
 *   manifest.json       —— 已同步过的日期、最近一次同步状态（给前端显示"数据截至日"）
 *   runs/<ts>.json      —— 每次运行的审计日志（调用次数、校验结果、耗时）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '../lingxing-client.mjs';
import {
    aggregateRows,
    extractProductLinks,
    hasMeaningfulCost,
    isActiveRow,
    mergeOrderProfit,
    num,
    toCostOnlyRow,
    toDataRow,
    validateSnapshot,
} from './mapper.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE_ROOT = path.join(ROOT, '.lingxing-probe', 'cache');

/* ------------------------------ 参数 ------------------------------ */
const argv = process.argv;
const arg = (name, fallback = null) => {
    const i = argv.indexOf(`--${name}`);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const CURRENCY = arg('currency', process.env.LINGXING_CURRENCY || 'USD');
const OUT_DIR = path.resolve(arg('out', path.join(ROOT, 'data', 'snapshot')));
const FIXTURES = has('fixtures');
const DRY_RUN = has('dry-run');
/** 补丁模式：只拉订单利润，回填 FBA 国际运费 + 补成本行，不动产品表现 */
const PATCH = has('cost-only');
const UPLOAD = has('upload') || !!process.env.SUPABASE_URL;
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';
const KEEP_ZERO = has('include-zero');
const SHOP_LIMIT = Number(arg('shops-limit', '0')) || 0;
const PAGE = Number(arg('page', '1000')) || 1000;
const CLI_DAYS = Number(arg('days', '0')) || 0;
/** 显式日期列表（补数队列用）：--dates 2026-10-01,2026-10-03 */
const CLI_DATES = String(arg('dates', '') || '').split(',').map((item) => item.trim()).filter(Boolean);

/** 默认同步窗口：T-3 ~ T-1（领星的流量/广告数据有回填延迟，T-1 可能不完整，T-2 已稳定） */
function defaultRange(days) {
    const to = new Date();
    to.setDate(to.getDate() - 1);
    const from = new Date(to);
    from.setDate(from.getDate() - (days - 1));
    return { from: iso(from), to: iso(to) };
}
function iso(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function datesBetween(from, to) {
    const out = [];
    const cur = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    while (cur <= end) {
        out.push(iso(cur));
        cur.setDate(cur.getDate() + 1);
    }
    return out;
}

const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
let calls = 0;
let runContext = null;

/* --------------------------- 取数：MCP --------------------------- */
let client = null;
function getClient() {
    if (!client) client = createClient({ intervalMs: 1300 });
    return client;
}

const STRING_PAGING = new Set(['query_order_profit_list']);

async function fetchPaged(toolId, baseParams) {
    const asString = STRING_PAGING.has(toolId);
    const rows = [];
    let offset = 0;
    let total = null;
    let totalSum = null;
    while (total === null || rows.length < total) {
        const d = await getClient().call(toolId, {
            ...baseParams,
            offset: asString ? String(offset) : offset,
            length: asString ? String(PAGE) : PAGE,
        });
        calls += 1;
        if (total === null) {
            total = d.total ?? 0;
            totalSum = d.total_sum ?? null;
        }
        const page = d.list || [];
        rows.push(...page);
        offset += PAGE;
        if (page.length === 0) break;
        if (offset > 500000) break;
    }
    if (rows.length !== total) throw new Error(`${toolId} 分页不完整：${rows.length}/${total}`);
    return { total, total_sum: totalSum, list: rows };
}

/* ------------------------ 取数：本地快照 ------------------------ */
function readFixture(date, name) {
    const file = path.join(CACHE_ROOT, date, name);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function fixtureShops() {
    const file = path.join(ROOT, '.lingxing-probe', 'shops.json');
    if (!fs.existsSync(file)) throw new Error('缺少 .lingxing-probe/shops.json，无法离线运行');
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return (j.list || j || []).filter((s) => !s.is_concept);
}

/* --------------------------- 上传：Supabase --------------------------- */

const NUMERIC_FIELDS = [
    'sales_quantity', 'order_quantity', 'sales_amount', 'gross_profit', 'fba_sellable_qty', 'sessions',
    'first_mile_cost', 'procurement_cost', 'storage_fee', 'fba_fee', 'refund_cost', 'platform_commission',
    'ad_spend', 'ad_sales', 'ad_orders', 'sp_spend', 'sp_sales', 'sd_spend', 'sd_sales',
    'sb_spend', 'sb_sales', 'sbv_spend', 'sbv_sales', 'impressions', 'clicks',
    'natural_orders', 'natural_clicks', 'rating', 'review_count',
    // FBA 国际运费：已含在头程里，单独存一列供看板「加回毛利」开关使用
    'fba_international_fee',
];
const TEXT_FIELDS = ['country', 'shop_name', 'brand', 'manager', 'sub_category', 'parent_asin', 'product_name'];

/** 只取表里有的列，数值统一成 number（PostgREST 不收 undefined） */
function pickRow(row, extra = {}) {
    const out = { ...extra };
    for (const f of TEXT_FIELDS) out[f] = row[f] ?? '';
    for (const f of NUMERIC_FIELDS) out[f] = Number(row[f] ?? 0);
    return out;
}

async function postgrest(pathname, body, onConflict) {
    const url = `${SUPABASE_URL}/rest/v1/${pathname}${onConflict ? `?on_conflict=${onConflict}` : ''}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            apikey: SUPABASE_KEY,
            ...(SUPABASE_KEY.startsWith('eyJ') ? { Authorization: `Bearer ${SUPABASE_KEY}` } : {}),
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        throw new Error(`Supabase ${pathname} → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
}

async function readControlTable(table) {
    const rows = [];
    for (let offset = 0; offset <= 10000; offset += 1000) {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1000&offset=${offset}`, {
            headers: {
                apikey: SUPABASE_KEY,
                ...(SUPABASE_KEY.startsWith('eyJ') ? { Authorization: `Bearer ${SUPABASE_KEY}` } : {}),
            },
        });
        if (!response.ok) throw new Error(`读取 ${table} 失败：HTTP ${response.status}`);
        const page = await response.json();
        if (!Array.isArray(page)) throw new Error(`读取 ${table} 返回格式错误`);
        rows.push(...page);
        if (page.length < 1000) return rows;
    }
    throw new Error(`${table} 规则超过 10000 条，请先清理`);
}

async function loadControls() {
    if (!SUPABASE_URL || !SUPABASE_KEY) return { settings: { enabled: true, lookback_days: 3 }, fieldMappings: new Map() };
    const [settingsRows, mappingRows] = await Promise.all([
        readControlTable('sync_settings'),
        // 映射表允许不存在（老库还没建表）：读失败就全用默认路径
        readControlTable('field_mappings').catch(() => []),
    ]);
    return {
        settings: settingsRows.find((item) => item.id === 1) || { enabled: true, lookback_days: 3 },
        fieldMappings: new Map(mappingRows.map((r) => [r.web_field, r.lingxing_field])),
    };
}

async function uploadToSupabase({ dailyRows, currency, startedAt, range, dates, report }) {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
        log('未配置 SUPABASE_URL / SUPABASE_SECRET_KEY，跳过上传（只写本地文件）');
        return false;
    }
    log(`上传 Supabase：日明细 ${dailyRows.length} 行，按天原子替换`);

    const dailyPayload = dailyRows.map((r) => pickRow(r, { date: r.date, sid: r.sid, asin: r.asin, currency }));

    for (const date of dates) {
        const dayRows = dailyPayload.filter((row) => row.date === date);
        if (dayRows.length === 0) throw new Error(`${date} 没有可发布的日明细，已停止上传，保留数据库旧数据`);
        await postgrest('rpc/replace_fact_daily', { p_date: date, p_currency: currency, p_rows: dayRows });
        log(`  ${date} 已原子替换 ${dayRows.length} 行`);
    }

    await postgrest('sync_runs', [
        {
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            range_from: range.from,
            range_to: range.to,
            status: 'ok',
            rows_daily: dailyRows.length,
            rows_period: 0,
            cost_match_rate: Number(report.costMatchRate.toFixed(3)),
            mcp_calls: calls,
            duration_ms: Date.now() - Date.parse(startedAt),
            warnings: report.warnings,
        },
    ]);
    log('Supabase 上传完成');
    return true;
}

/* --------------------------- 主流程 --------------------------- */
/** 对账结果 → daily_checks 行（差异率保留 4 位小数） */
function reconciliationRows(list) {
    return (list || [])
        .filter((item) => item.expectedGrossProfit !== null && item.expectedGrossProfit !== undefined)
        .map((item) => ({
            date: item.date,
            expected_gross_profit: Number(item.expectedGrossProfit),
            actual_gross_profit: Number(item.actualGrossProfit),
            diff_ratio: Number(item.expectedGrossProfit) === 0
                ? null
                : Number(((Number(item.actualGrossProfit) - Number(item.expectedGrossProfit)) / Math.abs(Number(item.expectedGrossProfit))).toFixed(4)),
            checked_at: new Date().toISOString(),
        }));
}

async function saveDailyChecks(list) {
    if (!SUPABASE_URL || !SUPABASE_KEY) return;
    const rows = reconciliationRows(list);
    if (!rows.length) return;
    await postgrest('daily_checks', rows, 'date');
    log(`已写入 ${rows.length} 天对账结果（daily_checks）`);
}

/**
 * MSKU ↔ ASIN 对照落库。
 * 用途：用户的商品图片表是按本地 SKU 导出的，看板的行是按 ASIN 组织的，
 * 存下这张对照表就能在上传图片时自动把 SKU 翻译成 ASIN。
 */
async function saveProductLinks(linkMap) {
    if (!SUPABASE_URL || !SUPABASE_KEY || !linkMap || !linkMap.size) return;
    const rows = [...linkMap.values()].map((item) => ({ ...item, updated_at: new Date().toISOString() }));
    for (let i = 0; i < rows.length; i += 500) {
        await postgrest('product_links', rows.slice(i, i + 500), 'msku,asin')
            .catch((error) => log(`⚠ 写入 SKU↔ASIN 对照失败：${String(error.message || error)}`));
    }
    log(`已写入 ${rows.length} 条 SKU↔ASIN 对照（product_links）`);
}

/**
 * 补丁模式（--cost-only）：
 * 只重拉「订单利润」，把两件事补进已有数据，不动产品表现（省 80% 时间）：
 *   1. 回填 fba_international_fee（FBA 国际运费），供看板「毛利修正」开关使用
 *   2. 补上「只有成本、当天无销量」的 ASIN 行，修正毛利偏高
 * 逐日「读出当天整行 → 改完 → 原子替换」，失败只影响当天。
 */
async function readFactDaily(date) {
    const rows = [];
    for (let offset = 0; offset < 20000; offset += 1000) {
        const url = `${SUPABASE_URL}/rest/v1/fact_daily?select=*&date=eq.${date}&currency=eq.${CURRENCY}&limit=1000&offset=${offset}`;
        const res = await fetch(url, {
            headers: {
                apikey: SUPABASE_KEY,
                ...(SUPABASE_KEY.startsWith('eyJ') ? { Authorization: `Bearer ${SUPABASE_KEY}` } : {}),
            },
        });
        if (!res.ok) throw new Error(`读取 ${date} 失败：HTTP ${res.status}`);
        const page = await res.json();
        rows.push(...page);
        if (page.length < 1000) break;
    }
    return rows;
}

async function runPatch({ dates, usedShops, startedAt, range }) {
    if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('补丁模式需要 SUPABASE_URL / SUPABASE_SECRET_KEY');
    const shopById = new Map(usedShops.map((shop) => [String(shop.id), shop]));
    let patchedDays = 0;
    let patchedRows = 0;
    let addedCostRows = 0;
    let skippedDays = 0;
    const failures = [];
    const checks = [];
    const links = new Map();

    for (const date of dates) {
        try {
            const existing = await readFactDaily(date);
            if (!existing.length) {
                skippedDays += 1;
                log(`${date} 云端还没有数据，跳过（先用回补任务把这天补上）`);
                continue;
            }
            const op = await fetchPaged('query_order_profit_list', {
                start_date: date,
                end_date: date,
                currency_type: CURRENCY,
                summary_field: 'msku',
                turn_on_summary: '1',
                sort_type: 'desc',
                source_service: 'mcp',
                external_service_mark: 1,
                date_summary_type: 1,
                search_type: 2,
                service_type: 1,
            });
            const costMap = mergeOrderProfit(op.list);
            for (const [key, value] of extractProductLinks(op.list)) links.set(key, value);
            const present = new Set(existing.map((row) => `${row.sid}|${row.asin}`));

            const rows = existing.map((row) => {
                const cost = costMap.get(`${row.sid}|${row.asin}`);
                return { ...row, fba_international_fee: cost ? abs(cost.fba_international_inbound_fee) : 0 };
            });
            let added = 0;
            for (const [key, cost] of costMap) {
                if (present.has(key) || !hasMeaningfulCost(cost)) continue;
                const [sid, asin] = key.split('|');
                const shop = shopById.get(sid);
                if (!shop || !asin) continue;
                rows.push(toCostOnlyRow({ shop, asin, cost, date }));
                added += 1;
            }

            const expected = op.total_sum ? num(op.total_sum.gross_profit) : null;
            const actual = rows.reduce((sum, row) => sum + num(row.gross_profit), 0);
            await postgrest('rpc/replace_fact_daily', {
                p_date: date,
                p_currency: CURRENCY,
                p_rows: rows.map((row) => pickRow(row, { date, sid: row.sid, asin: row.asin, currency: CURRENCY })),
            });
            patchedDays += 1;
            patchedRows += rows.length;
            addedCostRows += added;
            checks.push({ date, expectedGrossProfit: expected, actualGrossProfit: actual });
            log(
                `${date} 补丁完成 ${existing.length} → ${rows.length} 行（新增成本行 ${added}），毛利 ${actual.toFixed(2)}` +
                    `${expected === null ? '' : ` vs 领星 ${expected.toFixed(2)}`}`
            );
        } catch (error) {
            failures.push(`${date}: ${error.message.slice(0, 120)}`);
            log(`✗ ${date} 补丁失败：${error.message.slice(0, 160)}`);
        }
    }

    await saveDailyChecks(checks).catch((error) => log(`⚠ 对账结果写入失败：${String(error.message || error)}`));
    await saveProductLinks(links);

    await postgrest('sync_runs', [{
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        range_from: range.from,
        range_to: range.to,
        status: failures.length ? 'failed' : 'ok',
        rows_daily: patchedRows,
        rows_period: 0,
        cost_match_rate: null,
        mcp_calls: calls,
        duration_ms: Date.now() - Date.parse(startedAt),
        warnings: [
            `补丁模式：${patchedDays} 天已修正，新增成本行 ${addedCostRows}，跳过 ${skippedDays} 天`,
            ...failures.slice(0, 50),
        ],
    }]);

    log(`补丁汇总：${patchedDays} 天修正、${patchedRows} 行、新增成本行 ${addedCostRows}、跳过 ${skippedDays} 天、失败 ${failures.length} 天`);
    if (failures.length) throw new Error(`${failures.length} 天补丁失败：${failures.slice(0, 5).join('；')}`);
}

async function main() {
    const startedAt = new Date().toISOString();
    const controls = FIXTURES ? { settings: { enabled: true, lookback_days: 3 }, fieldMappings: new Map() } : await loadControls();
    const explicitRange = arg('from') && arg('to');
    if (!controls.settings.enabled && !explicitRange && !CLI_DAYS && !CLI_DATES.length) {
        log('管理后台已暂停自动同步，本次定时任务跳过');
        return;
    }
    const range = CLI_DATES.length
        ? { from: CLI_DATES.slice().sort()[0], to: CLI_DATES.slice().sort().slice(-1)[0] }
        : explicitRange ? { from: arg('from'), to: arg('to') } : defaultRange(CLI_DAYS || controls.settings.lookback_days || 3);
    const dates = CLI_DATES.length ? [...new Set(CLI_DATES)].sort() : datesBetween(range.from, range.to);
    if (!dates.length || dates.length > (PATCH ? 400 : 90)) throw new Error(`同步日期范围必须是 1–${PATCH ? 400 : 90} 天`);
    runContext = { startedAt, range };
    log(`范围 ${range.from} ~ ${range.to}（${dates.length} 天${CLI_DATES.length ? '，按指定日期列表' : ''}），币种 ${CURRENCY}${FIXTURES ? '，离线模式' : ''}${PATCH ? '，补丁模式（只回填运费与成本行）' : ''}`);

    const shops = FIXTURES ? fixtureShops() : (await getClient().call('get_my_sids', null)).list || [];
    const activeShops = shops.filter((s) => !s.is_concept);
    const usedShops = SHOP_LIMIT > 0 ? activeShops.slice(0, SHOP_LIMIT) : activeShops;
    log(`店铺 ${usedShops.length} 个（总计 ${shops.length}，概念店铺已排除 ${shops.length - activeShops.length}）`);

    if (PATCH) {
        await runPatch({ dates, usedShops, startedAt, range });
        return;
    }

    const allRows = [];
    let rawPPRows = 0;
    let failedShopCalls = 0;
    const costByDate = new Map();
    /** MSKU ↔ ASIN 对照（供商品图片表按本地 SKU 匹配） */
    const productLinks = new Map();
    /** 每天拿「我算的毛利合计」和「领星自己返回的 total_sum」对账 */
    const reconciliations = [];

    for (const date of dates) {
        // 1) 订单利润 → 成本
        let op;
        if (FIXTURES) {
            op = readFixture(date, 'order-profit-msku.json') || { list: [] };
        } else {
            op = await fetchPaged('query_order_profit_list', {
                start_date: date,
                end_date: date,
                currency_type: CURRENCY,
                summary_field: 'msku',
                turn_on_summary: '1',
                sort_type: 'desc',
                source_service: 'mcp',
                external_service_mark: 1,
                date_summary_type: 1,
                search_type: 2,
                service_type: 1,
            });
        }
        const costMap = mergeOrderProfit(op.list);
        for (const [key, value] of extractProductLinks(op.list)) productLinks.set(key, value);
        costByDate.set(date, costMap);
        const expectedGrossProfit = op.total_sum ? num(op.total_sum.gross_profit) : null;
        const expectedAmount = op.total_sum ? num(op.total_sum.amount) : null;
        log(`${date} 订单利润 ${op.list.length} 行 → ${costMap.size} 个 (店铺,ASIN) 成本`);
        const rowsBefore = allRows.length;

        // 2) 产品表现（逐店铺）
        let done = 0;
        for (const shop of usedShops) {
            const sid = String(shop.id);
            let payload;
            if (FIXTURES) {
                payload = readFixture(date, `pp-${sid}.json`) || { list: [] };
            } else {
                try {
                    payload = await fetchPaged('query_product_performance_asin_lists', {
                        start_date: date,
                        end_date: date,
                        date_view_type: 'day',
                        date_view_order_type: 1,
                        summary_field: 'asin',
                        turn_on_summary: 1,
                        currency_code: CURRENCY,
                        date_range_type: 0,
                        sids: sid,
                    });
                } catch (e) {
                    failedShopCalls += 1;
                    log(`  ${date} 店铺 ${sid} 失败：${e.message.slice(0, 120)}`);
                    continue;
                }
            }
            rawPPRows += (payload.list || []).length;
            if (payload.total_sum?.amount !== undefined) {
                const amount = (payload.list || []).reduce((sum, row) => sum + num(row.amount), 0);
                const expectedAmount = num(payload.total_sum.amount);
                /*
                 * 容差 0.05 元对「单店整天上千行」太严：
                 * 每行金额保留两位小数，上千行累加后的舍入漂移就可能超过 5 分钱（实测踩过一次）。
                 * 改成「绝对 5 分钱 或 千分之二」取大者——丢一页数据通常是几个百分点，仍能拦住。
                 */
                const tolerance = Math.max(0.05, Math.abs(expectedAmount) * 0.002);
                if (Math.abs(amount - expectedAmount) > tolerance) {
                    throw new Error(`${date} 店铺 ${sid} 销售额与领星汇总不一致：明细 ${amount.toFixed(2)} vs 汇总 ${expectedAmount.toFixed(2)}`);
                }
            }
            if (payload.total_sum?.volume !== undefined) {
                const volume = (payload.list || []).reduce((sum, row) => sum + num(row.volume), 0);
                if (volume !== num(payload.total_sum.volume)) throw new Error(`${date} 店铺 ${sid} 销量与领星汇总不一致`);
            }
            for (const row of payload.list || []) {
                if (!KEEP_ZERO && !isActiveRow(row)) continue;
                allRows.push(
                    toDataRow({
                        shop,
                        row,
                        cost: costMap.get(`${sid}|${row.asin}`),
                        date,
                        fieldMap: controls.fieldMappings,
                    })
                );
            }
            done += 1;
            if (done % 20 === 0) log(`  ${date} 进度 ${done}/${usedShops.length}，累计 ${allRows.length} 行`);
        }
        // 2.5) 补「只有成本、当天无销量」的 ASIN
        // 产品表现里没有这些行（没销量就没记录），丢掉会让日毛利偏高（实测 1~18%）。
        // 补成「有成本、无销量」的行后，日合计才能和领星订单利润对上。
        const usedKeys = new Set();
        for (let index = rowsBefore; index < allRows.length; index += 1) {
            usedKeys.add(`${allRows[index].sid}|${allRows[index].asin}`);
        }
        const shopById = new Map(usedShops.map((shop) => [String(shop.id), shop]));
        const opMeta = new Map();
        for (const row of op.list || []) {
            const price = (row.price_list || [])[0] || {};
            const sid = String((row.sids || [])[0] ?? price.sid ?? '');
            if (!sid || !price.asin) continue;
            const key = `${sid}|${price.asin}`;
            if (!opMeta.has(key)) opMeta.set(key, { product_name: price.local_name || '' });
        }
        let costOnlyAdded = 0;
        for (const [key, cost] of costMap) {
            if (usedKeys.has(key) || !hasMeaningfulCost(cost)) continue;
            const [sid, asin] = key.split('|');
            if (!sid || !asin) continue;
            const shop = shopById.get(sid);
            if (!shop) continue;
            allRows.push(toCostOnlyRow({ shop, asin, cost, date, meta: opMeta.get(key) }));
            costOnlyAdded += 1;
        }
        if (costOnlyAdded) log(`${date} 补入 ${costOnlyAdded} 行「只有成本、无销量」的 ASIN`);

        log(`${date} 完成，累计 ${allRows.length} 行`);

        // 当日对账：与领星自己的合计比较（而不是看「负毛利行占比」，那个会误报）
        const dateRows = allRows.slice(rowsBefore);
        const actualGrossProfit = dateRows.reduce((sum, r) => sum + num(r.gross_profit), 0);
        const actualAmount = dateRows.reduce((sum, r) => sum + num(r.sales_amount), 0);
        reconciliations.push({ date, expectedGrossProfit, actualGrossProfit, expectedAmount, actualAmount });
        if (expectedGrossProfit !== null) {
            const diff = actualGrossProfit - expectedGrossProfit;
            const pct = expectedGrossProfit !== 0 ? (diff / Math.abs(expectedGrossProfit)) * 100 : 0;
            log(
                `${date} 对账：毛利 ${actualGrossProfit.toFixed(2)} vs 领星 ${expectedGrossProfit.toFixed(2)}` +
                    `（差 ${diff.toFixed(2)}，${pct.toFixed(1)}%）；销售额 ${actualAmount.toFixed(2)} vs ${expectedAmount === null ? 'n/a' : expectedAmount.toFixed(2)}`
            );
        }
    }

    // 3) 校验（失败即中止，不写半份数据）
    const report = validateSnapshot({
        dailyRows: allRows,
        rawPPRows,
        shops: usedShops,
        dates,
        currency: CURRENCY,
        failedShopCalls,
        reconciliations,
    });
    report.warnings.forEach((w) => log(`⚠ ${w}`));
    if (!report.ok) {
        report.errors.forEach((e) => log(`✗ ${e}`));
        throw new Error(`校验失败：${report.errors.join('；')}`);
    }

    // 4) 聚合
    const monthly = aggregateRows(allRows, 'month').rows;
    const weekly = aggregateRows(allRows, 'week').rows;
    const shopSet = new Set(allRows.map((r) => `${r.country}|${r.shop_name}`));
    const snapshot = {
        version: 1,
        generatedAt: new Date().toISOString(),
        source: 'lingxing-mcp',
        range,
        currency: CURRENCY,
        meta: {
            dataStartDate: dates[0],
            dataEndDate: dates[dates.length - 1],
            shops: shopSet.size,
            dailyRows: allRows.length,
            monthlyRows: monthly.length,
            weeklyRows: weekly.length,
            costMatchRate: Number(report.costMatchRate.toFixed(3)),
            filteredZeroRows: report.zeroFiltered,
            failedShopCalls,
            /** 负毛利行占比：仅作参考（领星按 MSKU/天 粒度会因一次性成本出现大量负值，不代表错） */
            negativeRowShare: Number((report.negativeShare || 0).toFixed(3)),
            /** 与领星 total_sum 的对账结果，跑完可在 manifest.json 里核对 */
            reconciliations: (report.reconciliations || []).map((c) => ({
                date: c.date,
                grossProfitMine: Number(Number(c.actualGrossProfit).toFixed(2)),
                grossProfitLingxing: c.expectedGrossProfit === null ? null : Number(Number(c.expectedGrossProfit).toFixed(2)),
                salesMine: Number(Number(c.actualAmount).toFixed(2)),
                salesLingxing: c.expectedAmount === null ? null : Number(Number(c.expectedAmount).toFixed(2)),
            })),
        },
        daily: allRows,
        monthly,
        weekly,
    };

    const sizeMB = (Buffer.byteLength(JSON.stringify(snapshot)) / 1024 / 1024).toFixed(2);
    log(`产物：日 ${allRows.length} 行 / 月 ${monthly.length} 行 / 周 ${weekly.length} 行，约 ${sizeMB} MB`);

    if (DRY_RUN) {
        log('--dry-run：不写文件');
        return { snapshot, report, sizeMB };
    }

    // 5) 落盘
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const runsDir = path.join(OUT_DIR, 'runs');
    fs.mkdirSync(runsDir, { recursive: true });

    const latestFile = path.join(OUT_DIR, 'latest.json');
    const prev = fs.existsSync(latestFile) ? JSON.parse(fs.readFileSync(latestFile, 'utf8')) : null;

    // 合并历史：按 (date|sid|asin) 去重，新数据覆盖旧数据
    const merged = new Map();
    for (const r of prev?.daily || []) merged.set(r.id, r);
    for (const r of allRows) merged.set(r.id, r);
    const dailyAll = [...merged.values()].sort((a, b) => (a.date < b.date ? -1 : 1));

    const mergedSnapshot = {
        ...snapshot,
        meta: {
            ...snapshot.meta,
            dataStartDate: dailyAll[0]?.date || snapshot.meta.dataStartDate,
            dataEndDate: dailyAll[dailyAll.length - 1]?.date || snapshot.meta.dataEndDate,
            dailyRows: dailyAll.length,
        },
        daily: dailyAll,
        monthly: aggregateRows(dailyAll, 'month').rows,
        weekly: aggregateRows(dailyAll, 'week').rows,
    };

    fs.writeFileSync(latestFile, JSON.stringify(mergedSnapshot));
    const mergedSizeMB = (fs.statSync(latestFile).size / 1024 / 1024).toFixed(2);

    const manifestFile = path.join(OUT_DIR, 'manifest.json');
    const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : { dates: [] };
    manifest.dates = [...new Set([...(manifest.dates || []), ...dates])].sort();
    manifest.lastRun = {
        at: snapshot.generatedAt,
        range,
        days: dates.length,
        rowsAdded: allRows.length,
        rowsTotal: dailyAll.length,
        bytes: fs.statSync(latestFile).size,
        costMatchRate: snapshot.meta.costMatchRate,
        failedShopCalls,
        warnings: report.warnings,
        mcpCalls: calls,
        durationMs: Date.now() - Date.parse(startedAt),
    };
    manifest.currency = CURRENCY;
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));

    fs.writeFileSync(
        path.join(runsDir, `${startedAt.replace(/[:.]/g, '-')}.json`),
        JSON.stringify({ ...manifest.lastRun, range, currency: CURRENCY, report }, null, 2)
    );

    log(`已写入 ${path.relative(ROOT, latestFile)}（累加后 ${mergedSizeMB} MB，共 ${dailyAll.length} 行）`);
    log(`已写入 ${path.relative(ROOT, manifestFile)}（已同步日期 ${manifest.dates.length} 天）`);

    // 6) 可选：上传数据库（云端定时任务用这个路径读数据）
    if (UPLOAD) {
        await uploadToSupabase({
            dailyRows: allRows,
            currency: CURRENCY,
            startedAt,
            range,
            dates,
            report,
        });
        // 每日对账结果单独落库，数据质量页据此标出「与领星差异过大」的日期
        await saveDailyChecks(reconciliations).catch((error) => log(`⚠ 对账结果写入失败：${String(error.message || error)}`));
        await saveProductLinks(productLinks);
    }

    return { snapshot: mergedSnapshot, report };
}

main().catch(async (e) => {
    console.error(`✗ 同步失败：${e.message}`);
    if (!FIXTURES && runContext && SUPABASE_URL && SUPABASE_KEY) {
        try {
            await postgrest('sync_runs', [{
                started_at: runContext.startedAt,
                finished_at: new Date().toISOString(),
                range_from: runContext.range.from,
                range_to: runContext.range.to,
                status: 'failed',
                mcp_calls: calls,
                duration_ms: Date.now() - Date.parse(runContext.startedAt),
                error: String(e.message).slice(0, 300),
            }]);
        } catch (writeError) {
            console.error(`✗ 写入失败记录也失败：${writeError.message}`);
        }
    }
    process.exit(1);
});

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
    isActiveRow,
    mergeOrderProfit,
    num,
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
const UPLOAD = has('upload') || !!process.env.SUPABASE_URL;
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';
const KEEP_ZERO = has('include-zero');
const SHOP_LIMIT = Number(arg('shops-limit', '0')) || 0;
const PAGE = Number(arg('page', '1000')) || 1000;
const CLI_DAYS = Number(arg('days', '0')) || 0;

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
    if (!SUPABASE_URL || !SUPABASE_KEY) return { settings: { enabled: true, lookback_days: 3 }, asinRules: new Map(), productOverrides: new Map() };
    const [settingsRows, costRows, productRows] = await Promise.all([
        readControlTable('sync_settings'),
        readControlTable('cost_asin_rules'),
        readControlTable('product_overrides'),
    ]);
    return {
        settings: settingsRows.find((item) => item.id === 1) || { enabled: true, lookback_days: 3 },
        asinRules: new Map(costRows.map((r) => [`${r.sid}|${r.local_sku}`, r.asin])),
        productOverrides: new Map(productRows.map((r) => [`${r.sid}|${r.asin}`, r])),
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
async function main() {
    const startedAt = new Date().toISOString();
    const controls = FIXTURES ? { settings: { enabled: true, lookback_days: 3 }, asinRules: new Map(), productOverrides: new Map() } : await loadControls();
    const explicitRange = arg('from') && arg('to');
    if (!controls.settings.enabled && !explicitRange && !CLI_DAYS) {
        log('管理后台已暂停自动同步，本次定时任务跳过');
        return;
    }
    const range = explicitRange ? { from: arg('from'), to: arg('to') } : defaultRange(CLI_DAYS || controls.settings.lookback_days || 3);
    const dates = datesBetween(range.from, range.to);
    if (!dates.length || dates.length > 90) throw new Error('同步日期范围必须是 1–90 天');
    runContext = { startedAt, range };
    log(`范围 ${range.from} ~ ${range.to}（${dates.length} 天），币种 ${CURRENCY}${FIXTURES ? '，离线模式' : ''}`);

    const shops = FIXTURES ? fixtureShops() : (await getClient().call('get_my_sids', null)).list || [];
    const activeShops = shops.filter((s) => !s.is_concept);
    const usedShops = SHOP_LIMIT > 0 ? activeShops.slice(0, SHOP_LIMIT) : activeShops;
    log(`店铺 ${usedShops.length} 个（总计 ${shops.length}，概念店铺已排除 ${shops.length - activeShops.length}）`);

    const allRows = [];
    let rawPPRows = 0;
    let failedShopCalls = 0;
    const costByDate = new Map();
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
        const costMap = mergeOrderProfit(op.list, { asinRules: controls.asinRules });
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
                if (Math.abs(amount - num(payload.total_sum.amount)) > 0.05) {
                    throw new Error(`${date} 店铺 ${sid} 销售额与领星汇总不一致`);
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
                        override: controls.productOverrides.get(`${sid}|${row.asin}`),
                    })
                );
            }
            done += 1;
            if (done % 20 === 0) log(`  ${date} 进度 ${done}/${usedShops.length}，累计 ${allRows.length} 行`);
        }
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

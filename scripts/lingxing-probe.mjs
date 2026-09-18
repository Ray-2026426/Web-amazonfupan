/**
 * 领星 MCP 连通性探针。
 *
 * 目的：在写任何数据管道之前，先回答三个问题 ——
 *   1. MCP 能不能连上、鉴权是否通过（X-Mcp-Key）
 *   2. 你这个帐号到底能看到哪些 Tool（权限与套餐相关）
 *   3. 某个 Tool 实际返回的 JSON 长什么样（字段名、时区、分页、是否被截断）
 *
 * 只有第 3 点拿到真实样本，字段映射才能写对。所以这个脚本的产出是
 * 「原始 JSON」，不做任何解释和加工。
 *
 * 用法：
 *   set LINGXING_MCP_KEY=<你的鉴权密钥>
 *   node scripts/lingxing-probe.mjs --list
 *   node scripts/lingxing-probe.mjs --schema query_product_performance_asin_lists
 *   node scripts/lingxing-probe.mjs --call get_my_sids
 *   node scripts/lingxing-probe.mjs --call ad_campaign_report --args "{\"sid\":123,\"startDate\":\"2026-01-01\",\"endDate\":\"2026-01-02\"}"
 *
 * 注意：本脚本用 Node 原生 fetch 手写了 MCP 的 Streamable HTTP 客户端
 * （initialize → notifications/initialized → tools/list → tools/call），
 * 不依赖 @modelcontextprotocol/sdk。同时兼容 JSON 与 SSE 两种响应体。
 * 领星侧 QPS = 1，脚本已内置请求间隔。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './scan-palette.mjs';

const DEFAULT_URL = 'https://openmcp.lingxing.com/mcp-servers/lingxing-mcp';
/** MCP 协议版本；服务端若不支持会在 initialize 响应里回它自己的版本 */
const PROTOCOL_VERSION = '2025-06-18';
/** 领星限制 QPS=1，两次请求之间至少间隔这么久 */
const MIN_INTERVAL_MS = 1200;

const arg = (n, d = null) => {
    const i = process.argv.indexOf(`--${n}`);
    return i !== -1 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : d;
};
const has = (n) => process.argv.includes(`--${n}`);

const url = arg('url') || process.env.LINGXING_MCP_URL || DEFAULT_URL;
const key = process.env.LINGXING_MCP_KEY;

if (!key) {
    console.error('缺少鉴权密钥。请设置环境变量 LINGXING_MCP_KEY（领星 ERP → AI助手 → 管理MCP → 复制鉴权密钥）。');
    process.exit(2);
}

let sessionId = null;
let lastCall = 0;

/** 遵守 QPS=1 */
async function throttle() {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastCall);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
}

/**
 * 从响应体里取出 JSON-RPC 结果。
 * Streamable HTTP 允许服务端回 `application/json` 或 `text/event-stream`（SSE）。
 */
function parseBody(text, contentType) {
    if (contentType && contentType.includes('text/event-stream')) {
        // SSE：逐行找 `data: {...}`，取最后一条带 result 的消息
        const payloads = [];
        for (const line of text.split(/\r?\n/)) {
            const m = line.match(/^data:\s*(.+)$/);
            if (m) {
                try {
                    payloads.push(JSON.parse(m[1]));
                } catch { /* 忽略非 JSON 的 data 行 */ }
            }
        }
        const withResult = payloads.filter((p) => p && (p.result !== undefined || p.error !== undefined));
        return withResult.length ? withResult[withResult.length - 1] : null;
    }
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

async function rpc(method, params, { notification = false } = {}) {
    await throttle();
    const body = {
        jsonrpc: '2.0',
        method,
        ...(params !== undefined ? { params } : {}),
        ...(notification ? {} : { id: Date.now() }),
    };
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            // MCP 规范要求客户端同时接受这两种
            Accept: 'application/json, text/event-stream',
            'X-Mcp-Key': key,
            ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
        },
        body: JSON.stringify(body),
    });

    const sid = res.headers.get('mcp-session-id');
    if (sid) sessionId = sid;

    const text = await res.text();

    if (!res.ok) {
        throw new Error(`${method} → HTTP ${res.status}\n${text.slice(0, 800)}`);
    }
    if (notification) return null; // 通知类请求通常 202 无响应体

    const parsed = parseBody(text, res.headers.get('content-type'));
    if (!parsed) {
        throw new Error(`${method} → 无法解析响应（content-type: ${res.headers.get('content-type')}）\n${text.slice(0, 800)}`);
    }
    if (parsed.error) {
        throw new Error(`${method} → JSON-RPC 错误 ${JSON.stringify(parsed.error)}`);
    }
    return parsed.result;
}

/* ------------------------------------------------------------------ */
console.log(`连接 ${url}\n`);

const init = await rpc('initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'dsh-lingxing-probe', version: '1.0.0' },
});
console.log('initialize OK');
console.log('  服务端        :', init?.serverInfo ? `${init.serverInfo.name} v${init.serverInfo.version}` : '(未提供)');
console.log('  协议版本      :', init?.protocolVersion || '(未提供)');
console.log('  会话 ID       :', sessionId || '(未返回，可能不需要)');
console.log('  能力          :', Object.keys(init?.capabilities || {}).join(', ') || '(无)');

// 按规范，initialize 之后必须发一条 initialized 通知
await rpc('notifications/initialized', undefined, { notification: true });

const tools = (await rpc('tools/list', {})).tools || [];
console.log(`\n可见 Tool 共 ${tools.length} 个`);

const outDir = path.join(ROOT, '.lingxing-probe');
fs.mkdirSync(outDir, { recursive: true });

// 把工具清单落盘，便于后续和 app 的 7 个上传槽位做映射
const indexFile = path.join(outDir, 'tools.json');
fs.writeFileSync(indexFile, JSON.stringify(tools, null, 2), 'utf8');
console.log(`工具清单已写入 ${path.relative(ROOT, indexFile)}`);

if (has('list') || process.argv.length <= 2) {
    console.log('');
    for (const t of tools) console.log(`  ${t.name}`);
}

if (arg('schema')) {
    const name = arg('schema');
    const t = tools.find((x) => x.name === name);
    if (!t) {
        console.error(`\n没有名为 ${name} 的 Tool。用 --list 看看有哪些。`);
        process.exit(1);
    }
    console.log(`\n=== ${t.name} ===`);
    console.log('说明:', t.description || '(无)');
    console.log('入参 schema:');
    console.log(JSON.stringify(t.inputSchema, null, 2));
}

/**
 * 业务返回的统一拆包。
 * 注意：领星把业务错误放在「成功的 JSON-RPC 响应」里，
 * 成功是 code:1，失败是 code:102/429 等且 success:false。
 * 绝不能只看 isError。
 */
function unwrapBusiness(result) {
    const text = (result?.content || []).find((c) => c.type === 'text')?.text;
    if (!text) return { ok: false, raw: result, reason: '返回里没有 text 内容' };
    let j;
    try {
        j = JSON.parse(text);
    } catch {
        return { ok: false, raw: text, reason: '返回的 text 不是合法 JSON' };
    }
    const ok = j.code === 1 || (j.success === true && j.code !== 102);
    return { ok, code: j.code, msg: j.msg, data: j.data, raw: j, reason: ok ? null : `code=${j.code} ${j.msg || ''}` };
}

if (has('catalog')) {
    console.log('\n=== 拉取完整业务工具目录 ===');
    const PAGE = 50; // 官方上限 50
    const all = [];
    let offset = 0;
    let total = null;
    while (total === null || all.length < total) {
        const res = await rpc('tools/call', { name: 'help', arguments: { limit: PAGE, offset } });
        const b = unwrapBusiness(res);
        if (!b.ok) throw new Error(`help 分页失败 (offset=${offset}): ${b.reason}`);
        total = b.data.total;
        all.push(...(b.data.tools || []));
        offset += PAGE;
        if (offset > 2000) break; // 保险丝
    }
    console.log(`  共 ${all.length} / ${total} 个业务工具`);

    const byType = {};
    for (const t of all) byType[t.toolType] = (byType[t.toolType] || 0) + 1;
    console.log('  类型分布:', JSON.stringify(byType));

    const catalogFile = path.join(outDir, 'catalog.json');
    fs.writeFileSync(catalogFile, JSON.stringify(all, null, 2), 'utf8');

    // 同时给一份人类可读的清单，方便按关键词找工具
    const lines = all.map((t) => `${t.toolType}\t${t.toolId}\t${t.displayName}`);
    fs.writeFileSync(path.join(outDir, 'catalog.tsv'), lines.join('\n'), 'utf8');

    console.log(`  已写入 ${path.relative(ROOT, catalogFile)} 与 catalog.tsv`);

    // 按关键词过滤（--grep 利润 / --grep 产品表现 ...）
    const grep = arg('grep');
    if (grep && grep !== true) {
        const hit = all.filter((t) => (t.toolId + ' ' + t.displayName + ' ' + (t.description || '')).includes(grep));
        console.log(`\n  含「${grep}」的工具 ${hit.length} 个:`);
        for (const t of hit) console.log(`    ${t.toolId}\n      ${t.displayName}`);
    }
}

if (arg('call')) {
    const name = arg('call');
    let params = {};
    // 真实业务参数（日期范围、sid 列表）往往很长，用文件传避免各种 shell 引号转义问题
    const argsFile = arg('args-file');
    const rawArgs = arg('args');
    if (argsFile && argsFile !== true) {
        try {
            params = JSON.parse(fs.readFileSync(argsFile, 'utf8'));
        } catch (e) {
            console.error(`--args-file 读取/解析失败 (${argsFile}): ${e.message}`);
            process.exit(2);
        }
    } else if (rawArgs && rawArgs !== true) {
        try {
            params = JSON.parse(rawArgs);
        } catch (e) {
            console.error(`--args 不是合法 JSON: ${e.message}`);
            console.error('提示：Windows PowerShell 会吃掉双引号，请改用 --args-file params.json');
            process.exit(2);
        }
    }
    console.log(`\n=== 调用 ${name} ===`);
    console.log('入参:', JSON.stringify(params));

    const result = await rpc('tools/call', { name, arguments: params });

    // 输出文件名带上 toolId，避免连续调用同一个网关工具时互相覆盖
    const outFile = path.join(outDir, `call-${name}${params && params.toolId ? `-${params.toolId}` : ''}.json`);
    fs.writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf8');

    console.log('isError:', result?.isError === true);
    const texts = (result?.content || []).filter((c) => c.type === 'text').map((c) => c.text);
    for (const t of texts.slice(0, 2)) {
        console.log('\n--- 返回内容（前 3000 字符）---');
        console.log(t.slice(0, 3000));
    }
    if (result?.structuredContent) {
        console.log('\n--- structuredContent（前 3000 字符）---');
        console.log(JSON.stringify(result.structuredContent, null, 2).slice(0, 3000));
    }
    console.log(`\n完整原始返回已写入 ${path.relative(ROOT, outFile)}`);
}

console.log('\n完成。.lingxing-probe/ 已被 .gitignore 忽略，不会误提交。');

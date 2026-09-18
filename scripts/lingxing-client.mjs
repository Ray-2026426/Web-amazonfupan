/**
 * 领星 MCP 客户端（抽象网关封装）。
 *
 * 抽出来的原因：这套调用有若干反直觉的细节，散落在各处必然写错。
 *
 *   1. 网关只有 3 个工具：help（发现）/ search（取 schema）/ action（执行）。
 *   2. tools/call 的业务参数必须放在 `arguments` 字段；
 *      写成 `params` 会被静默忽略 → 领星返回 code=400 参数有误，极易误判成业务参数问题。
 *   3. 成功码是 code:1（不是 0）；失败也返回 HTTP 200，错误藏在业务包里，
 *      JSON-RPC 的 isError 恒为 false。
 *   4. 「双层信封」：部分工具（如产品表现）的真实数据在 data.data，
 *      另一些工具（如店铺列表）在 data 本身。这里统一用 payload() 抹平。
 *   5. QPS = 1，必须串行 + 间隔。
 */
import fs from 'node:fs';
import path from 'node:path';

export const LINGXING_MCP_URL = 'https://openmcp.lingxing.com/mcp-servers/lingxing-mcp';
const MIN_INTERVAL_MS = 1200;

export function createClient({ key = process.env.LINGXING_MCP_KEY, url = process.env.LINGXING_MCP_URL || LINGXING_MCP_URL, intervalMs = MIN_INTERVAL_MS, verbose = false } = {}) {
    if (!key) throw new Error('缺少鉴权密钥：设置环境变量 LINGXING_MCP_KEY');
    let last = 0;
    let sessionId = null;
    let initialized = false;

    async function rpc(method, params, notification = false) {
        const wait = intervalMs - (Date.now() - last);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        last = Date.now();

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
                'X-Mcp-Key': key,
                ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method,
                ...(params !== undefined ? { params } : {}),
                ...(notification ? {} : { id: last }),
            }),
        });
        const sid = res.headers.get('mcp-session-id');
        if (sid) sessionId = sid;
        const text = await res.text();
        if (notification) return null;
        if (!res.ok) throw new Error(`${method} → HTTP ${res.status}: ${text.slice(0, 400)}`);
        // 网关对某些刷新类请求可能回 202/空体，不能直接 JSON.parse
        if (!text || !text.trim()) {
            if (verbose) console.error(`  [lingxing] ${method} 返回空响应体 (HTTP ${res.status})`);
            return null;
        }

        let payload = text;
        const sse = text.split(/\r?\n/).map((l) => l.match(/^data:\s*(.+)$/)).filter(Boolean).map((m) => m[1]);
        if (sse.length) payload = sse[sse.length - 1];
        const j = JSON.parse(payload);
        if (j.error) throw new Error(`${method} → JSON-RPC 错误: ${JSON.stringify(j.error)}`);
        return j.result;
    }

    /** 已在本会话内刷新过 schema 的业务工具 */
    const schemaReady = new Set();

    async function ensureInit() {
        if (initialized) return;
        await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dsh-lingxing', version: '1.0.0' } });
        await rpc('notifications/initialized', undefined, true);
        // 网关按「工具定义版本」校验，缺了刷新步骤会返回
        // 422「工具参数定义已更新，请刷新工具列表后重新调用」。
        // 按官方 usage（help -> search -> action）：先拉 MCP 工具列表，再拉一次业务工具目录。
        await rpc('tools/list', {});
        await rpc('tools/call', { name: 'help', arguments: { limit: 50, offset: 0 } });
        initialized = true;
    }

    /** 调用 action 前必须先 search 该工具的入参 schema，否则网关认为定义过期 */
    async function ensureSchema(toolId) {
        if (schemaReady.has(toolId)) return;
        await rpc('tools/call', { name: 'search', arguments: { toolId } });
        schemaReady.add(toolId);
    }

    /** 成功=1；其余（102 key 无效 / 400 参数 / 422 定义过期 / 429 风控）都抛错并带上原始 msg */
    function unwrap(result) {
        if (result === null || result === undefined) return null;
        const text = (result?.content || []).find((c) => c.type === 'text')?.text;
        if (!text) throw new Error(`返回里没有 text 内容: ${JSON.stringify(result).slice(0, 300)}`);

        // 网关有时回纯文本包装：`call failed, status: 422, response: {...}`
        let body = text;
        if (!body.trimStart().startsWith('{')) {
            const i = body.indexOf('{');
            if (i !== -1) {
                const head = body.slice(0, i).trim();
                try {
                    const j = JSON.parse(body.slice(i));
                    throw new Error(`${head} → code=${j.code} ${j.msg || ''}`);
                } catch (e) {
                    if (e instanceof SyntaxError) throw new Error(`无法解析网关错误: ${text.slice(0, 300)}`);
                    throw e;
                }
            }
            throw new Error(`网关返回非 JSON: ${text.slice(0, 300)}`);
        }

        const j = JSON.parse(body);
        if (j.code !== 1) throw new Error(`网关错误 code=${j.code} ${j.msg || ''}`);
        return j.data;
    }

    /** 抹平「双层信封」：真实数据可能在本层，也可能在 .data */
    function payload(d) {
        if (d && typeof d === 'object' && !Array.isArray(d) && d.data && typeof d.data === 'object' && !Array.isArray(d.data)) {
            return d.data;
        }
        return d;
    }

    /** 调用业务工具，返回已抹平信封的真实载荷 */
    async function call(toolId, params) {
        await ensureInit();
        await ensureSchema(toolId);
        const args = params === null || params === undefined ? { toolId } : { toolId, params };
        const raw = unwrap(await rpc('tools/call', { name: 'action', arguments: args }));
        if (verbose) console.error(`  [lingxing] ${toolId} → 顶层键 ${Object.keys(raw).slice(0, 8).join(',')}`);
        return payload(raw);
    }

    /** 调用网关的 help / search */
    async function gateway(name, args) {
        await ensureInit();
        return unwrap(await rpc('tools/call', { name, arguments: args }));
    }

    return { call, gateway, rpc, ensureInit };
}

/** 拉全量业务工具目录（分页），带本地缓存 */
export async function fetchCatalog(client, cacheFile) {
    if (cacheFile && fs.existsSync(cacheFile)) {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        if (Array.isArray(cached) && cached.length > 100) return cached;
    }
    const all = [];
    let offset = 0;
    const PAGE = 50;
    let total = null;
    while (total === null || all.length < total) {
        const d = await client.gateway('help', { limit: PAGE, offset });
        total = d.total;
        all.push(...(d.tools || []));
        offset += PAGE;
        if (offset > 3000) break;
    }
    if (cacheFile) {
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify(all, null, 2), 'utf8');
    }
    return all;
}

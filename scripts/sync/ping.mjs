#!/usr/bin/env node
/**
 * 领星连通性测试（只花 1 次鉴权 + 1 次业务调用）
 *
 * 用途：同步失败时，先判断到底是「领星这边通不通」，还是「同步流程有问题」。
 * 相比跑一整轮同步（81 个店铺、几百次请求），这个脚本 10 秒内出结果，也不会继续烧配额。
 *
 * 用法：
 *   node scripts/sync/ping.mjs
 * 环境变量：LINGXING_MCP_KEY
 */
import { createClient, describeMcpKey } from '../lingxing-client.mjs';

const key = process.env.LINGXING_MCP_KEY;
if (!key) {
    console.error('❌ 缺少 LINGXING_MCP_KEY（GitHub Secret 或本地环境变量）');
    process.exit(2);
}

const started = Date.now();
const keyInfo = describeMcpKey(key);

/** 在 GitHub Actions 里把结果直接显示到运行概览页（Annotations），不用展开日志 */
const annotate = (level, title, message) => {
    if (process.env.GITHUB_ACTIONS !== 'true') return;
    const oneLine = String(message).replace(/[\r\n]+/g, ' ').slice(0, 400);
    console.log(`::${level} title=${title}::${oneLine}`);
};

console.log(`密钥诊断：长度 ${keyInfo.originalLength} → 清洗后 ${keyInfo.cleanedLength}`);
if (keyInfo.changed) {
    console.log('  已自动去掉首尾空白/引号/零宽字符（这类字符会让领星误判为 Key 无效）');
}
if (keyInfo.hasWhitespace) console.log('  ⚠ 原值含空白或换行（已清洗）');
if (keyInfo.hasQuotes) console.log('  ⚠ 原值含外层引号（已清洗）');
if (keyInfo.hasZeroWidth) console.log('  ⚠ 原值含零宽字符（已清洗）');
if (!keyInfo.looksLikeToken) {
    console.log('  ⚠ 清洗后仍含非常规字符（正常密钥通常只有字母/数字/_-），很可能复制错了东西');
}
console.log(`尝试鉴权并取店铺列表…`);

try {
    const client = createClient({ intervalMs: 800, verbose: true });
    const data = await client.call('get_my_sids', null);
    const list = (data && data.list) || [];
    const real = list.filter((s) => !s.is_concept);

    console.log('');
    console.log(`✅ 领星连通正常：${Math.round((Date.now() - started) / 1000)}s 内拿到 ${list.length} 个店铺（实体店 ${real.length} 个）`);
    if (real.length) {
        console.log('   前 3 个：' + real.slice(0, 3).map((s) => `${s.id}:${s.name || '(无名)'}`).join('  |  '));
    }
    if (real.length === 0) {
        annotate('warning', '领星连通但店铺为 0', '密钥可能没有店铺权限');
        console.log('   ⚠ 实体店铺数为 0：这个密钥可能没有店铺权限');
        process.exit(1);
    }
    annotate('notice', '领星连通正常', `拿到 ${list.length} 个店铺，可以跑同步了（days 填 1）`);
    console.log('');
    console.log('下一步：可以跑同步了（Actions 里 days 填 1 先小范围验证）');
    process.exit(0);
} catch (e) {
    const message = String((e && e.message) || e);
    console.log('');
    console.log(`❌ 失败：${message}`);
    if (e && e.code === 'LINGXING_AUTH_RATE_LIMITED') {
        annotate('error', '领星鉴权被限流（429）', '不是配置错误：等待 30~60 分钟再试，期间不要再触发');
        console.log('');
        console.log('这是领星的鉴权频率限制（429），不是你配置错了。');
        console.log('处理：等 30~60 分钟再点一次（期间不要重复触发）。');
        console.log('如果反复这样，说明出口 IP 被领星限流（GitHub 的机器是共享 IP），');
        console.log('那就要把定时任务放到出口 IP 固定/干净的地方（例如自己的云服务器）。');
    } else if (/code=102|无效|invalid/i.test(message)) {
        annotate('error', '领星密钥无效（102）', '去 ERP→AI助手→MCP→复制密钥，更新 GitHub Secret 后重跑');
        console.log('处理（按顺序排查）：');
        console.log('  1. 去领星 ERP → AI助手 → 点【MCP】→ 【复制密钥】重新复制一次');
        console.log('     （注意：要的是「密钥」，不是 JSON 里的 URL）');
        console.log('  2. 如果最近在【管理MCP】点过「重新生成」，旧密钥会立即失效，只能用最新的那个');
        console.log('  3. 确认 MCP 已启用：业务配置 → 开放接口 → MCP（需付费账号）');
        console.log('  4. 复制后先粘到记事本看一眼：首尾有没有空格/换行，是不是完整长度');
        console.log('  5. 更新 GitHub → Settings → Secrets → LINGXING_MCP_KEY（点 Update），再跑一次');
    } else if (/ENOTFOUND|fetch failed|ECONN|timeout/i.test(message)) {
        annotate('error', '领星网络不通', '换网络或稍后再试');
        console.log('处理：网络不通 → 换网络/稍后再试。');
    } else {
        annotate('error', '领星连通失败', message);
    }
    process.exit(1);
}

import { adminAuthorized, writeTable } from '../serverless/supabase.js';

/**
 * 一键补数：把选中的日期交给 GitHub Actions 的「历史数据回补」工作流。
 *
 * 为什么不在这里直接调领星：领星密钥只存在于 GitHub Secrets，
 * Vercel 这边没有、也不应该有一份；所以这里只负责触发工作流。
 *
 * 需要环境变量 GITHUB_DISPATCH_TOKEN（细粒度 PAT：仓库 Actions = Read and write）。
 */
const REPO = process.env.GITHUB_REPO || 'Ray-2026426/Web-amazonfupan';
const WORKFLOW = 'backfill-history.yml';
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const EARLIEST = '2025-01-01';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!adminAuthorized(req)) return res.status(401).json({ error: 'unauthorized', message: '管理密码不正确' });

  const token = process.env.GITHUB_DISPATCH_TOKEN;

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const dates = Array.isArray(body?.dates) ? body.dates.map((item) => String(item).trim()) : [];
  if (!dates.length) return res.status(400).json({ error: 'no_dates', message: '没有选择要补的日期' });
  if (dates.length > 60) return res.status(400).json({ error: 'too_many_dates', message: '一次最多补 60 天' });

  const unique = [...new Set(dates)].sort();
  for (const date of unique) {
    if (!ISO_RE.test(date)) return res.status(400).json({ error: 'invalid_date', message: `日期格式无效：${date}` });
    if (date < EARLIEST) return res.status(400).json({ error: 'too_early', message: `不能早于 ${EARLIEST}：${date}` });
  }

  // 没有 GitHub 令牌时退回「队列模式」：写进 sync_requests，由定时工作流消费（最多延迟 10 分钟）
  if (!token) {
    try {
      await writeTable('sync_requests', 'POST', { dates: unique, status: 'pending' });
      return res.status(200).json({
        queued: true,
        count: unique.length,
        from: unique[0],
        to: unique[unique.length - 1],
        message: `已加入补数队列（${unique.length} 天），后台任务会在 10 分钟内开始`,
      });
    } catch (error) {
      console.error('[backfill] enqueue failed', error);
      return res.status(501).json({
        error: 'dispatch_not_configured',
        message: '一键补数还没配置：请配置 GITHUB_DISPATCH_TOKEN，或在 Supabase 执行最新 db/schema.sql（含 sync_requests 队列表）',
      });
    }
  }

  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: { dates: unique.join(','), chunk_days: '14', max_parallel: '1' },
      }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      console.error('[backfill] dispatch failed', response.status, detail);
      return res.status(502).json({ error: 'dispatch_failed', message: `触发工作流失败（HTTP ${response.status}）：${detail}` });
    }
    return res.status(200).json({
      dispatched: true,
      count: unique.length,
      from: unique[0],
      to: unique[unique.length - 1],
      actionsUrl: `https://github.com/${REPO}/actions/workflows/${WORKFLOW}`,
    });
  } catch (error) {
    console.error('[backfill]', error);
    return res.status(502).json({ error: 'dispatch_error', message: '触发工作流失败，请稍后重试' });
  }
}

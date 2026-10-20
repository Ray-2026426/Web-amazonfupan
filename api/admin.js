import { adminAuthorized, fetchTable, isValidDate, writeTable } from '../serverless/supabase.js';

const clean = (value, label, max = 100) => {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw Object.assign(new Error(`${label}不能为空或过长`), { status: 400 });
  return text;
};

const productFields = ['brand', 'manager', 'sub_category', 'parent_asin', 'product_name'];

async function save(body) {
  const now = new Date().toISOString();
  switch (body.action) {
    case 'settings': {
      if (typeof body.enabled !== 'boolean' || !Number.isInteger(body.lookback_days) || body.lookback_days < 1 || body.lookback_days > 14) {
        throw Object.assign(new Error('同步设置无效：回补天数须为 1–14'), { status: 400 });
      }
      await writeTable('sync_settings', 'PATCH', { enabled: body.enabled, lookback_days: body.lookback_days, updated_at: now }, { id: 'eq.1' });
      return;
    }
    case 'cost_rule': {
      const sid = clean(body.sid, '店铺 ID');
      const local_sku = clean(body.local_sku, '本地 SKU', 200);
      const asin = clean(body.asin, '目标 ASIN', 40).toUpperCase();
      await writeTable('cost_asin_rules', 'POST', { sid, local_sku, asin, updated_at: now }, { on_conflict: 'sid,local_sku' }, true);
      return;
    }
    case 'delete_cost_rule': {
      const sid = clean(body.sid, '店铺 ID');
      const local_sku = clean(body.local_sku, '本地 SKU', 200);
      await writeTable('cost_asin_rules', 'DELETE', undefined, { sid: `eq.${sid}`, local_sku: `eq.${local_sku}` });
      return;
    }
    case 'product_override': {
      const row = { sid: clean(body.sid, '店铺 ID'), asin: clean(body.asin, 'ASIN', 40).toUpperCase(), updated_at: now };
      for (const field of productFields) row[field] = body[field] == null || String(body[field]).trim() === '' ? null : clean(body[field], field, 200);
      if (productFields.every((field) => row[field] === null)) throw Object.assign(new Error('至少填写一个要覆盖的字段'), { status: 400 });
      await writeTable('product_overrides', 'POST', row, { on_conflict: 'sid,asin' }, true);
      return;
    }
    case 'delete_product_override': {
      const sid = clean(body.sid, '店铺 ID');
      const asin = clean(body.asin, 'ASIN', 40).toUpperCase();
      await writeTable('product_overrides', 'DELETE', undefined, { sid: `eq.${sid}`, asin: `eq.${asin}` });
      return;
    }
    default:
      throw Object.assign(new Error('未知管理操作'), { status: 400 });
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!adminAuthorized(req)) return res.status(401).json({ error: 'unauthorized', message: '管理密码不正确' });
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url || '/', 'https://localhost');
      const date = url.searchParams.get('date');
      if (date && !isValidDate(date)) return res.status(400).json({ error: 'invalid_date' });
      const [settings, costRules, productOverrides, runs, latest] = await Promise.all([
        fetchTable('sync_settings', { select: '*', id: 'eq.1' }, 1),
        fetchTable('cost_asin_rules', { select: '*', order: 'updated_at.desc' }, 1000),
        fetchTable('product_overrides', { select: '*', order: 'updated_at.desc' }, 1000),
        fetchTable('sync_runs', { select: '*', order: 'started_at.desc' }, 10),
        fetchTable('fact_daily', { select: 'date', order: 'date.desc' }, 1),
      ]);
      const sampleDate = date || latest[0]?.date;
      const data = sampleDate ? await fetchTable('fact_daily', {
        select: 'date,sid,asin,shop_name,product_name,sales_amount,gross_profit,ad_spend',
        date: `eq.${sampleDate}`, order: 'sales_amount.desc',
      }, 100) : [];
      return res.status(200).json({ settings: settings[0] || null, costRules, productOverrides, runs, sampleDate, data });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'invalid_body' });
    await save(body);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[admin]', error);
    return res.status(error.status || 502).json({ error: 'admin_error', message: error.status === 400 ? error.message : '管理后台暂时不可用，请检查数据库配置' });
  }
}

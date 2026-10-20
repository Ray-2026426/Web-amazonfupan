import { adminAuthorized, fetchTable, isValidDate, writeTable } from '../serverless/supabase.js';
import { randomUUID } from 'node:crypto';

const clean = (value, label, max = 100) => {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw Object.assign(new Error(`${label}不能为空或过长`), { status: 400 });
  return text;
};

const productFields = ['brand', 'manager', 'sub_category', 'parent_asin', 'product_name'];
const targetTextFields = ['brand', 'country', 'shop_name', 'manager', 'sub_category', 'parent_asin', 'child_asin', 'product_name'];
const targetNumberFields = ['sales_quantity_target', 'sales_amount_target', 'gross_profit_target', 'gross_margin_target', 'ad_spend_target'];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

function targetPayload(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !monthPattern.test(raw.month || '')) {
    throw Object.assign(new Error('目标表日期格式无效'), { status: 400 });
  }
  const payload = { month: raw.month };
  for (const field of targetTextFields) payload[field] = String(raw[field] ?? '').trim().slice(0, 300);
  for (const field of targetNumberFields) {
    const value = Number(raw[field] ?? 0);
    if (!Number.isFinite(value) || Math.abs(value) > 1e12) throw Object.assign(new Error(`目标表数值无效：${field}`), { status: 400 });
    payload[field] = value;
  }
  return payload;
}

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
    case 'targets_start': {
      const expectedRows = Number(body.expected_rows);
      if (!Number.isInteger(expectedRows) || expectedRows < 1 || expectedRows > 100000) {
        throw Object.assign(new Error('目标表有效行数须为 1–100000'), { status: 400 });
      }
      const id = randomUUID();
      await writeTable('target_imports', 'POST', {
        id, source_filename: clean(body.source_filename, '文件名', 200), expected_rows: expectedRows,
        status: 'staging', active: false,
      });
      return { import_id: id };
    }
    case 'targets_batch': {
      const id = String(body.import_id || '');
      if (!uuidPattern.test(id) || !Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > 500) {
        throw Object.assign(new Error('目标表上传批次无效'), { status: 400 });
      }
      const imports = await fetchTable('target_imports', { select: 'id,status,expected_rows', id: `eq.${id}` }, 1);
      if (imports[0]?.status !== 'staging') throw Object.assign(new Error('目标表上传批次已失效'), { status: 400 });
      const rows = body.rows.map((item) => {
        if (!item || typeof item !== 'object' || !Number.isInteger(item.row_no) || item.row_no < 0 || item.row_no >= imports[0].expected_rows) {
          throw Object.assign(new Error('目标表行号无效'), { status: 400 });
        }
        const payload = targetPayload(item.payload);
        return { import_id: id, row_no: item.row_no, month: payload.month, payload };
      });
      await writeTable('target_rows', 'POST', rows, { on_conflict: 'import_id,row_no' }, true);
      return { uploaded: rows.length };
    }
    case 'targets_activate': {
      const id = String(body.import_id || '');
      if (!uuidPattern.test(id)) throw Object.assign(new Error('目标表上传批次无效'), { status: 400 });
      await writeTable('rpc/activate_target_import', 'POST', { p_id: id });
      return { activated: true };
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
      const [settings, costRules, productOverrides, runs, latest, targetImports] = await Promise.all([
        fetchTable('sync_settings', { select: '*', id: 'eq.1' }, 1),
        fetchTable('cost_asin_rules', { select: '*', order: 'updated_at.desc' }, 1000),
        fetchTable('product_overrides', { select: '*', order: 'updated_at.desc' }, 1000),
        fetchTable('sync_runs', { select: '*', order: 'started_at.desc' }, 10),
        fetchTable('fact_daily', { select: 'date', order: 'date.desc' }, 1),
        fetchTable('target_imports', { select: 'id,source_filename,expected_rows,activated_at', active: 'eq.true' }, 1),
      ]);
      const sampleDate = date || latest[0]?.date;
      const data = sampleDate ? await fetchTable('fact_daily', {
        select: 'date,sid,asin,shop_name,product_name,sales_amount,gross_profit,ad_spend',
        date: `eq.${sampleDate}`, order: 'sales_amount.desc',
      }, 100) : [];
      return res.status(200).json({ settings: settings[0] || null, costRules, productOverrides, runs, sampleDate, data, targetImport: targetImports[0] || null });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'invalid_body' });
    const result = await save(body);
    return res.status(200).json({ ok: true, ...(result || {}) });
  } catch (error) {
    console.error('[admin]', error);
    return res.status(error.status || 502).json({ error: 'admin_error', message: error.status === 400 ? error.message : '管理后台暂时不可用，请检查数据库配置' });
  }
}

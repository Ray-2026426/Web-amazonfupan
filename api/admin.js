import { adminAuthorized, fetchTable, isValidDate, writeTable } from '../serverless/supabase.js';
import { FIELD_KEYS, FIELD_MAPPINGS } from '../shared/field-mapping.mjs';
import { randomUUID } from 'node:crypto';

const clean = (value, label, max = 100) => {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw Object.assign(new Error(`${label}不能为空或过长`), { status: 400 });
  return text;
};

/** 可配置映射的字段：唯一定义在 shared/field-mapping.mjs，与同步脚本、后台 UI 共用 */
const DEFAULT_FIELD_MAPPINGS = Object.fromEntries(
  FIELD_MAPPINGS.map((item) => [item.web_field, { export_label: item.export_label, lingxing_field: item.lingxing_field }]),
);
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
    case 'field_mapping': {
      const webField = String(body.web_field || '');
      if (!FIELD_KEYS.includes(webField)) throw Object.assign(new Error('未知字段'), { status: 400 });
      const export_label = clean(body.export_label, '下载字段名', 40);
      const lingxing_field = clean(body.lingxing_field, '领星字段名', 200);
      await writeTable('field_mappings', 'POST', { web_field: webField, export_label, lingxing_field, updated_at: now }, { on_conflict: 'web_field' }, true);
      return;
    }
    case 'field_mapping_reset': {
      const requested = body.web_field ? [String(body.web_field)] : FIELD_KEYS;
      for (const webField of requested) {
        const preset = DEFAULT_FIELD_MAPPINGS[webField];
        if (!preset) throw Object.assign(new Error('未知字段'), { status: 400 });
        await writeTable('field_mappings', 'POST', { web_field: webField, ...preset, updated_at: now }, { on_conflict: 'web_field' }, true);
      }
      return { reset: requested.length };
    }
    case 'targets_start': {
      const expectedRows = Number(body.expected_rows);
      if (!Number.isInteger(expectedRows) || expectedRows < 1 || expectedRows > 100000) {
        throw Object.assign(new Error('目标表有效行数须为 1–100000'), { status: 400 });
      }
      const id = randomUUID();
      // 覆盖率摘要：前端解析目标表时算好一起传，避免后台再扫一遍几十万行
      const summary = {
        covered_shops: Number.isFinite(Number(body.covered_shops)) ? Number(body.covered_shops) : null,
        covered_asins: Number.isFinite(Number(body.covered_asins)) ? Number(body.covered_asins) : null,
        months: typeof body.months === 'string' ? body.months.slice(0, 200) : null,
      };
      await writeTable('target_imports', 'POST', {
        id, source_filename: clean(body.source_filename, '文件名', 200), expected_rows: expectedRows,
        status: 'staging', active: false, ...summary,
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
    /* ---------- 商品图片表（云端常驻，上传一次即可） ---------- */
    case 'images_start': {
      const expectedRows = Number(body.expected_rows);
      if (!Number.isInteger(expectedRows) || expectedRows < 1 || expectedRows > 100000) {
        throw Object.assign(new Error('图片表有效行数须为 1–100000'), { status: 400 });
      }
      const id = randomUUID();
      await writeTable('product_image_imports', 'POST', {
        id,
        source_filename: clean(body.source_filename, '文件名', 200),
        expected_rows: expectedRows,
        status: 'staging',
        active: false,
      });
      return { import_id: id };
    }
    case 'images_batch': {
      const id = String(body.import_id || '');
      if (!uuidPattern.test(id) || !Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > 500) {
        throw Object.assign(new Error('图片表上传批次无效'), { status: 400 });
      }
      const imports = await fetchTable('product_image_imports', { select: 'id,status', id: `eq.${id}` }, 1);
      if (imports[0]?.status !== 'staging') throw Object.assign(new Error('图片表上传批次已失效'), { status: 400 });
      const rows = body.rows.map((item) => {
        const sku = String(item?.sku || '').trim().slice(0, 120);
        const productName = String(item?.product_name || '').trim().slice(0, 300);
        const imageUrl = String(item?.image_url || '').trim().slice(0, 2000);
        if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) throw Object.assign(new Error('图片链接无效'), { status: 400 });
        return { import_id: id, sku: sku || null, product_name: productName || null, image_url: imageUrl };
      });
      await writeTable('product_images', 'POST', rows);
      return { uploaded: rows.length };
    }
    case 'images_activate': {
      const id = String(body.import_id || '');
      if (!uuidPattern.test(id)) throw Object.assign(new Error('图片表上传批次无效'), { status: 400 });
      await writeTable('rpc/activate_image_import', 'POST', { p_id: id });
      return { activated: true };
    }
    case 'images_relink': {
      // 同步补齐 SKU↔ASIN 对照后，把已上传图片表里还没翻译的行再匹配一次
      await writeTable('rpc/relink_image_asins', 'POST', {});
      return { relinked: true };
    }
    case 'images_stats': {
      // 图片表体检：总数 / 已匹配 ASIN / 最近一次上传时间
      const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
      const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
      if (!base || !key) throw Object.assign(new Error('缺少 Supabase 配置'), { status: 500 });
      const response = await fetch(`${base}/rest/v1/rpc/image_stats`, {
        method: 'POST',
        headers: {
          apikey: key,
          'Content-Type': 'application/json',
          ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}),
        },
        body: '{}',
      });
      if (!response.ok) {
        const text = (await response.text()).slice(0, 200);
        throw Object.assign(new Error(`图片表还没建好（请先在 Supabase 执行 db/schema.sql）：${text}`), { status: 400 });
      }
      return { stats: await response.json() };
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
      // 映射表可能还没建（用户尚未执行最新 schema）：这时回退到内置默认值，
      // 面板照常打开，但会带 fieldMappingReady=false 让前端提示先建表。
      const mappingsResult = await fetchTable('field_mappings', { select: 'web_field,export_label,lingxing_field' }, 100)
        .then((rows) => ({ rows, ready: true }))
        .catch(() => ({ rows: [], ready: false }));
      const [settings, runs, latest, targetImports, syncRequests, imageImports] = await Promise.all([
        fetchTable('sync_settings', { select: '*', id: 'eq.1' }, 1),
        fetchTable('sync_runs', { select: '*', order: 'started_at.desc' }, 10),
        fetchTable('fact_daily', { select: 'date', order: 'date.desc' }, 1),
        fetchTable('target_imports', { select: '*', active: 'eq.true' }, 1),
        // 补数队列：还没建表时忽略，不影响面板其它部分
        fetchTable('sync_requests', { select: 'id,dates,status,created_at,processed_at,note', order: 'created_at.desc' }, 15).catch(() => []),
        fetchTable('product_image_imports', { select: '*', active: 'eq.true' }, 1).catch(() => []),
      ]);
      const fieldMappings = mappingsResult.ready
        ? mappingsResult.rows
        : Object.entries(DEFAULT_FIELD_MAPPINGS).map(([web_field, preset]) => ({ web_field, ...preset }));
      const sampleDate = date || latest[0]?.date;
      const data = sampleDate ? await fetchTable('fact_daily', {
        select: 'date,sid,asin,shop_name,product_name,sales_amount,gross_profit,ad_spend',
        date: `eq.${sampleDate}`, order: 'sales_amount.desc',
      }, 100) : [];
      return res.status(200).json({ settings: settings[0] || null, fieldMappings, fieldMappingReady: mappingsResult.ready, runs, syncRequests, sampleDate, data, targetImport: targetImports[0] || null, imageImport: imageImports[0] || null });
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

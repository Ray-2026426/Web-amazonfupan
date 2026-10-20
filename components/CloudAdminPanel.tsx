import React, { useEffect, useState } from 'react';

type CostRule = { sid: string; local_sku: string; asin: string };
type ProductRule = { sid: string; asin: string; brand: string | null; manager: string | null; sub_category: string | null; parent_asin: string | null; product_name: string | null };
type Run = { id: number; started_at: string; range_from: string; range_to: string; status: string; rows_daily: number; error: string | null };
type Sample = { date: string; sid: string; asin: string; shop_name: string; product_name: string; sales_amount: number; gross_profit: number; ad_spend: number };
type AdminData = {
  settings: { enabled: boolean; lookback_days: number } | null;
  costRules: CostRule[];
  productOverrides: ProductRule[];
  runs: Run[];
  sampleDate: string | null;
  data: Sample[];
};

const TOKEN_KEY = 'amazon-dashboard-admin-token';
const emptyProduct = { sid: '', asin: '', brand: '', manager: '', sub_category: '', parent_asin: '', product_name: '' };

export const CloudAdminPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || '');
  const [password, setPassword] = useState('');
  const [data, setData] = useState<AdminData | null>(null);
  const [tab, setTab] = useState<'overview' | 'cost' | 'product' | 'data'>('overview');
  const [cost, setCost] = useState({ sid: '', local_sku: '', asin: '' });
  const [product, setProduct] = useState(emptyProduct);
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const request = async (method: 'GET' | 'POST', body?: object, requestedDate = date) => {
    const response = await fetch(`/api/admin${method === 'GET' && requestedDate ? `?date=${encodeURIComponent(requestedDate)}` : ''}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) {
      sessionStorage.removeItem(TOKEN_KEY);
      setToken('');
      throw new Error('管理密码不正确');
    }
    if (!response.ok) throw new Error(result.message || `请求失败：${response.status}`);
    return result;
  };

  const load = async (requestedDate = date) => {
    setBusy(true);
    try {
      const result = await request('GET', undefined, requestedDate) as AdminData;
      setData(result);
      setMessage('');
    } catch (error) {
      setMessage(String(error instanceof Error ? error.message : error));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { if (token) void load(); }, [token]);

  const save = async (body: object, success: string) => {
    setBusy(true);
    try {
      await request('POST', body);
      const refreshed = await request('GET') as AdminData;
      setData(refreshed);
      setMessage(`${success}。规则将在下次同步或历史回补时生效。`);
    } catch (error) {
      setMessage(String(error instanceof Error ? error.message : error));
    } finally {
      setBusy(false);
    }
  };

  const fieldClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800';
  const actionClass = 'rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';
  const smallClass = 'rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600';

  return <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/60 p-3" role="dialog" aria-modal="true" aria-label="云端数据管理后台">
    <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      <header className="flex items-center justify-between border-b border-slate-200 p-4">
        <div><h2 className="text-lg font-bold text-slate-800">云端数据管理</h2><p className="text-xs text-slate-500">查看同步、管理匹配规则和数据来源</p></div>
        <button className={smallClass} onClick={onClose}>关闭</button>
      </header>
      {!token ? <form className="mx-auto w-full max-w-md space-y-3 p-8" onSubmit={event => { event.preventDefault(); const value = password.trim(); if (value) { sessionStorage.setItem(TOKEN_KEY, value); setToken(value); setPassword(''); } }}>
        <p className="text-sm text-slate-600">输入单独的管理密码。它与看板只读密码不同。</p>
        <input className={fieldClass} type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="管理密码" aria-label="管理密码" />
        <button className={actionClass} type="submit">进入管理后台</button>
        {message && <p className="text-sm text-red-700" role="alert">{message}</p>}
      </form> : <>
        <nav className="flex flex-wrap gap-2 border-b border-slate-200 p-3 text-sm">
          {([['overview', '同步与设置'], ['cost', '成本匹配'], ['product', '产品字段'], ['data', '数据抽查']] as const).map(([key, label]) => <button key={key} onClick={() => setTab(key)} className={`rounded-lg px-3 py-1.5 ${tab === key ? 'bg-sky-100 font-bold text-sky-800' : 'text-slate-600'}`}>{label}</button>)}
          <button className={`${smallClass} ml-auto`} onClick={() => { sessionStorage.removeItem(TOKEN_KEY); setToken(''); setData(null); }}>退出管理</button>
        </nav>
        <div className="overflow-y-auto p-4 text-sm">
          {message && <p className="mb-3 rounded-lg bg-amber-50 p-2 text-amber-900" role="status">{message}</p>}
          {!data ? <p className="p-6 text-slate-500">{busy ? '正在读取云端配置…' : '暂无数据，请检查 Supabase 配置。'}</p> : <>
            {tab === 'overview' && <div className="space-y-6">
              <section className="rounded-xl border border-slate-200 p-4"><h3 className="mb-3 font-bold">自动同步设置</h3>
                <label className="mr-5 inline-flex items-center gap-2"><input type="checkbox" checked={data.settings?.enabled ?? true} onChange={event => setData({ ...data, settings: { enabled: event.target.checked, lookback_days: data.settings?.lookback_days ?? 3 } })} />启用每日自动同步</label>
                <label className="inline-flex items-center gap-2">每天回补最近 <input className="w-16 rounded border p-1 text-center" type="number" min="1" max="14" value={data.settings?.lookback_days ?? 3} onChange={event => setData({ ...data, settings: { enabled: data.settings?.enabled ?? true, lookback_days: Number(event.target.value) } })} /> 天</label>
                <div className="mt-3"><button className={actionClass} disabled={busy} onClick={() => save({ action: 'settings', ...data.settings }, '设置已保存')}>保存设置</button></div>
              </section>
              <section><h3 className="mb-2 font-bold">最近同步记录</h3><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b"><th className="p-2">开始时间</th><th className="p-2">数据日期</th><th className="p-2">状态</th><th className="p-2">日明细行数</th></tr></thead><tbody>{data.runs.map(run => <tr key={run.id} className="border-b"><td className="p-2">{new Date(run.started_at).toLocaleString('zh-CN')}</td><td className="p-2">{run.range_from} ～ {run.range_to}</td><td className="p-2">{run.status}</td><td className="p-2">{run.rows_daily ?? 0}</td></tr>)}</tbody></table></div>{!data.runs.length && <p className="text-slate-500">尚无同步记录。</p>}</section>
            </div>}
            {tab === 'cost' && <div className="space-y-4"><p className="text-slate-600">指定“店铺 ID + 本地 SKU”应归入哪个 ASIN，用于订单利润成本匹配。</p>
              <div className="grid gap-2 sm:grid-cols-4"><input className={fieldClass} placeholder="店铺 ID" value={cost.sid} onChange={e => setCost({ ...cost, sid: e.target.value })} /><input className={fieldClass} placeholder="本地 SKU" value={cost.local_sku} onChange={e => setCost({ ...cost, local_sku: e.target.value })} /><input className={fieldClass} placeholder="目标 ASIN" value={cost.asin} onChange={e => setCost({ ...cost, asin: e.target.value })} /><button className={actionClass} disabled={busy} onClick={() => save({ action: 'cost_rule', ...cost }, '成本匹配规则已保存')}>保存规则</button></div>
              <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b"><th className="p-2">店铺 ID</th><th className="p-2">本地 SKU</th><th className="p-2">目标 ASIN</th><th className="p-2">操作</th></tr></thead><tbody>{data.costRules.map(rule => <tr className="border-b" key={`${rule.sid}|${rule.local_sku}`}><td className="p-2">{rule.sid}</td><td className="p-2">{rule.local_sku}</td><td className="p-2">{rule.asin}</td><td className="p-2"><button className={smallClass} onClick={() => setCost(rule)}>编辑</button> <button className={smallClass} onClick={() => { if (window.confirm('删除这条成本匹配规则？')) void save({ action: 'delete_cost_rule', sid: rule.sid, local_sku: rule.local_sku }, '规则已删除'); }}>删除</button></td></tr>)}</tbody></table></div>
            </div>}
            {tab === 'product' && <div className="space-y-4"><p className="text-slate-600">指定“店铺 ID + ASIN”的字段覆盖值；留空表示继续使用领星原值。</p>
              <div className="grid gap-2 sm:grid-cols-3">{(['sid', 'asin', 'brand', 'manager', 'sub_category', 'parent_asin', 'product_name'] as const).map(field => <input key={field} className={fieldClass} placeholder={({ sid: '店铺 ID', asin: 'ASIN', brand: '品牌', manager: '负责人', sub_category: '二级品类', parent_asin: '父 ASIN', product_name: '产品名称' })[field]} value={product[field]} onChange={e => setProduct({ ...product, [field]: e.target.value })} />)}</div>
              <button className={actionClass} disabled={busy} onClick={() => save({ action: 'product_override', ...product }, '产品字段规则已保存')}>保存规则</button>
              <div className="space-y-2">{data.productOverrides.map(rule => <div key={`${rule.sid}|${rule.asin}`} className="flex flex-wrap items-center gap-2 rounded-lg border p-2 text-xs"><strong>{rule.sid} / {rule.asin}</strong><span className="text-slate-500">{[rule.brand, rule.manager, rule.sub_category, rule.parent_asin, rule.product_name].filter(Boolean).join(' · ')}</span><button className={smallClass} onClick={() => setProduct(Object.fromEntries(Object.entries(rule).map(([key, value]) => [key, value ?? ''])) as typeof emptyProduct)}>编辑</button><button className={smallClass} onClick={() => { if (window.confirm('删除这条产品字段规则？')) void save({ action: 'delete_product_override', sid: rule.sid, asin: rule.asin }, '规则已删除'); }}>删除</button></div>)}</div>
            </div>}
            {tab === 'data' && <div className="space-y-3"><p className="text-slate-600">抽查某一天销售额最高的前 100 条明细。数值异常时，先改匹配规则，再重跑对应日期。</p><div className="flex gap-2"><input className={fieldClass} type="date" value={date || data.sampleDate || ''} onChange={e => setDate(e.target.value)} /><button className={actionClass} disabled={busy} onClick={() => load(date || data.sampleDate || '')}>查询</button></div><p>当前日期：{data.sampleDate || '暂无数据'}</p>
              <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b"><th className="p-2">店铺</th><th className="p-2">ASIN</th><th className="p-2">产品</th><th className="p-2">销售额</th><th className="p-2">毛利</th><th className="p-2">广告花费</th></tr></thead><tbody>{data.data.map(row => <tr key={`${row.date}|${row.sid}|${row.asin}`} className="border-b"><td className="p-2">{row.shop_name}</td><td className="p-2">{row.asin}</td><td className="p-2">{row.product_name}</td><td className="p-2">{Number(row.sales_amount).toFixed(2)}</td><td className="p-2">{Number(row.gross_profit).toFixed(2)}</td><td className="p-2">{Number(row.ad_spend).toFixed(2)}</td></tr>)}</tbody></table></div>
            </div>}
          </>}
        </div>
      </>}
    </div>
  </div>;
};

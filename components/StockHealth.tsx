import React, { useMemo, useState } from 'react';
import { AlertTriangle, Boxes, PackageCheck, PackageX } from 'lucide-react';
import type { DataRow } from '../types';
import { amazonImageUrl, formatNumber } from '../utils';
import { ImageLightbox, ProductImageThumb } from './ProductImageThumb';

interface StockHealthProps {
    rows: DataRow[];
}

type Bucket = 'risk' | 'warn' | 'ok' | 'over';

type StockRow = {
    key: string;
    asin: string;
    name: string;
    shop: string;
    stock: number;
    stockDate: string;
    avgDaily: number;
    days: number;
    sellOutDate: string;
    bucket: Bucket;
};

const DAY_MS = 86400000;
const iso = (date: Date) => date.toISOString().slice(0, 10);

/** 可售天数 = 最新可售库存 ÷ 近 28 天日均销量；没有销量记为无穷（积压） */
const BUCKETS: Record<Bucket, { label: string; chip: string; dot: string; hint: string }> = {
    risk: { label: '断货风险', chip: 'bg-rose-50 text-rose-700 ring-rose-100', dot: 'bg-rose-500', hint: '不足 21 天' },
    warn: { label: '需要补货', chip: 'bg-amber-50 text-amber-700 ring-amber-100', dot: 'bg-amber-500', hint: '21–45 天' },
    ok: { label: '健康', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-100', dot: 'bg-emerald-500', hint: '45–90 天' },
    over: { label: '积压', chip: 'bg-slate-100 text-slate-600 ring-slate-200', dot: 'bg-slate-400', hint: '90 天以上' },
};

export const StockHealth: React.FC<StockHealthProps> = ({ rows }) => {
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
    const { list, counts, maxDate } = useMemo(() => {
        if (rows.length === 0) return { list: [] as StockRow[], counts: { risk: 0, warn: 0, ok: 0, over: 0 }, maxDate: '' };

        const maxDate = rows.reduce((latest, row) => (row.date > latest ? row.date : latest), '');
        const windowStart = iso(new Date(Date.parse(`${maxDate}T00:00:00Z`) - 27 * DAY_MS));
        // 按「窗口内实际有数据的天数」算日均：只选了半个月时，不能拿 28 天做分母
        const windowDates = new Set<string>();
        for (const row of rows) if (row.date >= windowStart) windowDates.add(row.date);
        const windowDays = Math.max(1, windowDates.size);

        const map = new Map<string, { asin: string; name: string; shop: string; qty: number; stock: number; stockDate: string }>();
        for (const row of rows) {
            if (row.date < windowStart) continue;
            const key = `${row.shop_name}|${row.child_asin}`;
            const existing = map.get(key) || { asin: row.child_asin, name: row.product_name || row.child_asin, shop: row.shop_name || '', qty: 0, stock: 0, stockDate: '' };
            existing.qty += Number(row.sales_quantity) || 0;
            // 库存是快照：取窗口内最新一天的值
            if (row.date >= existing.stockDate) {
                existing.stock = Number(row.fba_sellable_qty) || 0;
                existing.stockDate = row.date;
            }
            map.set(key, existing);
        }

        const list: StockRow[] = [];
        const counts = { risk: 0, warn: 0, ok: 0, over: 0 };
        for (const [key, item] of map) {
            const avgDaily = item.qty / windowDays;
            const days = avgDaily > 0 ? item.stock / avgDaily : Number.POSITIVE_INFINITY;
            const bucket: Bucket = !Number.isFinite(days) ? 'over' : days < 21 ? 'risk' : days < 45 ? 'warn' : days <= 90 ? 'ok' : 'over';
            counts[bucket] += 1;
            list.push({
                key,
                asin: item.asin,
                name: item.name,
                shop: item.shop,
                stock: item.stock,
                stockDate: item.stockDate,
                avgDaily: Number(avgDaily.toFixed(2)),
                days,
                sellOutDate: Number.isFinite(days) ? iso(new Date(Date.parse(`${maxDate}T00:00:00Z`) + days * DAY_MS)) : '',
                bucket,
            });
        }
        list.sort((a, b) => (a.days === b.days ? b.stock - a.stock : a.days - b.days));
        return { list, counts, maxDate };
    }, [rows]);

    if (!list.length) {
        return (
            <section id="stock" className="rounded-3xl border border-white/80 bg-white/90 p-5 shadow-[0_20px_60px_-45px_rgba(15,23,42,0.5)] backdrop-blur-xl">
                <h2 className="flex items-center gap-2 text-base font-bold text-slate-800"><Boxes className="h-4 w-4 text-sky-500" />库存健康</h2>
                <p className="mt-1 text-xs text-slate-500">当前区间没有可售库存数据（需要云端日明细；本地周报/月报不含库存快照）。</p>
            </section>
        );
    }

    const visible = list.slice(0, 60);

    return (
        <section id="stock" className="rounded-3xl border border-white/80 bg-white/90 p-5 shadow-[0_20px_60px_-45px_rgba(15,23,42,0.5)] backdrop-blur-xl">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="flex items-center gap-2 text-base font-bold text-slate-800"><Boxes className="h-4 w-4 text-sky-500" />库存健康</h2>
                    <p className="mt-1 text-xs text-slate-500">可售天数 = 可售库存 ÷ 近 28 天日均销量（截至 {maxDate}）。红色表示按当前速度不足 21 天就会卖完。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {(['risk', 'warn', 'ok', 'over'] as Bucket[]).map(bucket => (
                        <span key={bucket} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${BUCKETS[bucket].chip}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${BUCKETS[bucket].dot}`} />
                            {BUCKETS[bucket].label} {counts[bucket]}
                        </span>
                    ))}
                </div>
            </div>

            {counts.risk > 0 && (
                <div className="mt-3 flex items-start gap-2 rounded-2xl border border-rose-100 bg-rose-50/70 px-3 py-2 text-[11px] text-rose-700">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{counts.risk} 个 ASIN 会在 21 天内卖完，优先安排补货；{counts.over} 个 ASIN 超过 90 天，占用资金可考虑清货。</span>
                </div>
            )}

            <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-100">
                <table className="min-w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                        <tr>
                            <th className="px-3 py-2 text-left font-medium">ASIN / 品名</th>
                            <th className="px-3 py-2 text-right font-medium">可售库存</th>
                            <th className="px-3 py-2 text-right font-medium">日均销量</th>
                            <th className="px-3 py-2 text-right font-medium">可售天数</th>
                            <th className="px-3 py-2 text-right font-medium">预计卖完</th>
                            <th className="px-3 py-2 text-right font-medium">状态</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {visible.map(row => (
                            <tr key={row.key} className="hover:bg-slate-50/70">
                                <td className="px-3 py-2">
                                    <div className="flex items-center gap-2">
                                        {(() => {
                                            const imageUrl = amazonImageUrl(row.asin);
                                            return imageUrl ? <ProductImageThumb url={imageUrl} onEnlarge={setLightboxUrl} /> : null;
                                        })()}
                                        <div className="min-w-0">
                                            <div className="font-mono text-[11px] text-slate-700">{row.asin}</div>
                                            <div className="truncate text-[11px] text-slate-400">{row.name}{row.shop ? ` · ${row.shop}` : ''}</div>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">{formatNumber(row.stock)}</td>
                                <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-600">{row.avgDaily}</td>
                                <td className={`px-3 py-2 text-right font-mono tabular-nums font-semibold ${
                                    row.bucket === 'risk' ? 'text-rose-600' : row.bucket === 'warn' ? 'text-amber-600' : row.bucket === 'ok' ? 'text-emerald-600' : 'text-slate-500'
                                }`}>
                                    {Number.isFinite(row.days) ? `${Math.round(row.days)} 天` : '无销量'}
                                </td>
                                <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-500">{row.sellOutDate || '—'}</td>
                                <td className="px-3 py-2 text-right">
                                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${BUCKETS[row.bucket].chip}`}>
                                        {row.bucket === 'risk' ? <PackageX className="h-3 w-3" /> : row.bucket === 'over' ? <Boxes className="h-3 w-3" /> : <PackageCheck className="h-3 w-3" />}
                                        {BUCKETS[row.bucket].label}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <p className="mt-2 text-[10px] text-slate-400">
                共 {list.length} 个 ASIN，按可售天数从少到多排序{list.length > visible.length ? `，仅展示前 ${visible.length} 个` : ''}。
                库存取区间最后一天的可售快照；新上架、无销量但仍有库存的 ASIN 会归入「积压」。
            </p>
            <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
        </section>
    );
};

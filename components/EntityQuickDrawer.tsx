import React, { useMemo } from 'react';
import { DataRow } from '../types';
import { formatMoneyNoDecimals, formatNumber, formatPercent } from '../utils';
import { RightDrawer } from './ui/RightDrawer';

export interface QuickDrawerTarget {
  kind: 'shop' | 'asin';
  key: string;
}

interface EntityQuickDrawerProps {
  target: QuickDrawerTarget | null;
  periodLabel: string;
  rows: DataRow[];
  onClose: () => void;
  onFocusFilter: (kind: 'shop' | 'asin', key: string) => void;
  onOpenFullDetail: () => void;
}

export const EntityQuickDrawer: React.FC<EntityQuickDrawerProps> = ({
  target,
  periodLabel,
  rows,
  onClose,
  onFocusFilter,
  onOpenFullDetail,
}) => {
  const stats = useMemo(() => {
    if (!target) return null;
    const matched = rows.filter((r) =>
      target.kind === 'shop'
        ? r.shop_name === target.key
        : r.child_asin === target.key || r.parent_asin === target.key
    );
    let sales = 0;
    let profit = 0;
    let qty = 0;
    let adSpend = 0;
    let sessions = 0;
    let procurement = 0;
    let fbaFee = 0;
    let commission = 0;
    let firstMile = 0;
    let storageAndRefund = 0;
    let productName = '';

    for (const r of matched) {
      sales += r.sales_amount || 0;
      profit += r.gross_profit || 0;
      qty += r.sales_quantity || 0;
      adSpend += r.ad_spend || 0;
      sessions += r.sessions || 0;
      procurement += Math.abs(r.procurement_cost || 0);
      fbaFee += Math.abs(r.fba_fee || 0);
      commission += Math.abs(r.platform_commission || 0);
      firstMile += Math.abs(r.first_mile_cost || 0);
      storageAndRefund += Math.abs(r.storage_fee || 0) + Math.abs(r.refund_cost || 0);
      if (!productName && r.product_name) productName = r.product_name;
    }

    const margin = sales > 0 ? profit / sales : 0;
    const acoas = sales > 0 ? adSpend / sales : 0;
    const cvr = sessions > 0 ? qty / sessions : 0;

    return {
      count: matched.length,
      productName,
      sales,
      profit,
      qty,
      adSpend,
      margin,
      acoas,
      cvr,
      procurement,
      fbaFee,
      commission,
      firstMile,
      storageAndRefund,
    };
  }, [target, rows]);

  return (
    <RightDrawer
      open={Boolean(target)}
      onClose={onClose}
      subtitle={`${target?.kind === 'shop' ? '店铺' : 'ASIN'} 详情 · ${periodLabel}`}
      title={target?.key || ''}
      footer={
        target ? (
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                onFocusFilter(target.kind, target.key);
                onClose();
              }}
              className="flex-1 rounded-xl bg-[#4f46e5] px-4 py-2.5 text-xs font-semibold text-white shadow-[0_6px_16px_-6px_rgba(79,70,229,0.6)] transition hover:bg-[#4338ca]"
            >
              聚焦此{target.kind === 'shop' ? '店铺' : ' ASIN'}筛选
            </button>
            <button
              type="button"
              onClick={() => {
                onOpenFullDetail();
                onClose();
              }}
              className="rounded-xl border border-black/[0.08] bg-white px-4 py-2.5 text-xs font-medium text-[#1d1d1f] transition hover:bg-black/[0.04] dark:border-white/[0.1] dark:bg-[#191c24] dark:text-[#f5f5f7]"
            >
              完整多维分析
            </button>
          </div>
        ) : null
      }
    >
      {stats && (
        <div className="space-y-6">
          {stats.productName && (
            <div className="text-xs leading-relaxed text-[#424245] dark:text-[#c7c9d1]">{stats.productName}</div>
          )}

          <div className="grid grid-cols-3 gap-2.5">
            {[
              { label: '销售额', value: formatMoneyNoDecimals(stats.sales), tone: '' },
              {
                label: '毛利额',
                value: formatMoneyNoDecimals(stats.profit),
                tone: stats.profit < 0 ? 'text-[#ef4444]' : 'text-[#10b981]',
              },
              {
                label: '毛利率',
                value: formatPercent(stats.margin),
                tone: stats.margin < 0.08 ? 'text-[#ef4444]' : '',
              },
              { label: '广告占比', value: formatPercent(stats.acoas), tone: stats.acoas > 0.15 ? 'text-[#f59e0b]' : '' },
              { label: '销量', value: formatNumber(stats.qty), tone: '' },
              { label: '转化率', value: formatPercent(stats.cvr), tone: '' },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl bg-[#f5f5f7] p-3.5 dark:bg-[#151821]">
                <div className="text-[11px] text-[#86868b] dark:text-[#a7abb8]">{item.label}</div>
                <div className={`mt-1 text-lg font-bold num-tabular text-[#1d1d1f] dark:text-[#f5f5f7] ${item.tone}`}>
                  {item.value}
                </div>
              </div>
            ))}
          </div>

          <div>
            <h3 className="mb-2.5 text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">毛利去哪了</h3>
            <div className="divide-y divide-black/[0.06] rounded-2xl border border-black/[0.06] px-4 text-[13px] dark:divide-white/[0.08] dark:border-white/[0.08]">
              {[
                { label: '采购成本', value: stats.procurement },
                { label: 'FBA 配送费', value: stats.fbaFee },
                { label: '广告花费', value: stats.adSpend },
                { label: '平台佣金', value: stats.commission },
                { label: '头程运费', value: stats.firstMile },
                { label: '仓储与退款', value: stats.storageAndRefund },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between py-2.5">
                  <span className="text-[#424245] dark:text-[#c7c9d1]">{row.label}</span>
                  <span className="font-semibold num-tabular text-[#1d1d1f] dark:text-[#f5f5f7]">
                    −{formatMoneyNoDecimals(row.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </RightDrawer>
  );
};

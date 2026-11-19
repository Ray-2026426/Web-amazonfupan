import React, { useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { DataRow, InventoryRow } from '../types';
import { formatMoneyNoDecimals, formatNumber } from '../utils';
import { SurfaceCard } from './ui/SurfaceCard';

interface OverviewQuickRanksProps {
  rows: DataRow[];
  inventoryRows: InventoryRow[];
  onSelectEntity: (kind: 'shop' | 'asin', key: string) => void;
  onGoToTab: (tab: 'profit' | 'inventory') => void;
}

export const OverviewQuickRanks: React.FC<OverviewQuickRanksProps> = ({
  rows,
  inventoryRows,
  onSelectEntity,
  onGoToTab,
}) => {
  const { topShops, topAsins, stockSummary } = useMemo(() => {
    const shopMap = new Map<string, { profit: number; sales: number }>();
    const asinMap = new Map<string, { profit: number; sales: number; name: string }>();

    for (const r of rows) {
      if (r.shop_name) {
        const cur = shopMap.get(r.shop_name) || { profit: 0, sales: 0 };
        cur.profit += r.gross_profit || 0;
        cur.sales += r.sales_amount || 0;
        shopMap.set(r.shop_name, cur);
      }
      const asin = r.child_asin || r.parent_asin;
      if (asin) {
        const cur = asinMap.get(asin) || { profit: 0, sales: 0, name: r.product_name || '' };
        cur.profit += r.gross_profit || 0;
        cur.sales += r.sales_amount || 0;
        if (!cur.name && r.product_name) cur.name = r.product_name;
        asinMap.set(asin, cur);
      }
    }

    const topShops = Array.from(shopMap.entries())
      .sort((a, b) => b[1].profit - a[1].profit)
      .slice(0, 4);
    const topAsins = Array.from(asinMap.entries())
      .sort((a, b) => b[1].profit - a[1].profit)
      .slice(0, 4);

    let lowStock = 0;
    let normalStock = 0;
    let overaged = 0;
    let totalSellable = 0;
    for (const inv of inventoryRows) {
      const sellable = Number(inv.fba_sellable_qty || 0);
      totalSellable += sellable;
      const aged = Number(inv.age_180_270 || 0) + Number(inv.age_270_365 || 0) + Number(inv.age_365_plus || 0);
      if (aged > 0) overaged += 1;
      if (sellable > 0 && sellable < 50) lowStock += 1;
      else if (sellable >= 50) normalStock += 1;
    }

    return {
      topShops,
      topAsins,
      stockSummary: { lowStock, normalStock, overaged, totalSellable, hasData: inventoryRows.length > 0 },
    };
  }, [rows, inventoryRows]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Top 店铺 */}
      <SurfaceCard>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[16px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
            毛利贡献 Top 店铺
          </h3>
          <button
            type="button"
            onClick={() => onGoToTab('profit')}
            className="inline-flex items-center gap-0.5 text-xs font-medium text-[#4f46e5] hover:underline dark:text-indigo-400"
          >
            利润表 <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="divide-y divide-black/[0.06] dark:divide-white/[0.08]">
          {topShops.length === 0 ? (
            <div className="py-6 text-center text-xs text-[#86868b]">当前筛选暂无店铺数据</div>
          ) : (
            topShops.map(([shop, stats]) => (
              <button
                key={shop}
                type="button"
                onClick={() => onSelectEntity('shop', shop)}
                className="flex w-full items-center justify-between gap-2 py-2.5 text-left text-[13px] transition hover:text-[#4f46e5] dark:hover:text-indigo-300"
              >
                <span className="truncate text-[#424245] dark:text-[#c7c9d1]">{shop}</span>
                <span
                  className={`shrink-0 font-semibold num-tabular ${
                    stats.profit < 0 ? 'text-[#ef4444]' : 'text-[#1d1d1f] dark:text-[#f5f5f7]'
                  }`}
                >
                  {formatMoneyNoDecimals(stats.profit)}
                </span>
              </button>
            ))
          )}
        </div>
      </SurfaceCard>

      {/* Top ASIN */}
      <SurfaceCard>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[16px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
            毛利贡献 Top ASIN
          </h3>
          <button
            type="button"
            onClick={() => onGoToTab('profit')}
            className="inline-flex items-center gap-0.5 text-xs font-medium text-[#4f46e5] hover:underline dark:text-indigo-400"
          >
            全部 <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="divide-y divide-black/[0.06] dark:divide-white/[0.08]">
          {topAsins.length === 0 ? (
            <div className="py-6 text-center text-xs text-[#86868b]">当前筛选暂无 ASIN 数据</div>
          ) : (
            topAsins.map(([asin, stats]) => (
              <button
                key={asin}
                type="button"
                onClick={() => onSelectEntity('asin', asin)}
                className="flex w-full items-center justify-between gap-2 py-2.5 text-left text-[13px] transition hover:text-[#4f46e5] dark:hover:text-indigo-300"
              >
                <span className="truncate text-[#424245] dark:text-[#c7c9d1]">
                  {asin}
                  {stats.name ? <span className="ml-1.5 text-[#86868b]">· {stats.name}</span> : null}
                </span>
                <span
                  className={`shrink-0 font-semibold num-tabular ${
                    stats.profit < 0 ? 'text-[#ef4444]' : 'text-[#1d1d1f] dark:text-[#f5f5f7]'
                  }`}
                >
                  {formatMoneyNoDecimals(stats.profit)}
                </span>
              </button>
            ))
          )}
        </div>
      </SurfaceCard>

      {/* 库存健康快览 */}
      <SurfaceCard>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[16px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
            库存健康
          </h3>
          <button
            type="button"
            onClick={() => onGoToTab('inventory')}
            className="inline-flex items-center gap-0.5 text-xs font-medium text-[#4f46e5] hover:underline dark:text-indigo-400"
          >
            去库存页 <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
        {!stockSummary.hasData ? (
          <div className="py-6 text-center text-xs text-[#86868b]">尚未加载库存快照</div>
        ) : (
          <div className="divide-y divide-black/[0.06] text-[13px] dark:divide-white/[0.08]">
            <div className="flex items-center justify-between py-2.5">
              <span className="text-[#424245] dark:text-[#c7c9d1]">低库存预警（&lt; 50 件）</span>
              <span className="font-semibold text-[#ef4444] num-tabular">{stockSummary.lowStock} 个</span>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-[#424245] dark:text-[#c7c9d1]">健康在库 SKU</span>
              <span className="font-semibold text-[#1d1d1f] num-tabular dark:text-[#f5f5f7]">
                {stockSummary.normalStock} 个
              </span>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-[#424245] dark:text-[#c7c9d1]">长库龄（&gt; 180 天）</span>
              <span className="font-semibold text-[#f59e0b] num-tabular">{stockSummary.overaged} 个</span>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-[#424245] dark:text-[#c7c9d1]">FBA 可售总件数</span>
              <span className="font-semibold text-[#1d1d1f] num-tabular dark:text-[#f5f5f7]">
                {formatNumber(stockSummary.totalSellable)}
              </span>
            </div>
          </div>
        )}
      </SurfaceCard>
    </div>
  );
};

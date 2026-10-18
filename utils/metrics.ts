import type { AggregatedData, InventoryAggregated } from '../types';

export type MetricId = 'gross_profit' | 'sales_amount' | 'gross_margin' | 'ad_spend' | 'ad_share' | 'acos' | 'refund_rate' | 'conversion_rate' | 'avg_ticket' | 'aged_inventory_share';
export type MetricContext = { current: AggregatedData; inventory?: InventoryAggregated | null };
type MetricDefinition = { label: string; definition: string; unit: 'money' | 'percent'; value: (ctx: MetricContext) => number | null };
const divide = (a: number, b: number) => b === 0 ? null : a / b;

/** Shared metric meaning for dashboard, issue rules and exports. Ratios with no denominator are unknown, not zero. */
export const METRICS: Record<MetricId, MetricDefinition> = {
  gross_profit: { label: '毛利额', definition: '导入业绩表中订单毛利润的汇总；具体成本范围以源报表口径为准。', unit: 'money', value: ({ current }) => current.gross_profit },
  sales_amount: { label: '销售额', definition: '当前筛选范围内的销售金额。', unit: 'money', value: ({ current }) => current.sales_amount },
  gross_margin: { label: '毛利率', definition: '毛利额 ÷ 销售额；销售额为零时无可比口径。', unit: 'percent', value: ({ current }) => divide(current.gross_profit, current.sales_amount) },
  ad_spend: { label: '广告花费', definition: '当前筛选范围内的广告支出。', unit: 'money', value: ({ current }) => current.ad_spend },
  ad_share: { label: '广告占比', definition: '广告花费 ÷ 总销售额。', unit: 'percent', value: ({ current }) => divide(current.ad_spend, current.sales_amount) },
  acos: { label: 'ACoS', definition: '广告花费 ÷ 广告销售额。', unit: 'percent', value: ({ current }) => divide(current.ad_spend, current.ad_sales) },
  refund_rate: { label: '退款成本率', definition: '退款成本 ÷ 总销售额。', unit: 'percent', value: ({ current }) => divide(current.refund_cost, current.sales_amount) },
  conversion_rate: { label: '会话转化率', definition: '销量 ÷ Sessions。', unit: 'percent', value: ({ current }) => divide(current.sales_quantity, current.sessions) },
  avg_ticket: { label: '客单价', definition: '销售额 ÷ 销量。', unit: 'money', value: ({ current }) => divide(current.sales_amount, current.sales_quantity) },
  aged_inventory_share: { label: '180 天以上库龄成本占比', definition: '180 天以上 FBA 库存成本 ÷ FBA 总库存成本。', unit: 'percent', value: ({ inventory }) => inventory ? divide(inventory.age_181_270_cost + inventory.age_271_330_cost + inventory.age_331_365_cost + inventory.age_365_plus_cost, inventory.fba_total_cost) : null },
};

export const metricValue = (id: MetricId, ctx: MetricContext) => METRICS[id].value(ctx);

/**
 * 每日明细下载列。
 *
 * 列名与顺序严格对齐业务方提供的《项目业绩-月维度.xlsx》：
 * 除把「年份 / 月份」换成日粒度下的「日期 + 年份 + 月份」外，其余 47 列的名称、
 * 顺序与含义保持一致；参考表没有的「店铺ID / 币种」放在最后，方便去重与对账，
 * 不影响前面列的位置。
 *
 * 比率列（CVR / CTR / CPC / ROAS / ACOS / ACoAS / ASoAS / 自然CVR）按当日分子分母现算，
 * 与参考表的计算口径一致。
 */
export const DAILY_EXPORT_COLUMNS = [
  ['date', '日期'],
  ['year', '年份'],
  ['month', '月份'],
  ['asin', 'ASIN'],
  ['parent_asin', '父ASIN'],
  ['shop_name', '店铺'],
  ['country', '国家'],
  ['manager', '负责人'],
  ['product_name', '品名'],
  ['sub_category', '二级分类'],
  ['brand', '品牌'],
  ['sales_quantity', '销量'],
  ['sales_amount', '销售额'],
  ['order_quantity', '订单量'],
  ['refund_cost', '退款金额'],
  ['rating', '评分'],
  ['review_count', '评论数'],
  ['gross_profit', '订单毛利润'],
  ['fba_sellable_qty', 'FBA-可售'],
  ['sessions', 'Sessions-Total'],
  ['cvr', 'CVR'],
  ['quantity_cvr', '销量CVR'],
  ['ad_spend', '广告花费'],
  ['sp_spend', 'SP广告费'],
  ['sd_spend', 'SD广告费'],
  ['sb_spend', 'SB广告费'],
  ['sbv_spend', 'SBV广告费'],
  ['ad_sales', '广告销售额'],
  ['sp_sales', 'SP广告销售额'],
  ['sd_sales', 'SD广告销售额'],
  ['sb_sales', 'SB广告销售额'],
  ['sbv_sales', 'SBV广告销售额'],
  ['ad_orders', '广告订单量'],
  ['impressions', '展示'],
  ['clicks', '点击'],
  ['ctr', 'CTR'],
  ['ad_cvr', '广告CVR'],
  ['cpc', 'CPC'],
  ['roas', 'ROAS'],
  ['acos', 'ACOS'],
  ['acoas', 'ACoAS'],
  ['asoas', 'ASoAS'],
  ['natural_clicks', '自然点击量'],
  ['natural_orders', '自然订单量'],
  ['natural_cvr', '自然CVR'],
  ['first_mile_cost', '头程费用'],
  ['fba_fee', 'FBA费用'],
  ['storage_fee', '仓储费用'],
  ['procurement_cost', '采购费用'],
  ['platform_commission', '佣金费用'],
  ['fba_international_fee', 'FBA国际运费'],
  ['adjusted_gross_profit', '修正后毛利'],
  ['sid', '店铺ID'],
  ['currency', '币种'],
] as const;

const textKeys = new Set([
  'date', 'year', 'month', 'asin', 'parent_asin', 'shop_name', 'sid', 'country',
  'manager', 'product_name', 'sub_category', 'brand', 'currency',
]);
const number = (row: Record<string, unknown>, key: string) => Number(row[key] ?? 0);
const divide = (a: number, b: number) => (b ? Number((a / b).toFixed(6)) : '');

function field(row: Record<string, unknown>, key: string): unknown {
  const n = (name: string) => number(row, name);
  switch (key) {
    // 参考表用「2025年 / 1月」这种中文写法，这里按行内日期派生，保持同样的观感
    case 'year': {
      const date = String(row.date || '');
      return date.length >= 4 ? `${date.slice(0, 4)}年` : '';
    }
    case 'month': {
      const date = String(row.date || '');
      return date.length >= 7 ? `${Number(date.slice(5, 7))}月` : '';
    }
    case 'cvr': return divide(n('order_quantity'), n('sessions'));
    case 'quantity_cvr': return divide(n('sales_quantity'), n('sessions'));
    case 'ctr': return divide(n('clicks'), n('impressions'));
    case 'ad_cvr': return divide(n('ad_orders'), n('clicks'));
    case 'cpc': return divide(n('ad_spend'), n('clicks'));
    case 'roas': return divide(n('ad_sales'), n('ad_spend'));
    case 'acos': return divide(n('ad_spend'), n('ad_sales'));
    case 'acoas': return divide(n('ad_spend'), n('sales_amount'));
    case 'asoas': return divide(n('ad_sales'), n('sales_amount'));
    case 'natural_cvr': return divide(n('natural_orders'), n('natural_clicks'));
    // 与看板默认口径一致：原毛利 + FBA 国际运费绝对值
    case 'adjusted_gross_profit': return n('gross_profit') + Math.abs(n('fba_international_fee'));
    default: return row[key];
  }
}

function csvCell(value: unknown, numeric: boolean): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (!numeric && /^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** 云端字段映射里的下载列名覆盖：{ 列 key → 显示名 } */
export type ExportLabels = Record<string, string>;

const labelOf = (key: string, fallback: string, labels?: ExportLabels) => {
  const custom = labels?.[key]?.trim();
  return custom || fallback;
};

export function dailyCsvHeader(labels?: ExportLabels): string {
  return DAILY_EXPORT_COLUMNS.map(([key, title]) => csvCell(labelOf(key, title, labels), false)).join(',') + '\r\n';
}

export function dailyCsvRows(rows: Record<string, unknown>[]): string {
  return rows.map((row) => DAILY_EXPORT_COLUMNS.map(([key]) => csvCell(field(row, key), !textKeys.has(key))).join(',')).join('\r\n') + (rows.length ? '\r\n' : '');
}

/** Excel 用：返回「表头 + 数据」的二维数组，数值保持 number，比率保持数值（Excel 里可直接算） */
export function dailyExportMatrix(rows: Record<string, unknown>[], labels?: ExportLabels): unknown[][] {
  const header = DAILY_EXPORT_COLUMNS.map(([key, title]) => labelOf(key, title, labels));
  const body = rows.map((row) => DAILY_EXPORT_COLUMNS.map(([key]) => {
    const value = field(row, key);
    if (value === '' || value === null || value === undefined) return '';
    return textKeys.has(key) ? String(value) : value;
  }));
  return [header, ...body];
}

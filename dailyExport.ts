/** 每日下载列以月/周模板为参照；比率按当日分子/分母现算。 */
export const DAILY_EXPORT_COLUMNS = [
  ['date', '日期'], ['asin', 'ASIN'], ['parent_asin', '父ASIN'], ['shop_name', '店铺'],
  ['sid', '店铺ID'], ['country', '国家'], ['manager', '负责人'], ['product_name', '品名'],
  ['sub_category', '二级分类'], ['brand', '品牌'], ['currency', '币种'],
  ['sales_quantity', '销量'], ['sales_amount', '销售额'], ['order_quantity', '订单量'],
  ['refund_cost', '退款金额'], ['rating', '评分'], ['review_count', '评论数'],
  ['gross_profit', '订单毛利润'], ['gross_margin', '毛利率'],
  ['fba_sellable_qty', 'FBA-可售'], ['sessions', 'Sessions-Total'],
  ['cvr', 'CVR'], ['quantity_cvr', '销量CVR'],
  ['ad_spend', '广告花费'], ['sp_spend', 'SP广告费'], ['sd_spend', 'SD广告费'],
  ['sb_spend', 'SB广告费'], ['sbv_spend', 'SBV广告费'],
  ['ad_sales', '广告销售额'], ['sp_sales', 'SP广告销售额'],
  ['sd_sales', 'SD广告销售额'], ['sb_sales', 'SB广告销售额'],
  ['sbv_sales', 'SBV广告销售额'], ['ad_orders', '广告订单量'],
  ['impressions', '展示'], ['clicks', '点击'], ['ctr', 'CTR'],
  ['ad_cvr', '广告CVR'], ['cpc', 'CPC'], ['roas', 'ROAS'],
  ['acos', 'ACOS'], ['acoas', 'ACoAS'], ['asoas', 'ASoAS'],
  ['natural_clicks', '自然点击量'], ['natural_orders', '自然订单量'],
  ['natural_cvr', '自然CVR'], ['first_mile_cost', '头程费用'],
  ['fba_fee', 'FBA费用'], ['storage_fee', '仓储费用'],
  ['procurement_cost', '采购费用'], ['platform_commission', '佣金费用'],
] as const;

const textKeys = new Set(['date', 'asin', 'parent_asin', 'shop_name', 'sid', 'country', 'manager', 'product_name', 'sub_category', 'brand', 'currency']);
const number = (row: Record<string, unknown>, key: string) => Number(row[key] ?? 0);
const divide = (a: number, b: number) => b ? Number((a / b).toFixed(6)) : '';

function field(row: Record<string, unknown>, key: string): unknown {
  const n = (name: string) => number(row, name);
  switch (key) {
    case 'gross_margin': return divide(n('gross_profit'), n('sales_amount'));
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

export function dailyCsvHeader(): string {
  return DAILY_EXPORT_COLUMNS.map(([, title]) => csvCell(title, false)).join(',') + '\r\n';
}

export function dailyCsvRows(rows: Record<string, unknown>[]): string {
  return rows.map((row) => DAILY_EXPORT_COLUMNS.map(([key]) => csvCell(field(row, key), !textKeys.has(key))).join(',')).join('\r\n') + (rows.length ? '\r\n' : '');
}

/**
 * 字段映射的唯一定义（同步脚本、管理 API、后台 UI 共用）
 *
 * lingxing_field 的写法：
 *   pp.xxx   取自「产品表现 ASIN 列表」的返回行
 *   op.xxx   取自「订单利润」按 sid|asin 归并后的成本对象
 *
 * 取值语法：
 *   brands[]                          数组里第一个非空元素
 *   parent_asins[].parent_asin        数组里第一个非空的子字段
 *   seller_store_countries[0].country 指定下标
 *   categories[]@level(2)             取到值后按分隔符切分取第 2 段
 *   price_list[].local_name@max(volume) 取 volume 最大的元素
 *
 * 比率列（CVR / 销量CVR / CTR / 广告CVR / CPC / ROAS / ACOS / ACoAS / ASoAS / 自然CVR）
 * 由分子分母现算，不参与映射。
 */

export const FIELD_GROUPS = [
  { key: 'base', label: '基础信息' },
  { key: 'revenue', label: '销量与收入' },
  { key: 'cost', label: '成本与费用' },
  { key: 'traffic', label: '流量与库存' },
  { key: 'ads', label: '广告' },
];

export const FIELD_MAPPINGS = [
  // 基础信息
  { web_field: 'asin', web_label: 'ASIN', export_label: 'ASIN', lingxing_field: 'pp.asin', group: 'base' },
  { web_field: 'parent_asin', web_label: '父ASIN', export_label: '父ASIN', lingxing_field: 'pp.parent_asins[].parent_asin', group: 'base' },
  { web_field: 'shop_name', web_label: '店铺', export_label: '店铺', lingxing_field: 'pp.seller_store_countries[].seller_name', group: 'base' },
  { web_field: 'country', web_label: '国家', export_label: '国家', lingxing_field: 'pp.seller_store_countries[].country', group: 'base' },
  { web_field: 'manager', web_label: '负责人', export_label: '负责人', lingxing_field: 'pp.principal_names[]', group: 'base' },
  { web_field: 'product_name', web_label: '品名', export_label: '品名', lingxing_field: 'pp.price_list[].local_name@max(volume)', group: 'base' },
  { web_field: 'sub_category', web_label: '二级分类', export_label: '二级分类', lingxing_field: 'pp.categories[]@level(2)', group: 'base' },
  { web_field: 'brand', web_label: '品牌', export_label: '品牌', lingxing_field: 'pp.brands[]', group: 'base' },

  // 销量与收入
  { web_field: 'sales_quantity', web_label: '销量', export_label: '销量', lingxing_field: 'pp.volume', group: 'revenue' },
  { web_field: 'sales_amount', web_label: '销售额', export_label: '销售额', lingxing_field: 'pp.amount', group: 'revenue' },
  { web_field: 'order_quantity', web_label: '订单量', export_label: '订单量', lingxing_field: 'pp.order_items', group: 'revenue' },
  { web_field: 'gross_profit', web_label: '订单毛利润', export_label: '订单毛利润', lingxing_field: 'op.gross_profit', group: 'revenue' },

  // 成本与费用
  { web_field: 'refund_cost', web_label: '退款金额', export_label: '退款金额', lingxing_field: 'op.refund_amount', group: 'cost' },
  { web_field: 'first_mile_cost', web_label: '头程费用', export_label: '头程费用', lingxing_field: 'op.logistics_costs', group: 'cost' },
  { web_field: 'fba_fee', web_label: 'FBA费用', export_label: 'FBA费用', lingxing_field: 'op.fulfillment_fee', group: 'cost' },
  { web_field: 'storage_fee', web_label: '仓储费用', export_label: '仓储费用', lingxing_field: 'op.fba_storage_fee', group: 'cost' },
  { web_field: 'procurement_cost', web_label: '采购费用', export_label: '采购费用', lingxing_field: 'op.purchase_costs', group: 'cost' },
  { web_field: 'platform_commission', web_label: '佣金费用', export_label: '佣金费用', lingxing_field: 'op.selling_fee', group: 'cost' },

  // 流量与库存
  { web_field: 'sessions', web_label: 'Sessions', export_label: 'Sessions-Total', lingxing_field: 'pp.sessions_total', group: 'traffic' },
  { web_field: 'fba_sellable_qty', web_label: 'FBA 可售', export_label: 'FBA-可售', lingxing_field: 'pp.afn_fulfillable_quantity', group: 'traffic' },
  { web_field: 'impressions', web_label: '展示', export_label: '展示', lingxing_field: 'pp.impressions', group: 'traffic' },
  { web_field: 'clicks', web_label: '点击', export_label: '点击', lingxing_field: 'pp.clicks', group: 'traffic' },
  { web_field: 'natural_clicks', web_label: '自然点击量', export_label: '自然点击量', lingxing_field: 'pp.nature_click', group: 'traffic' },
  { web_field: 'natural_orders', web_label: '自然订单量', export_label: '自然订单量', lingxing_field: 'pp.nature_order_items', group: 'traffic' },
  { web_field: 'rating', web_label: '评分', export_label: '评分', lingxing_field: 'pp.avg_star', group: 'traffic' },
  { web_field: 'review_count', web_label: '评论数', export_label: '评论数', lingxing_field: 'pp.reviews_count', group: 'traffic' },

  // 广告
  { web_field: 'ad_spend', web_label: '广告花费', export_label: '广告花费', lingxing_field: 'pp.spend', group: 'ads' },
  { web_field: 'sp_spend', web_label: 'SP 广告费', export_label: 'SP广告费', lingxing_field: 'pp.ads_sp_cost', group: 'ads' },
  { web_field: 'sd_spend', web_label: 'SD 广告费', export_label: 'SD广告费', lingxing_field: 'pp.ads_sd_cost', group: 'ads' },
  { web_field: 'sb_spend', web_label: 'SB 广告费', export_label: 'SB广告费', lingxing_field: 'pp.shared_ads_sb_cost', group: 'ads' },
  { web_field: 'sbv_spend', web_label: 'SBV 广告费', export_label: 'SBV广告费', lingxing_field: 'pp.shared_ads_sbv_cost', group: 'ads' },
  { web_field: 'ad_sales', web_label: '广告销售额', export_label: '广告销售额', lingxing_field: 'pp.ad_sales_amount', group: 'ads' },
  { web_field: 'sp_sales', web_label: 'SP 广告销售额', export_label: 'SP广告销售额', lingxing_field: 'pp.ads_sp_sales', group: 'ads' },
  { web_field: 'sd_sales', web_label: 'SD 广告销售额', export_label: 'SD广告销售额', lingxing_field: 'pp.ads_sd_sales', group: 'ads' },
  { web_field: 'sb_sales', web_label: 'SB 广告销售额', export_label: 'SB广告销售额', lingxing_field: 'pp.shared_ads_sb_sales', group: 'ads' },
  { web_field: 'sbv_sales', web_label: 'SBV 广告销售额', export_label: 'SBV广告销售额', lingxing_field: 'pp.shared_ads_sbv_sales', group: 'ads' },
  { web_field: 'ad_orders', web_label: '广告订单量', export_label: '广告订单量', lingxing_field: 'pp.ad_order_quantity', group: 'ads' },
];

export const FIELD_KEYS = FIELD_MAPPINGS.map((item) => item.web_field);

export const DEFAULT_FIELD_PATHS = Object.fromEntries(
  FIELD_MAPPINGS.map((item) => [item.web_field, item.lingxing_field]),
);

/** 这些字段取绝对值：领星的成本/广告金额常以负数返回 */
export const ABS_FIELDS = new Set([
  'refund_cost', 'first_mile_cost', 'fba_fee', 'storage_fee', 'procurement_cost', 'platform_commission',
  'ad_spend', 'ad_sales', 'sp_spend', 'sp_sales', 'sd_spend', 'sd_sales', 'sb_spend', 'sb_sales', 'sbv_spend', 'sbv_sales',
]);

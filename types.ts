
export interface DataRow {
  id: string;
  date: string; // YYYY-MM-DD
  country: string; 
  shop_name: string; // New: 店铺
  brand: string;
  manager: string;
  sub_category: string;
  parent_asin: string;
  child_asin: string;
  product_name: string; // New: 品名
  
  // Metrics
  sales_quantity: number;
  sales_amount: number;
  gross_profit: number;
  fba_sellable_qty: number;
  sessions: number; // Field 19: Sessions-Tot
  
  // Costs (Absolute values for aggregation)
  first_mile_cost: number;
  procurement_cost: number;
  storage_fee: number;
  fba_fee: number;
  refund_cost: number;
  platform_commission: number;
  
  // Advertising
  ad_spend: number;
  ad_sales: number;
  ad_orders: number; // Field 32: 广告订单量
  
  sp_spend: number;
  sp_sales: number;
  sd_spend: number;
  sd_sales: number;
  sb_spend: number;
  sb_sales: number;
  sbv_spend: number;
  sbv_sales: number;
  
  impressions: number;
  clicks: number;

  // Natural Metrics (Directly from Source)
  natural_orders: number; // Field 43: 自然订单量
  natural_clicks: number; // 自然点击量

  // Ratings
  rating: number; // New
  review_count: number; // New
}

export interface TargetRow {
  // Dimensions
  brand: string;
  country: string;      
  shop_name: string;
  manager: string;      
  sub_category: string; 
  parent_asin: string;  
  child_asin: string;   
  product_name: string;

  month: string; // YYYY-MM
  
  // Metrics
  sales_quantity_target: number;
  sales_amount_target: number;
  gross_profit_target: number;
  gross_margin_target: number; // Percentage 0-1
  ad_spend_target: number;     
}

// New: Refund Analysis Data Row
export interface RefundRow {
    order_id: string;
    sku: string;
    asin: string;
    product_name: string; // Field 3: 品名 (Short Name)
    title: string;        // Field 8: 商品名称 (Long Title)
    country: string;      // Field 2: 国家
    reason: string;       // Field 15: 退货原因
    disposition: string;  // Field 14: 库存属性 (Sellable/Unsellable)
    buyer_comment: string;// Field 18: 买家备注
    quantity: number;     // Field 12: 退货数量
    amount: number;       // Optional
    date: string;         // Field 19: 退货时间
}

// New: Review Analysis Data Row
export interface ReviewRow {
    date: string;
    asin: string;
    parent_asin?: string; // Mapped
    rating: number;
    title: string;
    content: string;
    product_name?: string; // Mapped
    product_title?: string; // New: 商品原标题 (for AI context)
    country?: string; // Mapped or Inferred
    helpful_votes?: number; // New: 点赞数
    review_link?: string; // New: 评论链接
}

// New: Search Term Analysis Data Row
export interface SearchTermRow {
    targeting: string;      // 投放 (Keyword/Target)
    match_type: string;     // 匹配方式
    search_term: string;    // 用户搜索词
    impressions: number;    // 曝光
    clicks: number;         // 点击
    cpc: number;            // CPC
    spend: number;          // 花费 (Calculated or imported)
    ad_orders: number;      // 广告订单
    ad_sales: number;       // 广告销售额
    campaign_name?: string; // Optional
    ad_group_name?: string; // Optional
    portfolio_name?: string; // New: 广告组合
}

// New: FBA Inventory Data Row
export interface InventoryRow {
    // 基础信息
    parent_asin: string;    // 1
    warehouse: string;      // 2
    shop_name: string;      // 3
    asin: string;           // 4
    msku: string;           // 5
    fnsku: string;          // 6
    sku: string;            // 7
    product_name: string;   // 8
    spu: string;            // 9
    style: string;          // 10 (款名)
    attribute: string;      // 11 (属性)
    category_1: string;     // 12
    category_2: string;     // 13
    category_3: string;     // 14
    brand: string;          // 15
    manager: string;        // 16
    country: string;        // Inferred or Mapped

    // FBA库存状态 (Qty & Cost)
    fba_total_qty: number;          // 17
    fba_total_cost: number;         // 18
    fba_available_qty: number;      // 19
    fba_available_cost: number;     // 20
    fba_sellable_qty: number;       // 21
    fba_sellable_cost: number;      // 22
    fbm_sellable_qty: number;       // 23
    fbm_sellable_cost: number;      // 24
    
    // Inbound / Transfer
    fba_reserved_qty: number;       // 25 (待调仓 - mapping logic might differ, assuming reserved)
    fba_reserved_cost: number;      // 26
    fba_transferring_qty: number;   // 27 (调仓中)
    fba_transferring_cost: number;  // 28
    fba_pending_qty: number;        // 29 (待发货)
    fba_pending_cost: number;       // 30
    
    // Inbound
    fba_inbound_plan_qty: number;   // 31 (计划入库)
    fba_inbound_plan_cost: number;  // 32
    fba_inbound_working_qty: number;// 33 (标发在途)
    fba_inbound_working_cost: number;// 34
    fba_inbound_shipped_qty: number;// 35 (实际在途)
    fba_inbound_shipped_cost: number;// 36
    fba_inbound_receiving_qty: number;// 37 (入库中)
    fba_inbound_receiving_cost: number;// 38
    
    // Unsellable
    fba_unsellable_qty: number;     // 39
    fba_unsellable_cost: number;    // 40
    fba_researching_qty: number;    // 41 (调查中)
    fba_researching_cost: number;   // 42

    // 库龄结构
    age_0_30_qty: number;           // 70
    age_0_30_cost: number;          // 71
    age_31_60_qty: number;          // 72
    age_31_60_cost: number;         // 73
    age_61_90_qty: number;          // 74
    age_61_90_cost: number;         // 75
    age_91_180_qty: number;         // 76
    age_91_180_cost: number;        // 77
    age_181_270_qty: number;        // 78
    age_181_270_cost: number;       // 79
    age_271_330_qty: number;        // 80
    age_271_330_cost: number;       // 81
    age_331_365_qty: number;        // 82
    age_331_365_cost: number;       // 83
    age_365_plus_qty: number;       // 84
    age_365_plus_cost: number;      // 85

    // AWD
    awd_instock_qty: number;        // 96
    awd_instock_cost: number;       // 97
    awd_total_qty: number;          // 108 (Available + Inbound)
    awd_total_cost: number;         // 109
}

/** 商品图片对照表（用户上传：SKU、品名、图片链接） */
export interface ProductImageRow {
  sku: string;
  product_name: string;
  image_url: string;
}

export interface FilterState {
  startDate: string;
  endDate: string;
  countries: string[]; 
  shops: string[]; // New
  brands: string[];
  managers: string[];
  subCategories: string[];
  parentAsins: string[];
  childAsins: string[];
  productNames: string[]; // New
}

export interface FilterSnapshot {
  id: string;
  name: string;
  filters: FilterState;
  isWeeklyMode: boolean;
  createdAt: number; // timestamp ms
}

export type TimePeriod = 'current' | 'last_period' | 'same_period_last_year';

export interface AggregatedData {
  sales_quantity: number;
  sales_amount: number;
  gross_profit: number;
  fba_sellable_qty: number;
  sessions: number;
  
  // Costs
  first_mile_cost: number;
  procurement_cost: number;
  storage_fee: number;
  fba_fee: number;
  refund_cost: number;
  platform_commission: number;
  
  // Ad
  ad_spend: number;
  ad_sales: number;
  ad_orders: number;
  sp_spend: number;
  sp_sales: number;
  sd_spend: number;
  sd_sales: number;
  sb_spend: number;
  sb_sales: number;
  sbv_spend: number;
  sbv_sales: number;
  
  impressions: number;
  clicks: number;

  // Natural Metrics
  natural_orders: number;
  natural_clicks: number;
  
  // Calculated Ratios
  gross_margin: number;
  avg_ticket: number;

  // Ratings (Calculated)
  review_count: number;
  average_rating: number;
}

// Inventory Aggregation
export interface InventoryAggregated {
    fba_total_qty: number;
    fba_total_cost: number;
    
    age_0_30_qty: number;
    age_0_30_cost: number;
    age_31_60_qty: number;
    age_31_60_cost: number;
    age_61_90_qty: number;
    age_61_90_cost: number;
    age_91_180_qty: number;
    age_91_180_cost: number;
    age_181_270_qty: number;
    age_181_270_cost: number;
    age_271_330_qty: number;
    age_271_330_cost: number;
    age_331_365_qty: number;
    age_331_365_cost: number;
    age_365_plus_qty: number;
    age_365_plus_cost: number;

    awd_total_qty: number;
    awd_total_cost: number;
}


// Debug Info Interface
export interface DataSourceDebugInfo {
    filename: string;
    totalRows: number;
    validRows: number;
    // Map of System Field -> Found Excel Header
    mappedColumns: Record<string, string>; 
    // List of Excel Headers that were not used
    unmappedHeaders: string[];
    errors: string[];
}

export interface ParsedDataResult<T> {
    data: T[];
    debug: DataSourceDebugInfo;
}

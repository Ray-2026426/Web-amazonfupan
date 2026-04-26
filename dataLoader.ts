
import * as XLSX from 'xlsx';
import { DataRow, TargetRow, RefundRow, InventoryRow, ReviewRow, SearchTermRow, ParsedDataResult, DataSourceDebugInfo } from './types';
import { getBusinessWeekRangeFromYearWeek, formatDate } from './utils';

// --- Header Matching Logic ---

const normalize = (str: string) => str.replace(/[\s\-_/.]/g, '').toLowerCase();

// ... (Existing normalization helpers remain unchanged) ...
const normalizeCountry = (val: string): string => {
    if (!val) return 'Unknown';
    const upper = val.trim().toUpperCase();
    if (upper === 'UK' || upper === 'GB' || upper === 'GREAT BRITAIN' || upper === 'UNITED KINGDOM') return '英国';
    if (upper === 'US' || upper === 'USA' || upper === 'UNITED STATES') return '美国';
    if (upper === 'DE' || upper === 'GERMANY') return '德国';
    if (upper === 'FR' || upper === 'FRANCE') return '法国';
    if (upper === 'IT' || upper === 'ITALY') return '意大利';
    if (upper === 'ES' || upper === 'SPAIN') return '西班牙';
    if (upper === 'JP' || upper === 'JAPAN') return '日本';
    if (upper === 'CA' || upper === 'CANADA') return '加拿大';
    if (upper === 'MX' || upper === 'MEXICO') return '墨西哥';
    if (upper === 'NL' || upper === 'NETHERLANDS') return '荷兰';
    if (upper === 'SE' || upper === 'SWEDEN') return '瑞典';
    if (upper === 'PL' || upper === 'POLAND') return '波兰';
    if (upper === 'BE' || upper === 'BELGIUM') return '比利时';
    if (upper === 'TR' || upper === 'TURKEY') return '土耳其';
    if (upper === 'AU' || upper === 'AUSTRALIA') return '澳大利亚';
    return val.trim(); 
};

const inferCountryFromShop = (shopName: string): string => {
    if (!shopName) return 'Unknown';
    const s = shopName.trim();
    const parts = s.split('-');
    if (parts.length > 1) {
        const lastPart = parts[parts.length - 1].trim();
        if (lastPart.length >= 2 && lastPart.length <= 3) {
            return normalizeCountry(lastPart);
        }
    }
    if (s.length >= 2) {
        const suffix = s.slice(-2);
        if (/^[a-zA-Z]+$/.test(suffix)) {
            return normalizeCountry(suffix);
        }
    }
    return 'Unknown';
};

// ... (Existing ALIASES remain unchanged) ...
export const COLUMN_DISPLAY_NAMES: Record<string, string> = {
    'year_col': '年份',
    'month_col': '月份',
    'week_col': '周次', 
    'date': '日期',
    'child_asin': '子ASIN/SKU',
    'parent_asin': '父ASIN',
    'country': '国家/站点',
    'manager': '负责人',
    'shop_name': '店铺名',
    'sub_category': '二级分类',
    'brand': '品牌',
    'product_name': '品名',
    'sales_quantity': '销量',
    'sales_amount': '销售额',
    'refund_cost': '退款金额',
    'gross_profit': '毛利润',
    'fba_sellable_qty': 'FBA可售库存',
    'sessions': '流量(Sessions)',
    'ad_spend': '广告总花费',
    'sp_spend': 'SP广告费',
    'sd_spend': 'SD广告费',
    'sb_spend': 'SB广告费',
    'sbv_spend': 'SBV广告费',
    'ad_sales': '广告总销售额',
    'sp_sales': 'SP销售额',
    'sd_sales': 'SD销售额',
    'sb_sales': 'SB销售额',
    'sbv_sales': 'SBV销售额',
    'ad_orders': '广告订单量',
    'impressions': '展示量',
    'clicks': '点击量',
    'natural_orders': '自然订单量',
    'natural_clicks': '自然点击量',
    'first_mile_cost': '头程费用',
    'fba_fee': 'FBA配送费',
    'storage_fee': '仓储费',
    'procurement_cost': '采购成本',
    'platform_commission': '平台佣金',
    'rating': '评分',
    'review_count': '评论数'
};

export const PERFORMANCE_ALIASES: Record<keyof DataRow | string, string[]> = {
    'year_col': ['年份', 'year'],           
    'month_col': ['月份', 'month'],
    'week_col': ['周', '周次', 'week'],        
    'date': ['日期', 'date'],               
    'child_asin': ['asin', '子asin', 'sku', 'msku'], 
    'parent_asin': ['父asin', 'parent_asin'],        
    'country': ['国家', '站点', 'marketplace', 'site', 'country', 'region'],      
    'manager': ['负责人', 'owner', 'manager', '运营'],
    'shop_name': ['店铺', '店铺名', 'shop', 'store', 'account', '账号', 'store name'], 
    'sub_category': ['二级分类', 'category', 'subcategory', '类目'],        
    'brand': ['品牌', 'brand', 'brand name', 'brands'],
    'product_name': ['品名', '产品名称', 'product_name', 'title', '产品', '商品名称', 'item name'], 
    'sales_quantity': ['销量', 'sales_quantity', 'units', 'ordered units', 'quantity'], 
    'sales_amount': ['销售额', 'sales_amount', 'revenue', 'gmv', 'ordered product sales', 'sales'], 
    'refund_cost': ['退款金额', '退款费', 'refund', 'refund total'],                 
    'gross_profit': ['订单毛利润', '毛利润', '毛利', 'profit', 'gross profit', 'order gross profit'],
    'fba_sellable_qty': ['fba-可售', 'fba可售', '可售', 'inventory', 'sellable'], 
    'sessions': ['sessions-tot', 'sessions', '流量', '访客数'], 
    'ad_spend': ['广告花费', 'spend', 'ad_spend', 'ad spend'],   
    'sp_spend': ['sp广告费', 'sp花费'],              
    'sd_spend': ['sd广告费', 'sd花费'],              
    'sb_spend': ['sb广告费', 'sb花费'],              
    'sbv_spend': ['sbv广告费', 'sbv花费'],           
    'ad_sales': ['广告销售额', 'ad_sales', 'ad revenue'],          
    'sp_sales': ['sp广告销售额', 'sp销售额'],        
    'sd_sales': ['sd广告销售额', 'sd销售额'],        
    'sb_sales': ['sb广告销售额', 'sb销售额'],        
    'sbv_sales': ['sbv广告销售额', 'sbv销售额'],   
    'ad_orders': ['广告订单量', 'ad_orders', 'ppc_orders', 'ad units'],  
    'impressions': ['展示', 'impressions'],          
    'clicks': ['点击', 'clicks'],   
    'natural_orders': ['自然订单量', '自然订单', 'natural_orders', 'org_orders'], 
    'natural_clicks': ['自然点击量', '自然点击', 'natural_clicks', 'org_clicks'],
    'first_mile_cost': ['头程费用', '头程', 'first_mile', 'freight'],    
    'fba_fee': ['fba费用', 'fba费', 'fulfillment_fee'],       
    'storage_fee': ['仓储费用', '仓储费', 'storage_fee'],     
    'procurement_cost': ['采购费用', '采购成本', 'procurement', 'cogs', 'product cost'], 
    'platform_commission': ['佣金费用', '佣金', 'commission', 'referral fee'],   
    'rating': ['评分', 'rating', 'score', 'average_rating', 'stars'],
    'review_count': ['评论数', '评论数量', 'review_count', 'ratings_count', 'reviews'],
};

export const INVENTORY_DISPLAY_NAMES: Record<string, string> = {
    'parent_asin': '父ASIN',
    'warehouse': '所属仓库',
    'shop_name': '店铺',
    'asin': 'ASIN',
    'msku': 'MSKU',
    'fnsku': 'FNSKU',
    'sku': 'SKU',
    'product_name': '品名',
    'spu': 'SPU',
    'style': '款名',
    'attribute': '属性',
    'category_1': '一级分类',
    'category_2': '二级分类',
    'category_3': '三级分类',
    'brand': '品牌',
    'manager': '负责人',
    'country': '国家',
    'fba_total_qty': 'FBA总库存',
    'fba_total_cost': 'FBA总库存成本',
    'fba_available_qty': 'FBA可用库存',
    'fba_available_cost': 'FBA可用库存成本',
    'fba_sellable_qty': 'FBA可售',
    'fba_sellable_cost': 'FBA可售成本',
    'fbm_sellable_qty': 'FBM可售',
    'fbm_sellable_cost': 'FBM可售成本',
    'fba_reserved_qty': 'FBA待调仓',
    'fba_reserved_cost': 'FBA待调仓成本',
    'fba_transferring_qty': 'FBA调仓中',
    'fba_transferring_cost': 'FBA调仓中成本',
    'fba_pending_qty': 'FBA待发货',
    'fba_pending_cost': 'FBA待发货成本',
    'fba_inbound_plan_qty': 'FBA计划入库',
    'fba_inbound_plan_cost': 'FBA计划入库成本',
    'fba_inbound_working_qty': 'FBA标发在途',
    'fba_inbound_working_cost': 'FBA标发在途成本',
    'fba_inbound_shipped_qty': 'FBA实际在途',
    'fba_inbound_shipped_cost': 'FBA实际在途成本',
    'fba_inbound_receiving_qty': 'FBA入库中',
    'fba_inbound_receiving_cost': 'FBA入库中成本',
    'fba_unsellable_qty': 'FBA不可售',
    'fba_unsellable_cost': 'FBA不可售成本',
    'fba_researching_qty': 'FBA调查中',
    'fba_researching_cost': 'FBA调查中成本',
    'age_0_30_qty': '30天内库龄',
    'age_0_30_cost': '30天内库龄成本',
    'age_31_60_qty': '31-60天库龄',
    'age_31_60_cost': '31-60天库龄成本',
    'age_61_90_qty': '61-90天库龄',
    'age_61_90_cost': '61-90天库龄成本',
    'age_91_180_qty': '91-180天库龄',
    'age_91_180_cost': '91-180天库龄成本',
    'age_181_270_qty': '181-270天库龄',
    'age_181_270_cost': '181-270天库龄成本',
    'age_271_330_qty': '271-330天库龄',
    'age_271_330_cost': '271-330天库龄成本',
    'age_331_365_qty': '331-365天库龄',
    'age_331_365_cost': '331-365天库龄成本',
    'age_365_plus_qty': '大于365天库龄',
    'age_365_plus_cost': '大于365天库龄成本',
    'awd_instock_qty': 'AWD在库',
    'awd_instock_cost': 'AWD在库成本',
    'awd_total_qty': 'AWD可用+在途',
    'awd_total_cost': 'AWD可用+在途成本'
};

export const INVENTORY_ALIASES: Record<string, string[]> = {
    // ... (Existing inventory aliases unchanged) ...
    'parent_asin': ['父ASIN', 'parent_asin'],
    'warehouse': ['所属仓库', 'warehouse'],
    'shop_name': ['店铺', 'shop_name', 'store'],
    'asin': ['ASIN', 'asin'],
    'msku': ['MSKU', 'msku'],
    'fnsku': ['FNSKU', 'fnsku'],
    'sku': ['SKU', 'sku', 'seller-sku'],
    'product_name': ['品名', 'product_name', 'product-name', 'title'],
    'spu': ['SPU'],
    'style': ['款名', 'style'],
    'attribute': ['属性', 'attribute'],
    'category_1': ['一级分类', 'category_1'],
    'category_2': ['二级分类', 'category_2'],
    'category_3': ['三级分类', 'category_3'],
    'brand': ['品牌', 'brand', 'brand name'],
    'manager': ['负责人', 'manager', 'owner'],
    
    // Added standard english headers (dashed)
    'fba_total_qty': ['FBA总库存', 'fba_total_qty', 'afn-total-quantity', 'total inventory'],
    'fba_total_cost': ['FBA总库存(成本)', 'FBA总库存成本', 'fba_total_cost'],
    
    'fba_available_qty': ['FBA可用库存', 'fba_available_qty', 'afn-warehouse-quantity'],
    'fba_available_cost': ['FBA可用库存(成本)', 'fba_available_cost'],
    
    'fba_sellable_qty': ['FBA可售', 'fba_sellable_qty', 'afn-fulfillable-quantity'],
    'fba_sellable_cost': ['FBA可售(成本)', 'fba_sellable_cost'],
    
    'fbm_sellable_qty': ['FBM可售', 'fbm_sellable_qty', 'mfn-fulfillable-quantity'],
    'fbm_sellable_cost': ['FBM可售(成本)', 'fbm_sellable_cost'],
    
    'fba_reserved_qty': ['FBA待调仓', 'fba_reserved_qty', 'afn-reserved-quantity'],
    'fba_reserved_cost': ['FBA待调仓(成本)', 'fba_reserved_cost'],
    
    'fba_transferring_qty': ['FBA调仓中', 'fba_transferring_qty', 'afn-reserved-transfers'],
    'fba_transferring_cost': ['FBA调仓中(成本)', 'fba_transferring_cost'],
    
    'fba_pending_qty': ['FBA待发货', 'fba_pending_qty', 'afn-reserved-future-supply'],
    'fba_pending_cost': ['FBA待发货(成本)', 'fba_pending_cost'],
    
    'fba_inbound_plan_qty': ['FBA计划入库', 'fba_inbound_plan_qty', 'afn-inbound-planned-quantity'],
    'fba_inbound_plan_cost': ['FBA计划入库(成本)', 'fba_inbound_plan_cost'],
    
    'fba_inbound_working_qty': ['FBA标发在途', 'fba_inbound_working_qty', 'afn-inbound-working-quantity'],
    'fba_inbound_working_cost': ['FBA标发在途(成本)', 'fba_inbound_working_cost'],
    
    'fba_inbound_shipped_qty': ['FBA实际在途', 'fba_inbound_shipped_qty', 'afn-inbound-shipped-quantity'],
    'fba_inbound_shipped_cost': ['FBA实际在途(成本)', 'fba_inbound_shipped_cost'],
    
    'fba_inbound_receiving_qty': ['FBA入库中', 'fba_inbound_receiving_qty', 'afn-inbound-receiving-quantity'],
    'fba_inbound_receiving_cost': ['FBA入库中(成本)', 'fba_inbound_receiving_cost'],
    
    'fba_unsellable_qty': ['FBA不可售', 'fba_unsellable_qty', 'afn-unsellable-quantity'],
    'fba_unsellable_cost': ['FBA不可售(成本)', 'fba_unsellable_cost'],
    
    'fba_researching_qty': ['FBA调查中', 'fba_researching_qty', 'afn-researching-quantity'],
    'fba_researching_cost': ['FBA调查中(成本)', 'fba_researching_cost'],
    
    'age_0_30_qty': ['30天内库龄', 'age_0_30_qty', 'inv-age-0-to-90-days'], 
    'age_0_30_cost': ['30天内库龄(成本)', 'age_0_30_cost'],
    
    'age_31_60_qty': ['31-60天库龄', 'age_31_60_qty'],
    'age_31_60_cost': ['31-60天库龄(成本)', 'age_31_60_cost'],
    
    'age_61_90_qty': ['61-90天库龄', 'age_61_90_qty'],
    'age_61_90_cost': ['61-90天库龄(成本)', 'age_61_90_cost'],
    
    'age_91_180_qty': ['91-180天库龄', 'age_91_180_qty', 'inv-age-91-to-180-days'],
    'age_91_180_cost': ['91-180天库龄(成本)', 'age_91_180_cost'],
    
    'age_181_270_qty': ['181-270天库龄', 'age_181_270_qty', 'inv-age-181-to-270-days'],
    'age_181_270_cost': ['181-270天库龄(成本)', 'age_181_270_cost'],
    
    'age_271_330_qty': ['271-330天库龄', 'age_271_330_qty', 'inv-age-271-to-365-days'],
    'age_271_330_cost': ['271-330天库龄(成本)', 'age_271_330_cost'],
    
    'age_331_365_qty': ['331-365天库龄', 'age_331_365_qty'],
    'age_331_365_cost': ['331-365天库龄(成本)', 'age_331_365_cost'],
    
    'age_365_plus_qty': ['大于365天库龄', 'age_365_plus_qty', 'inv-age-365-plus-days'],
    'age_365_plus_cost': ['大于365天库龄(成本)', 'age_365_plus_cost'],
    
    // AWD
    'awd_instock_qty': ['AWD在库', 'awd_instock_qty'],
    'awd_instock_cost': ['AWD在库(成本)', 'awd_instock_cost'],
    'awd_total_qty': ['AWD可用+在途库存合计', 'awd_total_qty'],
    'awd_total_cost': ['AWD可用+在途库存合计(成本)', 'awd_total_cost']
};

export const TARGET_DISPLAY_NAMES: Record<string, string> = {
    // ... (unchanged)
    'brand': '品牌',
    'country': '国家',
    'shop_name': '店铺',
    'manager': '负责人',
    'sub_category': '二级分类',
    'parent_asin': '父ASIN',
    'child_asin': '子ASIN',
    'product_name': '品名',
    'month': '月份 (YYYY-MM)',
    'sales_quantity_target': '目标销量',
    'sales_amount_target': '目标销售额',
    'gross_profit_target': '目标毛利',
    'gross_margin_target': '目标毛利率',
    'ad_spend_target': '目标广告预算'
};

export const TARGET_ALIASES: Record<string, string[]> = {
    // ... (unchanged)
    'brand': ['品牌', 'brand', 'brand name', 'brands', 'brand_name'],
    'country': ['国家', '站点', 'marketplace', 'country', 'region', 'site'],
    'shop_name': ['店铺', '店铺名', 'shop', 'store', 'account', 'store name'],
    'manager': ['负责人', 'manager', 'owner', '运营', 'pic'],
    'sub_category': ['二级分类', 'category', 'cat', 'category 2'],
    'parent_asin': ['父asin', 'parent_asin', 'parent'],
    'child_asin': ['子asin', 'asin', 'sku', 'msku', '子sku'],
    'product_name': ['品名', 'product_name', '产品名称', '商品名称', 'title', 'name', '产品', 'item name'],
    'month': ['月份', 'month', 'date'],
    'year': ['年份', 'year'],
    'sales_quantity_target': ['目标销量', 'sales_target', 'qty_target', 'target quantity', 'target units'],
    'sales_amount_target': ['目标销售额', 'revenue_target', 'amount_target', 'target sales', 'sales target'],
    'gross_profit_target': ['目标毛利', 'profit_target', 'target profit', 'gp target'],
    'gross_margin_target': ['目标毛利率', 'margin_target', 'target margin'],
    'ad_spend_target': ['目标广告费', 'ad_spend_target', 'budget', 'ad budget', 'marketing budget']
};

export const REFUND_ALIASES: Record<string, string[]> = {
    // ... (unchanged)
    'order_id': ['order-id', 'order_id', '订单号'],
    'sku': ['sku', 'msku'],
    'asin': ['asin'],
    'product_name': ['product-name', 'product_name', '品名'],
    'title': ['item-name', 'title', '商品名称'],
    'country': ['country', 'marketplace', '站点', '国家'],
    'reason': ['reason', 'detailed-disposition', '退货原因', 'reason_returned'],
    'disposition': ['disposition', '库存属性', 'status'],
    'buyer_comment': ['customer-comments', 'buyer_comment', '买家备注', 'comment'],
    'quantity': ['quantity', 'qty', '数量'],
    'amount': ['amount', 'refund-amount', '退款金额'],
    'date': ['return-date', 'date', '退货时间', 'posted-date']
};

export const REVIEW_ALIASES: Record<string, string[]> = {
    // ... (unchanged)
    'date': ['date', 'review date', '日期', '评论时间', '评价时间'],
    'asin': ['asin', 'product asin'],
    'rating': ['star rating', 'rating', 'stars', '评分', '星级'],
    'title': ['review title', 'title', '标题', 'review标题'],
    'content': ['review text', 'content', 'body', '评论内容', '内容', '评价内容'],
    'product_name': ['product title', 'product name', '品名'],
    'product_title': ['product title', 'item name', '商品名称', '商品标题'], 
    'country': ['marketplace', 'country', '站点', '国家'], 
    'helpful_votes': ['helpful', 'votes', 'helpful votes', '点赞', '有用', '点赞数'], 
    'review_link': ['评论链接', 'review link', 'link', 'url', 'permalink', 'review url'] 
};

// NEW: Search Term Aliases
export const SEARCH_TERM_ALIASES: Record<string, string[]> = {
    'targeting': ['投放', 'targeting', 'keyword', 'target'],
    'match_type': ['匹配方式', 'match type', 'match_type'],
    'search_term': ['用户搜索词', 'customer search term', 'search term', 'query'],
    'impressions': ['曝光', '曝光量', 'impressions', 'imps', '展示量', '展示'],
    'clicks': ['点击', 'clicks'],
    'cpc': ['cpc', 'cost per click', '单词点击成本'],
    'spend': ['spend', 'cost', '花费'],
    'ad_orders': ['广告订单', '7 day total orders', 'orders', '广告订单数量', '7 day orders', '14 day total orders'], // Catch standard Amazon report headers
    'ad_sales': ['销售额', '7 day total sales', 'sales', '广告销售额', '7 day sales', '14 day total sales'],
    'campaign_name': ['campaign name', '广告活动名称', 'campaign'],
    'ad_group_name': ['ad group name', '广告组名称', 'ad group'],
    'portfolio_name': ['广告组合', 'portfolio', 'portfolio name', 'portfolio_name'] // Added
};

// ... (Helper Functions like readExcel, mapHeaderToKey, parseNumber, formatExcelDate, synthesizeDate, synthesizeWeekDate, formatExcelMonth remain unchanged) ...
const readExcel = (file: File): Promise<any[]> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: 'binary' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
                resolve(jsonData);
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = (error) => reject(error);
        reader.readAsBinaryString(file);
    });
};

const mapHeaderToKey = (header: string, aliasMap: Record<string, string[]>): string | null => {
    const normHeader = normalize(header);
    for (const [key, aliases] of Object.entries(aliasMap)) {
        for (const alias of aliases) {
            if (normalize(alias) === normHeader) {
                return key;
            }
        }
    }
    return null;
};

const parseNumber = (val: any): number => {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    if (typeof val === 'string') {
        const clean = val.replace(/[,，$¥￥\s]/g, '');
        const num = parseFloat(clean);
        return isNaN(num) ? 0 : num;
    }
    return 0;
};

const formatExcelDate = (val: any): string => {
    if (!val) return '';
    if (typeof val === 'number') {
        const date = new Date(Math.round((val - 25569) * 86400 * 1000));
        if (isNaN(date.getTime())) return '';
        const y = date.getUTCFullYear();
        const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
        const d = date.getUTCDate().toString().padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    const str = String(val).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
         const y = d.getFullYear();
         const m = (d.getMonth() + 1).toString().padStart(2, '0');
         const day = d.getDate().toString().padStart(2, '0');
         return `${y}-${m}-${day}`;
    }
    return '';
};

const synthesizeDate = (year: any, month: any): string => {
    const y = parseNumber(year);
    let m = 0;
    if (typeof month === 'number') m = month;
    else if (typeof month === 'string') {
        const match = month.match(/\d+/);
        if (match) m = parseInt(match[0], 10);
    }
    
    if (y > 0 && m > 0) {
        return `${y}-${m.toString().padStart(2, '0')}-01`;
    }
    return '';
};

const synthesizeWeekDate = (year: any, week: any): string => {
    const y = parseNumber(year);
    let w = 0;
    if (typeof week === 'number') w = week;
    else if (typeof week === 'string') {
        const match = week.match(/\d+/);
        if (match) w = parseInt(match[0], 10);
    }

    if (y > 0 && w > 0) {
        const { start } = getBusinessWeekRangeFromYearWeek(y, w);
        return formatDate(start);
    }
    return '';
};

const formatExcelMonth = (val: any): string => {
    if (!val) return '';
    if (typeof val === 'number') {
        const fullDate = formatExcelDate(val);
        return fullDate.substring(0, 7);
    }
    if (typeof val === 'string') {
        const match = val.match(/(\d{4})[\/\-\.](\d{1,2})/);
        if (match) {
             return `${match[1]}-${match[2].padStart(2, '0')}`;
        }
    }
    return '';
};

// ... (Existing parsers: parseMonthlyPerformance, parseWeeklyPerformance, parseInventoryData, parseTargetData, parseRefundData, parseReviewData remain unchanged) ...
export const parseMonthlyPerformance = async (file: File): Promise<ParsedDataResult<DataRow>> => {
    // ... existing implementation
    const rawData = await readExcel(file);
    const debug: DataSourceDebugInfo = { filename: file.name, totalRows: rawData.length, validRows: 0, mappedColumns: {}, unmappedHeaders: [], errors: [] };
    if (rawData.length === 0) { debug.errors.push("表格内容为空"); return { data: [], debug }; }
    const sampleRow = rawData[0]; const rawHeaders = Object.keys(sampleRow); const headerMap: Record<string, string> = {};
    rawHeaders.forEach(header => { const matchedKey = mapHeaderToKey(header, PERFORMANCE_ALIASES); if (matchedKey) { headerMap[header] = matchedKey; debug.mappedColumns[matchedKey] = header; } else { debug.unmappedHeaders.push(header); } });
    const parsedRows = rawData.map((row: any, idx) => {
        const newRow: any = { id: `row-${idx}`, date: '', country: 'Unknown', brand: 'Unknown', shop_name: 'Unknown', manager: 'Unknown', sub_category: '', parent_asin: '', child_asin: '', product_name: '' };
        Object.keys(PERFORMANCE_ALIASES).forEach(key => { if (!['date','year_col','month_col','week_col','country','brand','manager','sub_category','parent_asin','child_asin','shop_name','product_name'].includes(key)) { newRow[key] = 0; } });
        let rowYear: any = null; let rowMonth: any = null;
        Object.keys(row).forEach(header => {
            const key = headerMap[header]; const val = row[header];
            if (key === 'year_col') rowYear = val; else if (key === 'month_col') rowMonth = val; else if (key === 'date') newRow.date = formatExcelDate(val); else if (key) {
                if (['country','brand','manager','sub_category','parent_asin','child_asin','shop_name','product_name'].includes(key)) { const s = String(val).trim(); if (s && s.toLowerCase() !== 'undefined' && s !== '') { newRow[key] = s; if (key === 'country') newRow[key] = normalizeCountry(s); } } else { newRow[key] = parseNumber(val); }
            }
        });
        if (!newRow.date && rowYear && rowMonth) { newRow.date = synthesizeDate(rowYear, rowMonth); }
        return newRow as DataRow;
    });
    const validRows = parsedRows.filter(r => r.date && r.date.length >= 10); debug.validRows = validRows.length;
    if (validRows.length === 0) { debug.errors.push("日期解析失败。请确保包含 '年份' (如2025) 和 '月份' (如12月) 列。"); }
    if (!debug.mappedColumns['sales_amount']) debug.errors.push("未识别 '销售额' 列。请确保表头完全匹配（如：销售额）。");
    if (!debug.mappedColumns['sales_quantity']) debug.errors.push("未识别 '销量' 列。请确保表头完全匹配（如：销量）。");
    if (!debug.mappedColumns['child_asin']) debug.errors.push("未识别 'ASIN' 列。");
    return { data: validRows, debug };
};

export const parseWeeklyPerformance = async (file: File): Promise<ParsedDataResult<DataRow>> => {
    // ... existing implementation
    const rawData = await readExcel(file);
    const debug: DataSourceDebugInfo = { filename: file.name, totalRows: rawData.length, validRows: 0, mappedColumns: {}, unmappedHeaders: [], errors: [] };
    if (rawData.length === 0) { debug.errors.push("表格内容为空"); return { data: [], debug }; }
    const sampleRow = rawData[0]; const rawHeaders = Object.keys(sampleRow); const headerMap: Record<string, string> = {};
    rawHeaders.forEach(header => { const matchedKey = mapHeaderToKey(header, PERFORMANCE_ALIASES); if (matchedKey) { headerMap[header] = matchedKey; debug.mappedColumns[matchedKey] = header; } else { debug.unmappedHeaders.push(header); } });
    const parsedRows = rawData.map((row: any, idx) => {
        const newRow: any = { id: `row-${idx}`, date: '', country: 'Unknown', brand: 'Unknown', shop_name: 'Unknown', manager: 'Unknown', sub_category: '', parent_asin: '', child_asin: '', product_name: '' };
        Object.keys(PERFORMANCE_ALIASES).forEach(key => { if (!['date','year_col','month_col','week_col','country','brand','manager','sub_category','parent_asin','child_asin','shop_name','product_name'].includes(key)) { newRow[key] = 0; } });
        let rowYear: any = null; let rowWeek: any = null;
        Object.keys(row).forEach(header => {
            const key = headerMap[header]; const val = row[header];
            if (key === 'year_col') rowYear = val; else if (key === 'week_col') rowWeek = val; else if (key === 'date') newRow.date = formatExcelDate(val); else if (key) {
                if (['country','brand','manager','sub_category','parent_asin','child_asin','shop_name','product_name'].includes(key)) { const s = String(val).trim(); if (s && s.toLowerCase() !== 'undefined' && s !== '') { newRow[key] = s; if (key === 'country') newRow[key] = normalizeCountry(s); } } else { newRow[key] = parseNumber(val); }
            }
        });
        if (!newRow.date && rowYear && rowWeek) { newRow.date = synthesizeWeekDate(rowYear, rowWeek); (newRow as any).week_str = `${rowYear}-W${String(rowWeek).padStart(2,'0')}`; }
        return newRow as DataRow;
    });
    const validRows = parsedRows.filter(r => r.date && r.date.length >= 10); debug.validRows = validRows.length;
    if (validRows.length === 0) { debug.errors.push("日期解析失败。请确保包含 '年份' (如2025) 和 '周' (如1) 列。"); }
    if (!debug.mappedColumns['sales_amount']) debug.errors.push("未识别 '销售额' 列。");
    if (!debug.mappedColumns['sales_quantity']) debug.errors.push("未识别 '销量' 列。");
    return { data: validRows, debug };
};

export const parseInventoryData = async (file: File): Promise<ParsedDataResult<InventoryRow>> => {
    // ... existing implementation
    const rawData = await readExcel(file);
    const debug: DataSourceDebugInfo = { filename: file.name, totalRows: rawData.length, validRows: 0, mappedColumns: {}, unmappedHeaders: [], errors: [] };
    if (rawData.length === 0) { debug.errors.push("表格内容为空"); return { data: [], debug }; }
    const sampleRow = rawData[0]; const rawHeaders = Object.keys(sampleRow); const headerMap: Record<string, string> = {};
    rawHeaders.forEach(header => { const matchedKey = mapHeaderToKey(header, INVENTORY_ALIASES); if (matchedKey) { headerMap[header] = matchedKey; debug.mappedColumns[matchedKey] = header; } else { debug.unmappedHeaders.push(header); } });
    const validRows: InventoryRow[] = rawData.map((row: any) => {
        const newRow: any = { parent_asin: '', warehouse: '', shop_name: 'Unknown', asin: '', msku: '', fnsku: '', sku: 'Unknown', product_name: '', spu: '', style: '', attribute: '', category_1: '', category_2: '', category_3: '', brand: 'Unknown', manager: 'Unknown', country: 'Unknown' };
        Object.keys(INVENTORY_ALIASES).forEach(k => { if (!['parent_asin','warehouse','shop_name','asin','msku','fnsku','sku','product_name','spu','style','attribute','category_1','category_2','category_3','brand','manager','country'].includes(k)) { newRow[k] = 0; } });
        Object.keys(row).forEach(header => {
            const key = headerMap[header]; const val = row[header];
            if (key) {
                if (['parent_asin','warehouse','shop_name','asin','msku','fnsku','sku','product_name','spu','style','attribute','category_1','category_2','category_3','brand','manager','country'].includes(key)) { const s = String(val).trim(); if (s && s.toLowerCase() !== 'undefined') { newRow[key] = s; if (key === 'country') newRow[key] = normalizeCountry(s); } } else { newRow[key] = parseNumber(val); }
            }
        });
        if (newRow.country === 'Unknown' && newRow.shop_name && newRow.shop_name !== 'Unknown') { newRow.country = inferCountryFromShop(newRow.shop_name); }
        if (newRow.country === 'Unknown' && newRow.warehouse) { const w = newRow.warehouse.toLowerCase(); if (w.includes('gb') || w.includes('uk')) newRow.country = '英国'; else if (w.includes('us')) newRow.country = '美国'; else if (w.includes('de')) newRow.country = '德国'; else if (w.includes('fr')) newRow.country = '法国'; else if (w.includes('it')) newRow.country = '意大利'; else if (w.includes('es')) newRow.country = '西班牙'; }
        return newRow as InventoryRow;
    });
    debug.validRows = validRows.length;
    if (!debug.mappedColumns['fba_total_qty']) debug.errors.push("未识别 'FBA总库存' 列。请确保表头完全匹配。");
    if (!debug.mappedColumns['sku']) debug.errors.push("未识别 'SKU' 列。请确保表头完全匹配。");
    return { data: validRows, debug };
};

export const parseTargetData = async (file: File): Promise<ParsedDataResult<TargetRow>> => {
    // ... existing implementation
    const rawData = await readExcel(file);
    const debug: DataSourceDebugInfo = { filename: file.name, totalRows: rawData.length, validRows: 0, mappedColumns: {}, unmappedHeaders: [], errors: [] };
    if (rawData.length === 0) { debug.errors.push("目标表内容为空"); return { data: [], debug }; }
    const sampleRow = rawData[0]; const headers = Object.keys(sampleRow); const headerMap: Record<string, string> = {};
    headers.forEach(header => { const matchedKey = mapHeaderToKey(header, TARGET_ALIASES); if (matchedKey) { headerMap[header] = matchedKey; debug.mappedColumns[matchedKey] = header; } else { debug.unmappedHeaders.push(header); } });
    const CN_STRICT_REGEX = /^(\d{2,4})\s*年\s*(\d{1,2})\s*月(?:\s*目标)?(.*)$/;
    const STD_YM_REGEX = /^(\d{4})[\/\-\.](\d{1,2})\s*(.*)$/;
    const yearsFound = new Set<string>();
    const hasWideColumnsCN = headers.some(h => CN_STRICT_REGEX.test(h));
    const hasWideColumnsSTD = headers.some(h => STD_YM_REGEX.test(h));
    const hasWideColumns = hasWideColumnsCN || hasWideColumnsSTD;
    if (hasWideColumns) { debug.mappedColumns['wide_format_indicator'] = '横向月份目标 (Wide Format)'; headers.forEach(h => { const m = h.match(CN_STRICT_REGEX) || h.match(STD_YM_REGEX); if (m) { let y = parseInt(m[1], 10); if (y < 100) y += 2000; yearsFound.add(y.toString()); } }); if (yearsFound.size > 0) { debug.mappedColumns['years_detected'] = Array.from(yearsFound).sort().join(', '); } }
    let resultRows: TargetRow[] = [];
    if (hasWideColumns) {
        rawData.forEach((row: any) => {
            const dimensions: Partial<TargetRow> = { brand: 'Unknown', country: 'Unknown', shop_name: 'Unknown', manager: 'Unknown', sub_category: '', parent_asin: '', child_asin: '', product_name: '' };
            Object.keys(row).forEach(h => { const key = headerMap[h] as keyof TargetRow; if (key && ['brand','country','manager','sub_category','parent_asin','child_asin','shop_name','product_name'].includes(key)) { const val = String(row[h]).trim(); if (val && val.toLowerCase() !== 'undefined') { if (key === 'country') { (dimensions as any)[key] = normalizeCountry(val); } else { (dimensions as any)[key] = val; } } } });
            const monthMetrics: Record<string, any> = {};
            Object.keys(row).forEach(header => {
                const lowerHeader = header.toLowerCase(); if (headerMap[header]) return;
                if (lowerHeader.includes('达成') || lowerHeader.includes('率') || lowerHeader.includes('%') || lowerHeader.includes('增长') || lowerHeader.includes('同比') || lowerHeader.includes('环比') || lowerHeader.includes('diff')) { return; }
                const match = header.match(CN_STRICT_REGEX) || header.match(STD_YM_REGEX);
                if (match) { let yearNum = parseInt(match[1], 10); if (yearNum < 100) yearNum += 2000; const monthNum = parseInt(match[2], 10); const suffix = (match[3] || '').trim().toLowerCase(); if (monthNum < 1 || monthNum > 12) return; const monthKey = `${yearNum}-${monthNum.toString().padStart(2, '0')}`; const val = parseNumber(row[header]); if (!monthMetrics[monthKey]) { monthMetrics[monthKey] = { q: 0, a: 0, p: 0, ad: 0 }; } if (suffix.includes('销量') || suffix.includes('qty') || suffix.includes('quantity') || suffix.includes('units')) { monthMetrics[monthKey].q += val; } else if (suffix.includes('毛利') || suffix.includes('利润') || suffix.includes('profit')) { monthMetrics[monthKey].p += val; } else if (suffix.includes('广告') || suffix.includes('ad')) { monthMetrics[monthKey].ad += val; } else if (suffix.includes('销售') || suffix.includes('sales') || suffix.includes('amount') || suffix === '') { monthMetrics[monthKey].a += val; } }
            });
            Object.entries(monthMetrics).forEach(([monthKey, metrics]) => { resultRows.push({ ...(dimensions as any), month: monthKey, sales_quantity_target: metrics.q, sales_amount_target: metrics.a, gross_profit_target: metrics.p, gross_margin_target: metrics.a > 0 ? metrics.p / metrics.a : 0, ad_spend_target: metrics.ad }); });
        });
    } else {
        resultRows = rawData.map((row: any) => {
            const newRow: any = { brand: 'Unknown', country: 'Unknown', shop_name: 'Unknown', manager: 'Unknown', sub_category: '', parent_asin: '', child_asin: '', product_name: '', month: '', sales_quantity_target: 0, sales_amount_target: 0, gross_profit_target: 0, gross_margin_target: 0, ad_spend_target: 0 };
            let rowYear: any = null; let rowMonthRaw: any = null;
            Object.keys(row).forEach(header => {
                const key = headerMap[header]; const val = row[header];
                if (key === 'month') { newRow.month = formatExcelMonth(val); rowMonthRaw = val; } else if (key === 'year') { rowYear = val; } else if (key) { if (['brand','country','manager','sub_category','parent_asin','child_asin','shop_name','product_name'].includes(key)) { const s = String(val).trim(); if (s && s.toLowerCase() !== 'undefined') { newRow[key] = s; if (key === 'country') newRow[key] = normalizeCountry(s); } } else if (key === 'gross_margin_target') { let num = parseNumber(val); if (num > 1) num = num / 100; newRow[key] = num; } else { newRow[key] = parseNumber(val); } }
            });
            if ((!newRow.month || newRow.month.length < 7) && rowYear && rowMonthRaw) { const fullDate = synthesizeDate(rowYear, rowMonthRaw); if (fullDate) newRow.month = fullDate.substring(0, 7); }
            return newRow as TargetRow;
        });
    }
    debug.validRows = resultRows.length; if (resultRows.length === 0) debug.errors.push("目标表未解析出有效数据行");
    return { data: resultRows, debug };
};

export const parseRefundData = async (file: File): Promise<ParsedDataResult<RefundRow>> => {
    // ... existing implementation
    const rawData = await readExcel(file);
    const debug: DataSourceDebugInfo = { filename: file.name, totalRows: rawData.length, validRows: 0, mappedColumns: {}, unmappedHeaders: [], errors: [] };
    if (rawData.length === 0) { debug.errors.push("退款表内容为空"); return { data: [], debug }; }
    const sampleRow = rawData[0]; const headers = Object.keys(sampleRow); const headerMap: Record<string, string> = {};
    headers.forEach(header => { const matchedKey = mapHeaderToKey(header, REFUND_ALIASES); if (matchedKey) { headerMap[header] = matchedKey; debug.mappedColumns[matchedKey] = header; } else { debug.unmappedHeaders.push(header); } });
    const parsedRows = rawData.map((row: any) => {
        const newRow: any = { order_id: 'Unknown', sku: 'Unknown', asin: '', product_name: '', title: '', country: 'Unknown', reason: 'Unknown', disposition: 'Unknown', buyer_comment: '', quantity: 1, amount: 0, date: '' };
        Object.keys(row).forEach(header => {
            const key = headerMap[header]; const val = row[header];
            if (key) {
                if (['order_id', 'sku', 'asin', 'product_name', 'title', 'reason', 'country', 'buyer_comment', 'disposition'].includes(key)) { const s = String(val).trim(); newRow[key] = s; if (key === 'country') newRow[key] = normalizeCountry(s); } else if (key === 'date') { newRow[key] = formatExcelDate(val); } else { newRow[key] = Math.abs(parseNumber(val)); }
            }
        });
        return newRow as RefundRow;
    });
    const validRows = parsedRows.filter(r => r.sku !== 'Unknown' || r.reason !== 'Unknown'); debug.validRows = validRows.length;
    if (!debug.mappedColumns['reason']) debug.errors.push("警告: 未找到 '退货原因' (Field 15) 列。");
    if (!debug.mappedColumns['sku']) debug.errors.push("警告: 未找到 'SKU' (Field 4/9) 列。");
    return { data: validRows, debug };
};

export const parseReviewData = async (file: File): Promise<ParsedDataResult<ReviewRow>> => {
    // ... existing implementation
    const rawData = await readExcel(file);
    const debug: DataSourceDebugInfo = { filename: file.name, totalRows: rawData.length, validRows: 0, mappedColumns: {}, unmappedHeaders: [], errors: [] };
    if (rawData.length === 0) { debug.errors.push("评论表内容为空"); return { data: [], debug }; }
    const sampleRow = rawData[0]; const headers = Object.keys(sampleRow); const headerMap: Record<string, string> = {};
    headers.forEach(header => { const matchedKey = mapHeaderToKey(header, REVIEW_ALIASES); if (matchedKey) { headerMap[header] = matchedKey; debug.mappedColumns[matchedKey] = header; } else { debug.unmappedHeaders.push(header); } });
    const parsedRows = rawData.map((row: any) => {
        const newRow: any = { date: '', asin: 'Unknown', parent_asin: '', rating: 0, title: '', content: '', product_name: '', product_title: '', country: 'Unknown', helpful_votes: 0, review_link: '' };
        Object.keys(row).forEach(header => {
            const key = headerMap[header]; const val = row[header];
            if (key) {
                if (['title', 'content', 'product_name', 'product_title', 'asin', 'country', 'review_link'].includes(key)) { newRow[key] = String(val).trim(); if(key === 'country') newRow[key] = normalizeCountry(String(val).trim()); } else if (key === 'date') { newRow[key] = formatExcelDate(val); } else if (key === 'rating' || key === 'helpful_votes') { newRow[key] = parseNumber(val); }
            }
        });
        return newRow as ReviewRow;
    });
    const validRows = parsedRows.filter(r => r.rating > 0); debug.validRows = validRows.length;
    if (!debug.mappedColumns['rating']) debug.errors.push("警告: 未找到 '评分' 列。");
    if (!debug.mappedColumns['content'] && !debug.mappedColumns['title']) debug.errors.push("警告: 未找到 '评论内容' 或 '标题' 列。");
    return { data: validRows, debug };
};

// NEW: Search Term Parser
export const parseSearchTermReport = async (file: File): Promise<ParsedDataResult<SearchTermRow>> => {
    const rawData = await readExcel(file);
    const debug: DataSourceDebugInfo = {
        filename: file.name,
        totalRows: rawData.length,
        validRows: 0,
        mappedColumns: {},
        unmappedHeaders: [],
        errors: []
    };

    if (rawData.length === 0) {
        debug.errors.push("搜索词报告为空");
        return { data: [], debug };
    }

    const sampleRow = rawData[0];
    const headers = Object.keys(sampleRow);
    const headerMap: Record<string, string> = {};

    headers.forEach(header => {
        const matchedKey = mapHeaderToKey(header, SEARCH_TERM_ALIASES);
        if (matchedKey) {
            headerMap[header] = matchedKey;
            debug.mappedColumns[matchedKey] = header;
        } else {
            debug.unmappedHeaders.push(header);
        }
    });

    const parsedRows = rawData.map((row: any) => {
        const newRow: any = {
            targeting: '',
            match_type: 'Unknown',
            search_term: '',
            impressions: 0,
            clicks: 0,
            cpc: 0,
            spend: 0,
            ad_orders: 0,
            ad_sales: 0,
            portfolio_name: 'Unknown' // Default
        };

        Object.keys(row).forEach(header => {
            const key = headerMap[header];
            const val = row[header];
            if (key) {
                if (['targeting', 'match_type', 'search_term', 'campaign_name', 'ad_group_name', 'portfolio_name'].includes(key)) {
                    newRow[key] = String(val).trim();
                } else {
                    newRow[key] = parseNumber(val);
                }
            }
        });

        // Fallback for Spend if not present but CPC and Clicks are
        if (newRow.spend === 0 && newRow.clicks > 0 && newRow.cpc > 0) {
            newRow.spend = newRow.clicks * newRow.cpc;
        }

        return newRow as SearchTermRow;
    });

    const validRows = parsedRows.filter(r => r.search_term && r.impressions > 0);
    debug.validRows = validRows.length;

    if (!debug.mappedColumns['search_term']) debug.errors.push("未找到 '用户搜索词' (Customer Search Term) 列。");
    if (!debug.mappedColumns['impressions']) debug.errors.push("未找到 '曝光' (Impressions) 列。");

    return { data: validRows, debug };
};

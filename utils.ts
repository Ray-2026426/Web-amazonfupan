
import { DataRow, TargetRow, FilterState, AggregatedData, InventoryRow, InventoryAggregated } from './types';

// --- Date Utilities ---

export const parseDate = (dateStr: string): Date => new Date(dateStr);

export const getDaysDiff = (start: Date, end: Date): number => {
  const diffTime = Math.abs(end.getTime() - start.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // Inclusive
};

export const getDaysInMonth = (date: Date): number => {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
};

// Fixed: Use Local Time YYYY-MM-DD instead of UTC (toISOString) to prevent off-by-one errors
export const formatDate = (date: Date): string => {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// --- 自然周（非 ISO）：周日起算；第 1 周为「含当年 1 月 1 日」的那一周（日～六）。例：2026 年第 15 周为 4.5–4.11，4.12 起为第 16 周。 ---

const MS_PER_DAY = 86400000;

/** 该日期所在「自然周」的周日 0 点（本地） */
export const startOfSundayWeekForDate = (d: Date): Date => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - x.getDay());
    return x;
};

/** 某公历年的「第 1 周」起始周日（含 1 月 1 日的那一周的周日） */
export const firstSundayWeekOfCalendarYear = (year: number): Date => {
    return startOfSundayWeekForDate(new Date(year, 0, 1));
};

/** 判定日期属于哪一「周序号年」及第几周（周序号年与公历年在年末可能差 1） */
export const getBusinessWeekYearAndNumber = (d: Date): { weekYear: number; week: number } => {
    const sun = startOfSundayWeekForDate(d);
    const candidates = [d.getFullYear() - 1, d.getFullYear(), d.getFullYear() + 1];
    for (const tryY of candidates) {
        const fs = firstSundayWeekOfCalendarYear(tryY);
        const nf = firstSundayWeekOfCalendarYear(tryY + 1);
        if (sun.getTime() >= fs.getTime() && sun.getTime() < nf.getTime()) {
            const diff = Math.round((sun.getTime() - fs.getTime()) / MS_PER_DAY);
            return { weekYear: tryY, week: Math.floor(diff / 7) + 1 };
        }
    }
    const fs = firstSundayWeekOfCalendarYear(d.getFullYear());
    const diff = Math.round((sun.getTime() - fs.getTime()) / MS_PER_DAY);
    return { weekYear: d.getFullYear(), week: Math.max(1, Math.floor(diff / 7) + 1) };
};

/** 由 YYYY-MM-DD 得到周标签，如 2026-W15 */
export const formatBusinessWeekFromDateStr = (dateStr: string): string => {
    if (!dateStr || dateStr.length < 8) return 'Unknown';
    const p = dateStr.split('-').map(Number);
    const yy = p[0];
    const mm = p[1] || 1;
    const dd = p[2] || 1;
    const d = new Date(yy, mm - 1, dd);
    if (isNaN(d.getTime())) return 'Unknown';
    const { weekYear, week } = getBusinessWeekYearAndNumber(d);
    return `${weekYear}-W${String(week).padStart(2, '0')}`;
};

/** 某周序号年 + 周序号 → 该周周日～周六 */
export const getBusinessWeekRangeFromYearWeek = (weekYear: number, week: number): { start: Date; end: Date } => {
    const first = firstSundayWeekOfCalendarYear(weekYear);
    const start = new Date(first);
    start.setDate(first.getDate() + (week - 1) * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start, end };
};

/** 含指定日期的自然周（周日～周六） */
export const getBusinessWeekDateRange = (date: Date) => {
    const start = startOfSundayWeekForDate(date);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start, end };
};

export const getBusinessWeekNumber = (d: Date): number => getBusinessWeekYearAndNumber(d).week;

/** @deprecated 历史命名：现为自然周（非 ISO），仍导出以免大范围改名 */
export const getISOWeekNumber = getBusinessWeekNumber;
export const getISOWeekDateRange = getBusinessWeekDateRange;

export const getCurrentWeekInfo = () => {
    const now = new Date();
    const { weekYear, week } = getBusinessWeekYearAndNumber(now);
    const { start, end } = getBusinessWeekDateRange(now);
    const fmt = (d: Date) => `${d.getMonth() + 1}.${d.getDate()}日`;
    const fmtCompact = (d: Date) => `${d.getMonth() + 1}.${d.getDate()}`;
    return {
        year: weekYear,
        week,
        rangeStr: `${fmt(start)}-${fmt(end)}`,
        rangeCompact: `${fmtCompact(start)}-${fmtCompact(end)}`
    };
};

export const calculatePeriodDates = (startStr: string, endStr: string) => {
  // Use manual parsing to ensure we are working with Local Time midnight
  // Avoids new Date("YYYY-MM-DD") acting pulling standard UTC and shifting timezones
  const [sy, sm, sd] = startStr.split('-').map(Number);
  const [ey, em, ed] = endStr.split('-').map(Number);

  const start = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  
  // Smart Period Logic: Check if the selection is a "Full Natural Month" or "Multiple Full Months"
  // Criteria: Starts on Day 1 AND Ends on the last day of that month
  const endOfEndMonth = new Date(ey, em, 0).getDate();
  const isFullMonthSelection = sd === 1 && ed === endOfEndMonth;

  if (isFullMonthSelection) {
      // Calculate duration in months instead of milliseconds
      const monthsDuration = (ey - sy) * 12 + (em - sm) + 1;

      // --- Last Period (MoM) ---
      const lastStart = new Date(sy, sm - 1 - monthsDuration, 1);
      const lastEnd = new Date(lastStart.getFullYear(), lastStart.getMonth() + monthsDuration, 0);

      // --- Same Period Last Year (YoY) ---
      const yearStart = new Date(sy - 1, sm - 1, 1);
      const yearEnd = new Date(ey - 1, em, 0);

      return {
          current: { start, end },
          last: { start: lastStart, end: lastEnd },
          year: { start: yearStart, end: yearEnd },
      };
  }

  // --- Fallback: Arbitrary Range (Sliding Window) ---
  const durationMs = end.getTime() - start.getTime();

  // Last Period: End date is Start - 1 day
  const prevPeriodEnd = new Date(start);
  prevPeriodEnd.setDate(start.getDate() - 1);
  const prevPeriodStart = new Date(prevPeriodEnd.getTime() - durationMs);

  // YoY: Shift -1 Year
  const prevYearStart = new Date(start);
  prevYearStart.setFullYear(start.getFullYear() - 1);
  const prevYearEnd = new Date(end);
  prevYearEnd.setFullYear(end.getFullYear() - 1);

  return {
    current: { start, end },
    last: { start: prevPeriodStart, end: prevPeriodEnd },
    year: { start: prevYearStart, end: prevYearEnd },
  };
};

export const getPacingRatio = (start: Date, end: Date): number => {
  const endOfMonth = new Date(end.getFullYear(), end.getMonth() + 1, 0);
  // Simple check: if end date matches end of month, ratio is 1. 
  // Otherwise could return day fraction. For now returning 1 as per legacy code structure.
  if (formatDate(end) === formatDate(endOfMonth)) return 1;
  return 1; 
};

// --- Currency Utilities ---

const COUNTRY_CURRENCY_MAP: Record<string, { code: string, symbol: string, locale: string }> = {
    '美国': { code: 'USD', symbol: '$', locale: 'en-US' },
    'US': { code: 'USD', symbol: '$', locale: 'en-US' },
    '英国': { code: 'GBP', symbol: '£', locale: 'en-GB' },
    'UK': { code: 'GBP', symbol: '£', locale: 'en-GB' },
    '德国': { code: 'EUR', symbol: '€', locale: 'de-DE' },
    'DE': { code: 'EUR', symbol: '€', locale: 'de-DE' },
    '法国': { code: 'EUR', symbol: '€', locale: 'fr-FR' },
    'FR': { code: 'EUR', symbol: '€', locale: 'fr-FR' },
    '意大利': { code: 'EUR', symbol: '€', locale: 'it-IT' },
    'IT': { code: 'EUR', symbol: '€', locale: 'it-IT' },
    '西班牙': { code: 'EUR', symbol: '€', locale: 'es-ES' },
    'ES': { code: 'EUR', symbol: '€', locale: 'es-ES' },
    '加拿大': { code: 'CAD', symbol: 'C$', locale: 'en-CA' },
    'CA': { code: 'CAD', symbol: 'C$', locale: 'en-CA' },
    '墨西哥': { code: 'MXN', symbol: '$', locale: 'es-MX' },
    'MX': { code: 'MXN', symbol: '$', locale: 'es-MX' },
    '日本': { code: 'JPY', symbol: '¥', locale: 'ja-JP' },
    'JP': { code: 'JPY', symbol: '¥', locale: 'ja-JP' },
    '澳大利亚': { code: 'AUD', symbol: 'A$', locale: 'en-AU' },
    'AU': { code: 'AUD', symbol: 'A$', locale: 'en-AU' },
};

const getCurrencyInfo = (country: string = '美国') => {
    return COUNTRY_CURRENCY_MAP[country] || COUNTRY_CURRENCY_MAP['美国'];
};

export const getCurrencySymbol = (country: string = '美国'): string => {
    return getCurrencyInfo(country).symbol;
};

// --- Formatting ---
export const formatMoney = (amount: number | undefined, country: string = '美国'): string => {
    if (amount === undefined || amount === null) return getCurrencySymbol(country) + '0.00';
    const info = getCurrencyInfo(country);
    return new Intl.NumberFormat(info.locale, { style: 'currency', currency: info.code }).format(amount);
};

export const formatMoneyNoDecimals = (amount: number | undefined, country: string = '美国'): string => {
    if (amount === undefined || amount === null) return getCurrencySymbol(country) + '0';
    const info = getCurrencyInfo(country);
    return new Intl.NumberFormat(info.locale, { 
        style: 'currency', 
        currency: info.code, 
        minimumFractionDigits: 0, 
        maximumFractionDigits: 0 
    }).format(amount);
};

export const formatRMB = (amount: number | undefined): string => {
    if (amount === undefined || amount === null) return '¥0';
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
};

export const formatPrice = (amount: number | undefined, country: string = '美国'): string => {
    return formatMoney(amount, country);
};

export const formatNumber = (num: number | undefined): string => {
    if (num === undefined || num === null) return '0';
    return new Intl.NumberFormat('en-US').format(num);
};

export const formatPercent = (num: number | undefined): string => {
    if (num === undefined || num === null) return '0.00%';
    return (num * 100).toFixed(2) + '%';
};

// --- Amazon Link Utilities ---

const MARKETPLACE_DOMAINS: Record<string, string> = {
    // North America
    'US': 'https://www.amazon.com',
    '美国': 'https://www.amazon.com',
    'USA': 'https://www.amazon.com',
    'CA': 'https://www.amazon.ca',
    'Canada': 'https://www.amazon.ca',
    '加拿大': 'https://www.amazon.ca',
    'MX': 'https://www.amazon.com.mx',
    'Mexico': 'https://www.amazon.com.mx',
    '墨西哥': 'https://www.amazon.com.mx',
    
    // Europe
    'UK': 'https://www.amazon.co.uk',
    '英国': 'https://www.amazon.co.uk',
    'GB': 'https://www.amazon.co.uk',
    'United Kingdom': 'https://www.amazon.co.uk',
    'DE': 'https://www.amazon.de',
    '德国': 'https://www.amazon.de',
    'Germany': 'https://www.amazon.de',
    'Deutschland': 'https://www.amazon.de',
    'FR': 'https://www.amazon.fr',
    '法国': 'https://www.amazon.fr',
    'France': 'https://www.amazon.fr',
    'IT': 'https://www.amazon.it',
    'Italy': 'https://www.amazon.it',
    '意大利': 'https://www.amazon.it',
    'ES': 'https://www.amazon.es',
    'Spain': 'https://www.amazon.es',
    '西班牙': 'https://www.amazon.es',
    'NL': 'https://www.amazon.nl',
    'Netherlands': 'https://www.amazon.nl',
    '荷兰': 'https://www.amazon.nl',
    'SE': 'https://www.amazon.se',
    'Sweden': 'https://www.amazon.se',
    '瑞典': 'https://www.amazon.se',
    'PL': 'https://www.amazon.pl',
    'Poland': 'https://www.amazon.pl',
    '波兰': 'https://www.amazon.pl',
    'BE': 'https://www.amazon.com.be',
    'Belgium': 'https://www.amazon.com.be',
    '比利时': 'https://www.amazon.com.be',
    'TR': 'https://www.amazon.com.tr',
    'Turkey': 'https://www.amazon.com.tr',
    '土耳其': 'https://www.amazon.com.tr',

    // APAC & Others (Just in case)
    'JP': 'https://www.amazon.co.jp',
    'Japan': 'https://www.amazon.co.jp',
    '日本': 'https://www.amazon.co.jp',
    'AU': 'https://www.amazon.com.au',
    'Australia': 'https://www.amazon.com.au',
    '澳大利亚': 'https://www.amazon.com.au',
    
    // Fallback
    'Unknown': 'https://www.amazon.com'
};

export const getAmazonProductLink = (asin: string, country: string = 'US'): string => {
    let domain = MARKETPLACE_DOMAINS['US']; 
    const countryKey = Object.keys(MARKETPLACE_DOMAINS).find(k => k.toLowerCase() === country.trim().toLowerCase());
    if (countryKey) {
        domain = MARKETPLACE_DOMAINS[countryKey];
    }
    return `${domain}/dp/${asin}`;
};


// --- Filtering ---

// Enhanced: Case Insensitive Matching for Filters
const checkMultiValueMatch = (rowValue: string, activeFilters: string[]): boolean => {
    if (activeFilters.includes('__NONE__')) return false; 
    if (activeFilters.length === 0) return true;
    if (!rowValue) return false;
    
    const parts = rowValue.split(/[,，/]/).map(s => s.trim().toLowerCase());
    return parts.some(part => activeFilters.some(f => f.toLowerCase() === part));
};

export const filterData = (data: DataRow[], period: { start: Date; end: Date }, filters: FilterState): DataRow[] => {
  const startDateStr = formatDate(period.start);
  const endDateStr = formatDate(period.end);

  return data.filter(row => {
    // 1. Date Filter
    if (row.date < startDateStr || row.date > endDateStr) return false;

    // 2. Dimension Filters with Multi-Value Support & Case Insensitivity
    if (filters.countries.includes('__NONE__')) return false;
    if (filters.countries.length > 0 && !filters.countries.includes(row.country)) return false;
    
    if (!checkMultiValueMatch(row.brand, filters.brands)) return false;
    if (!checkMultiValueMatch(row.manager, filters.managers)) return false;
    if (!checkMultiValueMatch(row.shop_name, filters.shops)) return false;
    
    if (filters.subCategories.includes('__NONE__')) return false;
    if (filters.subCategories.length > 0 && !filters.subCategories.includes(row.sub_category)) return false;
    
    if (filters.parentAsins.includes('__NONE__')) return false;
    if (filters.parentAsins.length > 0 && !filters.parentAsins.includes(row.parent_asin)) return false;
    
    if (filters.childAsins.includes('__NONE__')) return false;
    if (filters.childAsins.length > 0 && !filters.childAsins.includes(row.child_asin)) return false;
    
    if (filters.productNames.includes('__NONE__')) return false;
    if (filters.productNames.length > 0 && !filters.productNames.includes(row.product_name)) return false;
    
    return true;
  });
};

export const filterInventoryData = (data: InventoryRow[], filters: FilterState): InventoryRow[] => {
    return data.filter(row => {
        if (filters.countries.includes('__NONE__')) return false;
        if (filters.countries.length > 0 && !filters.countries.includes(row.country)) return false;
        
        // Use the Case Insensitive Matcher
        if (!checkMultiValueMatch(row.brand, filters.brands)) return false;
        if (!checkMultiValueMatch(row.manager, filters.managers)) return false;
        if (!checkMultiValueMatch(row.shop_name, filters.shops)) return false;
        
        if (filters.subCategories.includes('__NONE__')) return false;
        if (filters.subCategories.length > 0 && !filters.subCategories.includes(row.category_2)) return false;
        
        if (filters.parentAsins.includes('__NONE__')) return false;
        if (filters.parentAsins.length > 0 && !filters.parentAsins.includes(row.parent_asin)) return false;
        
        if (filters.childAsins.includes('__NONE__')) return false;
        if (filters.childAsins.length > 0 && !filters.childAsins.includes(row.asin)) return false;
        
        if (filters.productNames.includes('__NONE__')) return false;
        if (filters.productNames.length > 0 && !filters.productNames.includes(row.product_name)) return false;
        
        return true;
    });
};

// --- Enrichment Logic (Strict Mode: Do NOT map from Performance) ---
export const enrichTargetData = (targets: TargetRow[], performance: DataRow[]): TargetRow[] => {
    // NOTE: User explicitly requested to rely on Target Table data ONLY and not match against Performance table.
    
    return targets.map(t => {
        // Force 'All' to 'Unknown' to prevent invisible filter issues
        const cleanBrand = t.brand === 'All' ? 'Unknown' : (t.brand || 'Unknown');
        const cleanShop = t.shop_name === 'All' ? 'Unknown' : (t.shop_name || 'Unknown');
        const cleanManager = t.manager === 'All' ? 'Unknown' : (t.manager || 'Unknown');
        const cleanCountry = t.country === 'All' ? 'Unknown' : (t.country || 'Unknown');

        return {
            ...t,
            brand: cleanBrand,
            shop_name: cleanShop,
            country: cleanCountry,
            manager: cleanManager,
            parent_asin: t.parent_asin || 'Unknown',
            sub_category: t.sub_category || 'Unknown'
        };
    });
};

// --- Aggregation Constants ---

export const initialAggregated: AggregatedData = {
    sales_quantity: 0,
    sales_amount: 0,
    gross_profit: 0,
    fba_sellable_qty: 0,
    sessions: 0,
    first_mile_cost: 0,
    procurement_cost: 0,
    storage_fee: 0,
    fba_fee: 0,
    refund_cost: 0,
    platform_commission: 0,
    ad_spend: 0,
    ad_sales: 0,
    ad_orders: 0,
    sp_spend: 0,
    sp_sales: 0,
    sd_spend: 0,
    sd_sales: 0,
    sb_spend: 0,
    sb_sales: 0,
    sbv_spend: 0,
    sbv_sales: 0,
    impressions: 0,
    clicks: 0,
    natural_orders: 0,
    natural_clicks: 0,
    gross_margin: 0,
    avg_ticket: 0,
    review_count: 0,
    average_rating: 0
};

export const initialInventoryAggregated: InventoryAggregated = {
    fba_total_qty: 0,
    fba_total_cost: 0,
    age_0_30_qty: 0,
    age_0_30_cost: 0,
    age_31_60_qty: 0,
    age_31_60_cost: 0,
    age_61_90_qty: 0,
    age_61_90_cost: 0,
    age_91_180_qty: 0,
    age_91_180_cost: 0,
    age_181_270_qty: 0,
    age_181_270_cost: 0,
    age_271_330_qty: 0,
    age_271_330_cost: 0,
    age_331_365_qty: 0,
    age_331_365_cost: 0,
    age_365_plus_qty: 0,
    age_365_plus_cost: 0,
    awd_total_qty: 0,
    awd_total_cost: 0
};

// --- Aggregation Logic ---

export const aggregateData = (rows: DataRow[]): AggregatedData => {
    const agg = { ...initialAggregated };
    let ratingSum = 0;
    let ratingCount = 0;

    rows.forEach(row => {
        agg.sales_quantity += row.sales_quantity;
        agg.sales_amount += row.sales_amount;
        agg.gross_profit += row.gross_profit;
        
        agg.sessions += row.sessions;
        agg.first_mile_cost += row.first_mile_cost;
        agg.procurement_cost += row.procurement_cost;
        agg.storage_fee += row.storage_fee;
        agg.fba_fee += row.fba_fee;
        agg.refund_cost += row.refund_cost;
        agg.platform_commission += row.platform_commission;
        agg.ad_spend += row.ad_spend;
        agg.ad_sales += row.ad_sales;
        agg.ad_orders += row.ad_orders;
        agg.sp_spend += row.sp_spend;
        agg.sp_sales += row.sp_sales;
        agg.sd_spend += row.sd_spend;
        agg.sd_sales += row.sd_sales;
        agg.sb_spend += row.sb_spend;
        agg.sb_sales += row.sb_sales;
        agg.sbv_spend += row.sbv_spend;
        agg.sbv_sales += row.sbv_sales;
        agg.impressions += row.impressions;
        agg.clicks += row.clicks;
        agg.natural_orders += row.natural_orders;
        agg.natural_clicks += row.natural_clicks;
        
        if (row.rating > 0) {
            ratingSum += row.rating * row.review_count; 
            ratingCount += row.review_count;
        }
        agg.review_count += row.review_count;
    });
    
    // For Stock, use snapshot of last day in the range
    if (rows.length > 0) {
        const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
        const lastRow = sorted[sorted.length - 1];
        const lastDate = lastRow.date;
        // Sum stock for all rows on that last day
        const lastDayRows = rows.filter(r => r.date === lastDate);
        agg.fba_sellable_qty = lastDayRows.reduce((sum, r) => sum + r.fba_sellable_qty, 0);
    }

    agg.gross_margin = agg.sales_amount > 0 ? agg.gross_profit / agg.sales_amount : 0;
    agg.avg_ticket = agg.sales_quantity > 0 ? agg.sales_amount / agg.sales_quantity : 0;
    agg.average_rating = ratingCount > 0 ? ratingSum / ratingCount : 0;

    return agg;
};

export const aggregateInventoryData = (rows: InventoryRow[]): InventoryAggregated => {
    const agg = { ...initialInventoryAggregated };
    rows.forEach(r => {
        agg.fba_total_qty += r.fba_total_qty;
        agg.fba_total_cost += r.fba_total_cost;
        agg.age_0_30_qty += r.age_0_30_qty;
        agg.age_0_30_cost += r.age_0_30_cost;
        agg.age_31_60_qty += r.age_31_60_qty;
        agg.age_31_60_cost += r.age_31_60_cost;
        agg.age_61_90_qty += r.age_61_90_qty;
        agg.age_61_90_cost += r.age_61_90_cost;
        agg.age_91_180_qty += r.age_91_180_qty;
        agg.age_91_180_cost += r.age_91_180_cost;
        agg.age_181_270_qty += r.age_181_270_qty;
        agg.age_181_270_cost += r.age_181_270_cost;
        agg.age_271_330_qty += r.age_271_330_qty;
        agg.age_271_330_cost += r.age_271_330_cost;
        agg.age_331_365_qty += r.age_331_365_qty;
        agg.age_331_365_cost += r.age_331_365_cost;
        agg.age_365_plus_qty += r.age_365_plus_qty;
        agg.age_365_plus_cost += r.age_365_plus_cost;
        agg.awd_total_qty += r.awd_total_qty;
        agg.awd_total_cost += r.awd_total_cost;
    });
    return agg;
};

/**
 * 多条「业绩已聚合行」在指标上相加（子表：父 ASIN 折叠时汇总其下多子 ASIN 行；与主表求总逻辑一致）
 */
export const sumAggregatedData = (list: AggregatedData[]): AggregatedData => {
    if (list.length === 0) return { ...initialAggregated };
    const acc: AggregatedData = { ...initialAggregated };
    let totalRatingScore = 0;
    let totalReviewCountForRating = 0;
    for (const d of list) {
        acc.sales_quantity += d.sales_quantity;
        acc.sales_amount += d.sales_amount;
        acc.gross_profit += d.gross_profit;
        acc.fba_sellable_qty += d.fba_sellable_qty;
        acc.sessions += d.sessions;
        acc.first_mile_cost += d.first_mile_cost;
        acc.procurement_cost += d.procurement_cost;
        acc.storage_fee += d.storage_fee;
        acc.fba_fee += d.fba_fee;
        acc.refund_cost += d.refund_cost;
        acc.platform_commission += d.platform_commission;
        acc.ad_spend += d.ad_spend;
        acc.ad_sales += d.ad_sales;
        acc.ad_orders += d.ad_orders;
        acc.sp_spend += d.sp_spend;
        acc.sp_sales += d.sp_sales;
        acc.sd_spend += d.sd_spend;
        acc.sd_sales += d.sd_sales;
        acc.sb_spend += d.sb_spend;
        acc.sb_sales += d.sb_sales;
        acc.sbv_spend += d.sbv_spend;
        acc.sbv_sales += d.sbv_sales;
        acc.impressions += d.impressions;
        acc.clicks += d.clicks;
        acc.natural_orders += d.natural_orders;
        acc.natural_clicks += d.natural_clicks;
        acc.review_count += d.review_count;
        if (d.average_rating > 0 && d.review_count > 0) {
            totalRatingScore += d.average_rating * d.review_count;
            totalReviewCountForRating += d.review_count;
        }
    }
    acc.gross_margin = acc.sales_amount ? acc.gross_profit / acc.sales_amount : 0;
    acc.avg_ticket = acc.sales_quantity ? acc.sales_amount / acc.sales_quantity : 0;
    acc.average_rating = totalReviewCountForRating > 0 ? totalRatingScore / totalReviewCountForRating : 0;
    return acc;
};

/** 多条 FBA 库存已聚合行相加 */
export const sumInventoryAggregated = (list: InventoryAggregated[]): InventoryAggregated => {
    if (list.length === 0) return { ...initialInventoryAggregated };
    return list.reduce((a, c) => {
        const n = { ...a };
        (Object.keys(n) as Array<keyof InventoryAggregated>).forEach((k) => {
            n[k] = (a[k] as number) + (c[k] as number);
        });
        return n;
    }, { ...initialInventoryAggregated });
};

export const getTargetForSelection = (
    targets: TargetRow[],
    start: Date,
    end: Date,
    filters: FilterState,
    pacingRatio: number = 1
): AggregatedData => {
    const sStr = formatDate(start).substring(0, 7);
    const eStr = formatDate(end).substring(0, 7);
    
    const agg = { ...initialAggregated };

    const filteredTargets = targets.filter(t => {
        if (t.month < sStr || t.month > eStr) return false;
        
        // Handle __NONE__ case and Case Insensitive Matching
        if (filters.countries.includes('__NONE__')) return false;
        if (filters.countries.length > 0 && !filters.countries.includes(t.country)) return false;
        
        // Use checkMultiValueMatch helper for fuzzy logic if needed, or simple insensitive check
        // Re-implementing simplified logic here for performance
        if (filters.brands.includes('__NONE__')) return false;
        if (filters.brands.length > 0) {
             const tBrand = (t.brand || '').toLowerCase();
             if (!filters.brands.some(f => f.toLowerCase() === tBrand)) return false;
        }
        
        if (filters.managers.includes('__NONE__')) return false;
        if (filters.managers.length > 0) {
             const tVal = (t.manager || '').toLowerCase();
             if (!filters.managers.some(f => f.toLowerCase() === tVal)) return false;
        }
        
        if (filters.shops.includes('__NONE__')) return false;
        if (filters.shops.length > 0) {
             const tVal = (t.shop_name || '').toLowerCase();
             if (!filters.shops.some(f => f.toLowerCase() === tVal)) return false;
        }
        
        if (filters.subCategories.includes('__NONE__')) return false;
        if (filters.subCategories.length > 0 && !filters.subCategories.includes(t.sub_category)) return false;
        
        if (filters.parentAsins.includes('__NONE__')) return false;
        if (filters.parentAsins.length > 0 && !filters.parentAsins.includes(t.parent_asin)) return false;
        
        if (filters.childAsins.includes('__NONE__')) return false;
        if (filters.childAsins.length > 0 && !filters.childAsins.includes(t.child_asin)) return false;
        
        if (filters.productNames.includes('__NONE__')) return false;
        if (filters.productNames.length > 0 && !filters.productNames.includes(t.product_name)) return false;
        
        return true;
    });

    filteredTargets.forEach(t => {
         agg.sales_quantity += t.sales_quantity_target;
         agg.sales_amount += t.sales_amount_target;
         agg.gross_profit += t.gross_profit_target;
         agg.ad_spend += t.ad_spend_target;
    });

    if (pacingRatio !== 1) {
        agg.sales_quantity *= pacingRatio;
        agg.sales_amount *= pacingRatio;
        agg.gross_profit *= pacingRatio;
        agg.ad_spend *= pacingRatio;
    }
    
    agg.gross_margin = agg.sales_amount > 0 ? agg.gross_profit / agg.sales_amount : 0;
    return agg;
};

export const analyzeDataCompleteness = (current: DataRow[], last: DataRow[], year: DataRow[], periods: any) => {
    const warnings: string[] = [];
    if (current.length === 0) warnings.push("当前时间段无数据");
    if (last.length === 0) warnings.push("环比(上期)数据缺失");
    if (year.length === 0) warnings.push("同比(去年)数据缺失");
    
    return {
        validPeriods: {
            current: current.length > 0,
            last: last.length > 0,
            year: year.length > 0
        },
        warnings
    };
};

// New: Check for Missing Targets in Range
export const analyzeTargetCompleteness = (targetData: TargetRow[], start: Date, end: Date): string[] => {
    const warnings: string[] = [];
    if (targetData.length === 0) return warnings; 

    // Get unique months in target data
    const availableMonths = new Set(targetData.map(t => t.month));

    // Iterate selection
    let curr = new Date(start.getFullYear(), start.getMonth(), 1);
    const endTime = new Date(end.getFullYear(), end.getMonth(), 1).getTime();

    const missingMonths: string[] = [];

    // Safety break loop
    let loops = 0;
    while (curr.getTime() <= endTime && loops < 60) {
        const y = curr.getFullYear();
        const m = (curr.getMonth() + 1).toString().padStart(2, '0');
        const monthStr = `${y}-${m}`;

        if (!availableMonths.has(monthStr)) {
            missingMonths.push(monthStr);
        }
        curr.setMonth(curr.getMonth() + 1);
        loops++;
    }

    if (missingMonths.length > 0) {
        // Formatting the message
        if (missingMonths.length > 3) {
             warnings.push(`缺失目标数据: ${missingMonths.slice(0, 3).join(', ')}...等${missingMonths.length}个月`);
        } else {
             warnings.push(`缺失目标数据: ${missingMonths.join(', ')}`);
        }
    }
    return warnings;
};

export const groupDataByDimension = (
    current: DataRow[], 
    last: DataRow[], 
    year: DataRow[], 
    dimensions: (keyof DataRow | 'year_month')[]
) => {
    const groups: Record<string, { 
        dimensions: Record<string, string>, 
        currentRows: DataRow[], 
        lastRows: DataRow[], 
        yearRows: DataRow[] 
    }> = {};

    const getKey = (row: DataRow) => {
        return dimensions.map(d => {
            if (d === 'year_month') return row.date.substring(0, 7);
            return row[d] || 'Unknown';
        }).join('|||');
    };

    const process = (rows: DataRow[], type: 'current' | 'last' | 'year') => {
        rows.forEach(r => {
            const key = getKey(r);
            if (!groups[key]) {
                const dimObj: Record<string, string> = {};
                dimensions.forEach(d => {
                    if (d === 'year_month') dimObj[d] = r.date.substring(0, 7);
                    else dimObj[d] = String(r[d] || 'Unknown');
                });
                groups[key] = {
                    dimensions: dimObj,
                    currentRows: [],
                    lastRows: [],
                    yearRows: []
                };
            }
            if (type === 'current') groups[key].currentRows.push(r);
            else if (type === 'last') groups[key].lastRows.push(r);
            else groups[key].yearRows.push(r);
        });
    };

    process(current, 'current');
    process(last, 'last');
    process(year, 'year');

    return Object.keys(groups).map(key => {
        const g = groups[key];
        const sampleRow = g.currentRows[0] || g.lastRows[0] || g.yearRows[0];
        const sampleCountry = sampleRow ? sampleRow.country : 'US';
        
        return {
            compositeKey: key,
            dimensions: g.dimensions,
            current: aggregateData(g.currentRows),
            last: g.lastRows.length ? aggregateData(g.lastRows) : null,
            year: g.yearRows.length ? aggregateData(g.yearRows) : null,
            sampleCountry
        };
    }).sort((a, b) => b.current.sales_amount - a.current.sales_amount);
};

export const groupTargetsByDimension = (
    targets: TargetRow[],
    dimensions: (keyof TargetRow | 'year_month')[],
    start: Date,
    end: Date,
    pacingRatio: number
): Map<string, AggregatedData> => {
    const map = new Map<string, AggregatedData>();
    const sStr = formatDate(start).substring(0, 7);
    const eStr = formatDate(end).substring(0, 7);

    targets.forEach(t => {
        if (t.month >= sStr && t.month <= eStr) {
            const keyParts = dimensions.map(d => {
                if (d === 'year_month') return t.month;
                return (t as any)[d] || 'Unknown';
            });
            const key = keyParts.join('|||');
            
            let existing = map.get(key);
            if (!existing) {
                existing = { ...initialAggregated };
                map.set(key, existing);
            }
            
            existing.sales_quantity += t.sales_quantity_target;
            existing.sales_amount += t.sales_amount_target;
            existing.gross_profit += t.gross_profit_target;
            existing.ad_spend += t.ad_spend_target;
        }
    });

    if (pacingRatio !== 1) {
        for (const val of map.values()) {
            val.sales_quantity *= pacingRatio;
            val.sales_amount *= pacingRatio;
            val.gross_profit *= pacingRatio;
            val.ad_spend *= pacingRatio;
            val.gross_margin = val.sales_amount > 0 ? val.gross_profit / val.sales_amount : 0;
        }
    } else {
         for (const val of map.values()) {
            val.gross_margin = val.sales_amount > 0 ? val.gross_profit / val.sales_amount : 0;
        }
    }

    return map;
};

export const groupInventoryByDimension = (
    rows: InventoryRow[],
    dimensions: string[]
) => {
    const groups: Record<string, { 
        dimensions: Record<string, string>, 
        rows: InventoryRow[] 
    }> = {};

    rows.forEach(r => {
        const keyParts = dimensions.map(d => {
            if (d === 'sub_category') return r.category_2 || 'Unknown';
            if (d === 'child_asin') return r.asin || 'Unknown';
            return (r as any)[d] || 'Unknown';
        });
        const key = keyParts.join('|||');

        if (!groups[key]) {
             const dimObj: Record<string, string> = {};
             dimensions.forEach((d, i) => {
                 dimObj[d] = keyParts[i];
             });
             groups[key] = { dimensions: dimObj, rows: [] };
        }
        groups[key].rows.push(r);
    });

    return Object.keys(groups).map(key => {
        const g = groups[key];
        const sampleRow = g.rows[0];
        return {
            compositeKey: key,
            dimensions: g.dimensions,
            current: aggregateInventoryData(g.rows),
            sampleCountry: sampleRow ? sampleRow.country : 'US'
        };
    }).sort((a, b) => b.current.fba_total_cost - a.current.fba_total_cost);
};

import type { FilterState, PeriodMode } from '../types';

/**
 * 视图状态 ⇄ URL。
 * 目标：复制链接就能把「同样的粒度 + 区间 + 筛选」发给同事；浏览器前进/后退可用。
 */

const LIST_KEYS: Record<string, keyof FilterState> = {
    country: 'countries',
    shop: 'shops',
    brand: 'brands',
    manager: 'managers',
    sub: 'subCategories',
    pasin: 'parentAsins',
    casin: 'childAsins',
    pname: 'productNames',
};

export type UrlView = {
    mode: PeriodMode | null;
    from: string;
    to: string;
    filters: Partial<FilterState>;
};

const params = () => new URLSearchParams(window.location.search);

export const readViewFromUrl = (): UrlView => {
    const query = params();
    const mode = query.get('mode');
    const filters: Partial<FilterState> = {};
    for (const [key, field] of Object.entries(LIST_KEYS)) {
        const raw = query.get(key);
        if (!raw) continue;
        const values = raw.split(',').map(item => item.trim()).filter(Boolean);
        if (values.length) (filters as Record<string, string[]>)[field] = values;
    }
    return {
        mode: mode === 'day' || mode === 'week' || mode === 'month' ? mode : null,
        from: query.get('from') || '',
        to: query.get('to') || '',
        filters,
    };
};

export const hasViewInUrl = (): boolean => {
    const query = params();
    return ['mode', 'from', 'to', ...Object.keys(LIST_KEYS)].some(key => query.has(key));
};

const toQuery = (mode: PeriodMode, filters: FilterState): string => {
    const query = new URLSearchParams();
    query.set('mode', mode);
    if (filters.startDate) query.set('from', filters.startDate);
    if (filters.endDate) query.set('to', filters.endDate);
    for (const [key, field] of Object.entries(LIST_KEYS)) {
        const values = (filters as unknown as Record<string, string[]>)[field];
        if (Array.isArray(values) && values.length) query.set(key, values.join(','));
    }
    return query.toString();
};

/** 同步到地址栏：内容没变就跳过；变了压一条历史，浏览器前进/后退可以回退视图 */
export const syncViewToUrl = (mode: PeriodMode, filters: FilterState) => {
    const query = toQuery(mode, filters);
    const current = window.location.search.replace(/^\?/, '');
    if (current === query) return;
    window.history.pushState({ ...window.history.state, dshView: true }, '', `${window.location.pathname}?${query}`);
};

/** 生成可分享链接（基于当前地址，去掉 hash） */
export const buildViewLink = (mode: PeriodMode, filters: FilterState): string =>
    `${window.location.origin}${window.location.pathname}?${toQuery(mode, filters)}`;

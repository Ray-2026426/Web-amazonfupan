export type AppTheme = 'light' | 'dark';
export type TableFontSize = 'sm' | 'md' | 'lg';

export type AppSettings = {
    theme: AppTheme;
    tableFontSize: TableFontSize;
};

const STORAGE_KEY = 'app_settings_v1';

const DEFAULTS: AppSettings = {
    theme: 'light',
    tableFontSize: 'md',
};

function readInitialTheme(): AppTheme {
    if (typeof window === 'undefined') return 'light';
    try {
        const legacy = window.localStorage.getItem('app_theme');
        if (legacy === 'light' || legacy === 'dark') return legacy;
    } catch {}
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
    }
    return 'light';
}

export function loadAppSettings(): AppSettings {
    if (typeof window === 'undefined') {
        return { ...DEFAULTS, theme: readInitialTheme() };
    }
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const p = JSON.parse(raw) as Partial<AppSettings>;
            return {
                theme: p.theme === 'dark' || p.theme === 'light' ? p.theme : readInitialTheme(),
                tableFontSize: p.tableFontSize === 'sm' || p.tableFontSize === 'lg' ? p.tableFontSize : 'md',
            };
        }
    } catch {}
    return { ...DEFAULTS, theme: readInitialTheme() };
}

export function saveAppSettings(s: AppSettings) {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
        window.localStorage.setItem('app_theme', s.theme);
    } catch {}
}

export function applyAppSettings(s: AppSettings) {
    const root = document.documentElement;
    if (s.theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    root.dataset.tableFont = s.tableFontSize;
}

export const TABLE_FONT_OPTIONS: { value: TableFontSize; label: string; px: number }[] = [
    { value: 'sm', label: '小', px: 12 },
    { value: 'md', label: '中', px: 14 },
    { value: 'lg', label: '大', px: 16 },
];

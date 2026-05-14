import React, { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

export type AppTheme = 'light' | 'dark';

const STORAGE_KEY = 'app_theme';

function readInitialTheme(): AppTheme {
    if (typeof window === 'undefined') return 'light';
    try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved === 'light' || saved === 'dark') return saved;
    } catch {}
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
    }
    return 'light';
}

function applyTheme(theme: AppTheme) {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
}

export const ThemeToggle: React.FC = () => {
    const [theme, setTheme] = useState<AppTheme>(() => readInitialTheme());

    useEffect(() => {
        applyTheme(theme);
        try {
            window.localStorage.setItem(STORAGE_KEY, theme);
        } catch {}
    }, [theme]);

    const isDark = theme === 'dark';
    const next: AppTheme = isDark ? 'light' : 'dark';
    const label = isDark ? '切换为亮色模式' : '切换为暗色模式';

    return (
        <button
            type="button"
            onClick={() => setTheme(next)}
            title={label}
            aria-label={label}
            className={
                'theme-toggle-btn flex h-10 w-10 items-center justify-center rounded-2xl border text-sm shadow-sm ' +
                (isDark
                    ? 'border-[#30363d] bg-[#21262d] text-amber-300 hover:bg-[#30363d]'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')
            }
        >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
    );
};

import React, { useEffect, useRef, useState } from 'react';
import { Settings, Sun, Moon, X } from 'lucide-react';
import {
    applyAppSettings,
    loadAppSettings,
    saveAppSettings,
    TABLE_FONT_OPTIONS,
    type AppSettings,
    type AppTheme,
    type TableFontSize,
} from './appSettings';
import { useEscClose } from './useEscClose';

export const AppSettingsButton: React.FC = () => {
    const [open, setOpen] = useState(false);
    const [settings, setSettings] = useState<AppSettings>(() => loadAppSettings());
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        applyAppSettings(settings);
        saveAppSettings(settings);
    }, [settings]);

    useEscClose(open, () => setOpen(false));

    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [open]);

    const setTheme = (theme: AppTheme) => setSettings((prev) => ({ ...prev, theme }));
    const setTableFontSize = (tableFontSize: TableFontSize) => setSettings((prev) => ({ ...prev, tableFontSize }));

    const isDark = settings.theme === 'dark';

    return (
        <div ref={panelRef} className="relative">
            {open && (
                <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
                    <div className="mb-3 flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-700">总控设置</span>
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            className="rounded p-0.5 text-slate-400 hover:bg-slate-100"
                            aria-label="关闭"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>

                    <div className="space-y-3">
                        <div>
                            <div className="mb-1.5 text-[11px] font-semibold text-slate-500">外观</div>
                            <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                                <button
                                    type="button"
                                    onClick={() => setTheme('light')}
                                    className={
                                        'flex flex-1 items-center justify-center gap-1 rounded-md py-1.5 text-[11px] font-semibold transition-colors ' +
                                        (!isDark ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-500 hover:text-slate-700')
                                    }
                                >
                                    <Sun className="h-3 w-3" />
                                    亮色
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setTheme('dark')}
                                    className={
                                        'flex flex-1 items-center justify-center gap-1 rounded-md py-1.5 text-[11px] font-semibold transition-colors ' +
                                        (isDark ? 'bg-[#21262d] text-amber-300 shadow-sm' : 'text-slate-500 hover:text-slate-700')
                                    }
                                >
                                    <Moon className="h-3 w-3" />
                                    暗色
                                </button>
                            </div>
                        </div>

                        <div>
                            <div className="mb-1.5 text-[11px] font-semibold text-slate-500">表格字号</div>
                            <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                                {TABLE_FONT_OPTIONS.map((opt) => (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        onClick={() => setTableFontSize(opt.value)}
                                        className={
                                            'flex-1 rounded-md py-1.5 text-[11px] font-semibold transition-colors ' +
                                            (settings.tableFontSize === opt.value
                                                ? 'bg-white text-sky-700 shadow-sm'
                                                : 'text-slate-500 hover:text-slate-700')
                                        }
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                title="总控设置"
                aria-label="总控设置"
                className={
                    'flex h-9 w-9 items-center justify-center rounded-2xl border shadow-sm transition-all hover:scale-105 active:scale-95 ' +
                    (isDark
                        ? 'border-[#30363d] bg-[#21262d] text-slate-400 hover:bg-[#30363d] hover:text-slate-200'
                        : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700')
                }
            >
                <Settings className="h-3.5 w-3.5" />
            </button>
        </div>
    );
};

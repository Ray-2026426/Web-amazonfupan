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
    type TableDensity,
} from './appSettings';
import { useEscClose } from './useEscClose';

export const AppSettingsButton: React.FC<{
    /** 云端数据源相关：原来是顶栏的一排按钮，现在收进设置面板 */
    cloudEnabled?: boolean;
    cloudConnected?: boolean;
    cloudLoading?: boolean;
    /** 云端数据截止日，正常状态不占版面，显示在这里 */
    cloudCutoff?: string;
    /** 最近一次成功同步时间 */
    cloudLastSync?: string;
    onOpenCloudLogin?: () => void;
    onOpenCloudAdmin?: () => void;
    /** 毛利修正：把 FBA 国际运费加回毛利 */
    addBackFbaFee?: boolean;
    onToggleFbaFee?: (next: boolean) => void;
}> = ({ cloudEnabled = false, cloudConnected = false, cloudLoading = false, cloudCutoff = '', cloudLastSync = '', onOpenCloudLogin, onOpenCloudAdmin, addBackFbaFee = true, onToggleFbaFee }) => {
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
    const setTableDensity = (tableDensity: TableDensity) => setSettings((prev) => ({ ...prev, tableDensity }));

    const isDark = settings.theme === 'dark';

    return (
        <div ref={panelRef} className="relative">
            {open && (
                <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
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
                        <div>
                            <div className="mb-1.5 text-[11px] font-semibold text-slate-500">表格密度</div>
                            <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                                {(['compact', 'comfortable'] as const).map(density => <button key={density} type="button" onClick={() => setTableDensity(density)} className={`flex-1 rounded-md py-1.5 text-[11px] font-semibold ${settings.tableDensity === density ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-500'}`}>{density === 'compact' ? '紧凑' : '舒适'}</button>)}
                            </div>
                        </div>

                        {cloudEnabled && (
                            <div className="border-t border-slate-100 pt-3">
                                <div className="mb-1.5 flex items-center justify-between">
                                    <span className="text-[11px] font-semibold text-slate-500">数据源</span>
                                    <span className={`text-[10px] font-semibold ${cloudConnected ? 'text-emerald-600' : 'text-slate-400'}`}>
                                        {cloudLoading ? '云端加载中…' : cloudConnected ? `已连接${cloudCutoff ? ` · 截止 ${cloudCutoff}` : ''}` : '未连接'}
                                    </span>
                                </div>
                                <div className="grid grid-cols-2 gap-1.5">
                                    <button
                                        type="button"
                                        onClick={() => { setOpen(false); onOpenCloudLogin?.(); }}
                                        className="rounded-lg border border-slate-200 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
                                    >
                                        {cloudConnected ? '切换云端' : '连接云端'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { setOpen(false); onOpenCloudAdmin?.(); }}
                                        className="rounded-lg border border-slate-200 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
                                    >
                                        数据管理
                                    </button>
                                </div>
                                {cloudConnected && (cloudCutoff || cloudLastSync) && (
                                    <p className="mt-1.5 text-[10px] leading-snug text-slate-400">
                                        {cloudCutoff ? `最新数据 ${cloudCutoff}` : ''}
                                        {cloudCutoff && cloudLastSync ? ' · ' : ''}
                                        {cloudLastSync ? `上次同步 ${cloudLastSync}` : ''}
                                    </p>
                                )}
                            </div>
                        )}

                        <div className="border-t border-slate-100 pt-3">
                            <div className="mb-1.5 text-[11px] font-semibold text-slate-500">计算口径</div>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={addBackFbaFee}
                                onClick={() => onToggleFbaFee?.(!addBackFbaFee)}
                                className="flex w-full items-start justify-between gap-2 text-left"
                            >
                                <span className="min-w-0">
                                    <span className="block text-[11px] font-semibold text-slate-700">毛利修正</span>
                                    <span className="mt-0.5 block text-[10px] leading-snug text-slate-400">
                                        把 FBA 国际运费加回毛利（该费用已含在头程，领星又扣了一次）
                                    </span>
                                </span>
                                <span className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition ${addBackFbaFee ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${addBackFbaFee ? 'left-[18px]' : 'left-0.5'}`} />
                                </span>
                            </button>
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
                    'flex h-9 w-9 items-center justify-center rounded-2xl border shadow-sm transition-colors active:scale-95 ' +
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

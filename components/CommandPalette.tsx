import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';

export type CommandAction = {
    id: string;
    label: string;
    group?: string;
    hint?: string;
    keywords?: string[];
    run: () => void;
};

interface CommandPaletteProps {
    open: boolean;
    onClose: () => void;
    actions: CommandAction[];
}

/**
 * 命令面板（⌘K / Ctrl+K）：
 * 键盘就能完成「切粒度、跳区间、开数据管理、下钻」等常用动作，不用满屏找按钮。
 */
export const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onClose, actions }) => {
    const [query, setQuery] = useState('');
    const [cursor, setCursor] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (open) {
            setQuery('');
            setCursor(0);
            // 打开后聚焦输入框（等一帧，避免动画期间抢焦点失败）
            const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
            return () => window.clearTimeout(timer);
        }
    }, [open]);

    const filtered = useMemo(() => {
        const keyword = query.trim().toLowerCase();
        if (!keyword) return actions;
        return actions.filter(action => {
            const haystack = [action.label, action.group, action.hint, ...(action.keywords || [])].filter(Boolean).join(' ').toLowerCase();
            return haystack.includes(keyword);
        });
    }, [actions, query]);

    useEffect(() => {
        setCursor(0);
    }, [query]);

    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
            } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                setCursor(prev => Math.min(prev + 1, Math.max(filtered.length - 1, 0)));
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setCursor(prev => Math.max(prev - 1, 0));
            } else if (event.key === 'Enter') {
                event.preventDefault();
                const action = filtered[cursor];
                if (action) {
                    action.run();
                    onClose();
                }
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, filtered, cursor, onClose]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[220] flex items-start justify-center bg-slate-950/40 p-4 pt-[12vh] backdrop-blur-sm" onClick={onClose}>
            <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={event => event.stopPropagation()}>
                <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
                    <Search className="h-4 w-4 shrink-0 text-slate-400" />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                        placeholder="搜索功能或输入命令，例如「日度」「补数」「数据管理」"
                        className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
                    />
                    <span className="shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-400">Esc</span>
                </div>
                <div className="max-h-[52vh] overflow-y-auto py-1">
                    {filtered.length === 0 && <p className="px-4 py-6 text-center text-xs text-slate-400">没有匹配的命令</p>}
                    {filtered.map((action, index) => (
                        <button
                            key={action.id}
                            type="button"
                            onMouseEnter={() => setCursor(index)}
                            onClick={() => {
                                action.run();
                                onClose();
                            }}
                            className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition ${index === cursor ? 'bg-sky-50 text-sky-800' : 'text-slate-700 hover:bg-slate-50'}`}
                        >
                            <span className="flex min-w-0 items-center gap-2">
                                <span className="truncate">{action.label}</span>
                                {action.hint && <span className="truncate text-[11px] text-slate-400">{action.hint}</span>}
                            </span>
                            {action.group && <span className="shrink-0 text-[10px] text-slate-400">{action.group}</span>}
                        </button>
                    ))}
                </div>
                <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-[10px] text-slate-400">
                    <span>↑↓ 选择 · Enter 执行 · Esc 关闭</span>
                    <span>⌘K / Ctrl+K 随时唤起</span>
                </div>
            </div>
        </div>
    );
};

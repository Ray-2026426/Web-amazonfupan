import React, { useEffect, useState } from 'react';

/**
 * 加载骨架。
 *
 * 为什么要自己走进度条：CSS 动画会被「减少动效」系统设置直接关掉（Windows 的
 * “动画效果”关闭时很常见），那时骨架屏就是一块静止的灰块，看起来像卡死。
 * 这里用 JS 每 200ms 推进一次进度（0 → 90%），不依赖 CSS 动画，任何设置下都有反馈。
 */
export const LoadingSkeleton: React.FC<{ label?: string }> = ({ label }) => {
    const [pct, setPct] = useState(6);
    const [seconds, setSeconds] = useState(0);

    useEffect(() => {
        const timer = window.setInterval(() => {
            setPct(prev => (prev >= 90 ? 90 : prev + Math.max(1, (90 - prev) * 0.12)));
        }, 200);
        const clock = window.setInterval(() => setSeconds(value => value + 1), 1000);
        return () => {
            window.clearInterval(timer);
            window.clearInterval(clock);
        };
    }, []);

    return (
        <div className="mx-auto max-w-[1680px] space-y-4" aria-busy="true" aria-live="polite">
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
                    <span className="flex min-w-0 items-center gap-2">
                        <svg className="h-3.5 w-3.5 animate-spin text-sky-500" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                        </svg>
                        <span className="truncate">{label || '正在加载数据…'}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-[11px] text-slate-400">{seconds}s</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-sky-600 transition-all duration-200" style={{ width: `${pct}%` }} />
                </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-2">
                    <div className="skeleton h-6 w-28 rounded-lg" />
                    <div className="skeleton mt-4 h-9 w-48 rounded-lg" />
                    <div className="skeleton mt-3 h-3 w-64 rounded" />
                    <div className="skeleton mt-5 h-14 w-full rounded-xl" />
                    <div className="skeleton mt-4 h-2 w-full rounded-full" />
                </div>
                <div className="space-y-3">
                    {[0, 1, 2].map(index => (
                        <div key={index} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                            <div className="skeleton h-3 w-16 rounded" />
                            <div className="skeleton mt-2 h-5 w-24 rounded" />
                        </div>
                    ))}
                </div>
            </div>
            {[0, 1].map(index => (
                <div key={index} className="rounded-2xl border border-slate-200 bg-white p-5">
                    <div className="skeleton h-4 w-32 rounded" />
                    <div className="mt-4 space-y-2">
                        {[0, 1, 2, 3].map(row => (
                            <div key={row} className="skeleton h-8 w-full rounded-lg" />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
};

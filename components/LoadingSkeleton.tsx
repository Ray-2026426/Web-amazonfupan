import React from 'react';

/** 加载骨架：比整页转圈更能说明「马上要出现什么」，也不会有布局跳动 */
export const LoadingSkeleton: React.FC = () => (
    <div className="mx-auto max-w-[1680px] space-y-4" aria-busy="true" aria-live="polite">
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
        <p className="text-center text-xs text-slate-400">正在加载数据…</p>
    </div>
);

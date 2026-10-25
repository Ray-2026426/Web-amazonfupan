/**
 * 全局错误边界
 *
 * 为什么需要：任何组件在渲染期抛错，React 会卸载整棵树 —— 用户看到的就是纯白页面，
 * 而控制台在用户机器上没人会看。这里把「白屏」变成「可读的错误卡片 + 重试」，
 * 并把 message / 组件栈保留在页面上，方便截图反馈。
 *
 * 注意：本项目没有安装 @types/react（React 的类型是隐式的 any），
 * 所以基类用显式的构造器类型兜住，内部通过 `this as any` 取 setState/props。
 * 将来补上 @types/react 后，这里可以改回 `extends React.Component<Props, State>`。
 */
import React, { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { isChunkLoadError } from './lazyWithRetry';

interface Props {
    children: ReactNode;
}

interface State {
    error: Error | null;
    info: string;
    showDetail: boolean;
}

type ComponentBase = new (props: Props) => { setState: (s: Partial<State>) => void };

const Base = Component as unknown as ComponentBase;

export class ErrorBoundary extends Base {
    state: State = { error: null, info: '', showDetail: false };

    static getDerivedStateFromError(error: Error): Partial<State> {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        (this as any).setState({ info: (info && info.componentStack) || '' });
        console.error('[ErrorBoundary]', error, info && info.componentStack);
    }

    private reset = () => {
        (this as any).setState({ error: null, info: '', showDetail: false });
    };

    private toggleDetail = () => {
        const current = ((this as any).state as State).showDetail;
        (this as any).setState({ showDetail: !current });
    };

    render() {
        const { error, info, showDetail } = (this as any).state as State;
        if (!error) return ((this as any).props as Props).children;

        // 部署后旧分包失效：不是代码错误，刷新一次拿新版本即可
        const staleChunk = isChunkLoadError(error);

        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
                <div className={`w-full max-w-xl rounded-2xl border bg-white p-6 shadow-xl ${staleChunk ? 'border-amber-200' : 'border-rose-200'}`}>
                    <div className="mb-2 flex items-center gap-2">
                        <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${staleChunk ? 'bg-amber-50 text-amber-600' : 'bg-rose-50 text-rose-600'}`}>!</span>
                        <h1 className="text-base font-semibold text-slate-800">{staleChunk ? '页面需要刷新一下' : '页面渲染出错了'}</h1>
                    </div>
                    <p className="mb-4 text-xs leading-relaxed text-slate-500">
                        {staleChunk
                            ? '检测到系统刚发布了新版本，当前页面还在用旧的分包文件。点「刷新页面」即可，数据不会丢（存在本地 IndexedDB 里）。'
                            : '数据没有丢（存在本地 IndexedDB 里）。可以先点「重试」；如果反复出现，把下面的错误信息截图发出来。'}
                    </p>

                    <pre className="custom-scroll mb-4 max-h-40 overflow-auto rounded-lg bg-slate-50 p-3 text-[11px] leading-relaxed text-rose-700">
                        {error.message}
                    </pre>

                    <div className="flex flex-wrap items-center gap-2">
                        {staleChunk ? (
                            <button
                                type="button"
                                onClick={() => window.location.reload()}
                                className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-700"
                            >
                                刷新页面
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={this.reset}
                                className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-700"
                            >
                                重试
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => window.location.reload()}
                            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                        >
                            刷新页面
                        </button>
                        <button
                            type="button"
                            onClick={this.toggleDetail}
                            className="rounded-lg px-2 py-1.5 text-xs text-slate-500 transition-colors hover:bg-slate-50"
                        >
                            {showDetail ? '隐藏' : '查看'}组件栈
                        </button>
                    </div>

                    {showDetail && (
                        <pre className="custom-scroll mt-3 max-h-56 overflow-auto rounded-lg bg-slate-900 p-3 text-[10px] leading-relaxed text-slate-200">
                            {info || '(无组件栈)'}
                        </pre>
                    )}
                </div>
            </div>
        );
    }
}

import { lazy, type ComponentType } from 'react';

/** 部署后旧分包失效的典型报错（Chrome / Safari / Firefox 文案不同） */
const CHUNK_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk \d+ failed/i;

export const isChunkLoadError = (error: unknown): boolean =>
    CHUNK_ERROR.test(String((error as Error)?.message || error || ''));

const RELOAD_KEY = 'amazon-dashboard-chunk-reload-at';

/**
 * 带自动兜底的 lazy()。
 *
 * 背景：每次部署后 assets 的文件名（hash）都会变，旧分包会被删掉。
 * 如果用户页面还开着（或浏览器缓存了旧 index.html），点开某个按需加载的弹窗就会
 * 「Failed to fetch dynamically imported module」——不是代码坏了，是拿不到旧文件。
 *
 * 这里的做法：识别到这类错误时强制刷新一次页面拿最新 index.html；
 * 10 秒内只允许自动刷新一次，避免死循环，之后仍失败就交给错误边界展示。
 */
export function lazyWithRetry<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
    return lazy(async () => {
        try {
            return await factory();
        } catch (error) {
            if (!isChunkLoadError(error)) throw error;
            try {
                const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
                if (Date.now() - last > 10000) {
                    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
                    window.location.reload();
                    // 页面正在刷新，返回一个永不 resolve 的 promise，避免抛出二次错误
                    return new Promise<{ default: T }>(() => {});
                }
            } catch {
                // sessionStorage 不可用（隐私模式）时退化为直接抛给错误边界
            }
            throw error;
        }
    });
}

import { useEffect, useRef } from 'react';

/**
 * 全局 Esc 关闭：使用栈来管理多层弹窗，按 Esc 只关「最顶层」打开中的弹窗。
 * 例如详情子表里又打开了趋势图，按 Esc 先关趋势图，再按一次才关子表。
 */
const escStack: Array<() => void> = [];
let listenerRegistered = false;

function ensureGlobalListener() {
    if (listenerRegistered) return;
    listenerRegistered = true;
    document.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        if (escStack.length === 0) return;
        const top = escStack[escStack.length - 1];
        if (top) {
            e.preventDefault();
            try {
                top();
            } catch {
                // 静默：避免 onClose 抛错时把后续 listener 弄挂
            }
        }
    });
}

/**
 * 在任意模态组件里调用：当 isOpen 为 true 时，按下 Esc 触发 onClose。
 * 多层弹窗会自动按"栈顺序"逐层退出。
 */
export function useEscClose(isOpen: boolean, onClose: () => void): void {
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        if (!isOpen) return;
        ensureGlobalListener();
        const handler = () => onCloseRef.current();
        escStack.push(handler);
        return () => {
            const idx = escStack.lastIndexOf(handler);
            if (idx >= 0) escStack.splice(idx, 1);
        };
    }, [isOpen]);
}

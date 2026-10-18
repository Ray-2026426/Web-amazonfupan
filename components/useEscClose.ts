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
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        escStack.push(handler);
        const topDialog = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
            .filter(dialog => dialog.getClientRects().length > 0).at(-1);
        const focusTimer = window.setTimeout(() => {
            const dialog = topDialog();
            if (!dialog) return;
            const first = dialog.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]');
            (first || dialog).focus();
        }, 0);
        const trapFocus = (e: KeyboardEvent) => {
            if (e.key !== 'Tab' || escStack.at(-1) !== handler) return;
            const dialog = topDialog();
            if (!dialog) return;
            const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]')).filter(el => el.getClientRects().length > 0);
            if (!focusable.length) { e.preventDefault(); dialog.focus(); return; }
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', trapFocus);
        return () => {
            window.clearTimeout(focusTimer);
            document.removeEventListener('keydown', trapFocus);
            const idx = escStack.lastIndexOf(handler);
            if (idx >= 0) escStack.splice(idx, 1);
            if (!escStack.length) document.body.style.overflow = previousOverflow;
            previousFocus?.focus();
        };
    }, [isOpen]);
}

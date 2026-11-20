import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface RightDrawerProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  widthClass?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/** Apple 风格右侧滑出抽屉（替代全屏弹窗，保留主页面上下文） */
export const RightDrawer: React.FC<RightDrawerProps> = ({
  open,
  onClose,
  title,
  subtitle,
  widthClass = 'w-[560px]',
  children,
  footer,
}) => {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[130] flex justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="关闭抽屉"
        onClick={onClose}
        className="fixed inset-0 bg-slate-950/20 backdrop-blur-[2px] transition-opacity"
      />
      <aside
        className={`relative z-10 flex h-full max-w-[94vw] flex-col border-l border-black/[0.06] bg-white shadow-[-24px_0_60px_-30px_rgba(15,23,42,0.35)] dark:border-white/[0.08] dark:bg-[#191c24] ${widthClass}`}
      >
        {(title || subtitle) && (
          <div className="flex items-start justify-between gap-4 border-b border-black/[0.06] px-6 py-5 dark:border-white/[0.08]">
            <div className="min-w-0">
              {subtitle && <div className="text-xs text-[#86868b] dark:text-[#a7abb8]">{subtitle}</div>}
              {title && (
                <h2 className="mt-1 truncate text-xl font-bold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
                  {title}
                </h2>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-black/[0.06] bg-[#f5f5f7] text-[#424245] transition hover:bg-black/[0.08] dark:border-white/[0.08] dark:bg-white/[0.06] dark:text-[#c7c9d1]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-6 py-5 custom-scroll">{children}</div>
        {footer && (
          <div className="border-t border-black/[0.06] bg-[#f8f9fb] px-6 py-4 dark:border-white/[0.08] dark:bg-[#151821]">
            {footer}
          </div>
        )}
      </aside>
    </div>
  );
};

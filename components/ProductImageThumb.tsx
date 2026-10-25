import React, { memo, useEffect, useRef, useState } from 'react';
import { ImageOff, X } from 'lucide-react';
import { useEscClose } from './useEscClose';

export const ImageLightbox = ({
    url,
    onClose,
}: {
    url: string | null;
    onClose: () => void;
}) => {
    useEscClose(!!url, onClose);
    if (!url) return null;
    return (
        <div
            className="fixed inset-0 z-[300] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
        >
            <button
                type="button"
                className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
                onClick={onClose}
            >
                <X className="h-5 w-5" />
            </button>
            <img
                src={url}
                alt=""
                className="max-h-[85vh] max-w-[min(920px,92vw)] rounded-lg object-contain shadow-2xl"
                onClick={(e) => e.stopPropagation()}
                referrerPolicy="no-referrer"
            />
        </div>
    );
};

/** 懒加载缩略图，点击放大 */
export const ProductImageThumb = memo(function ProductImageThumb({
    url,
    onEnlarge,
}: {
    url: string;
    onEnlarge: (url: string) => void;
}) {
    const hostRef = useRef<HTMLSpanElement>(null);
    const [shouldLoad, setShouldLoad] = useState(false);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        const el = hostRef.current;
        if (!el) return;
        if (typeof IntersectionObserver === 'undefined') {
            setShouldLoad(true);
            return;
        }
        const io = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setShouldLoad(true);
                    io.disconnect();
                }
            },
            { rootMargin: '160px', threshold: 0.01 }
        );
        io.observe(el);
        return () => io.disconnect();
    }, []);

    if (failed) {
        return (
            <span
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-dashed border-slate-200 bg-slate-50 text-slate-300"
                title="图片无法加载"
            >
                <ImageOff className="h-3.5 w-3.5" />
            </span>
        );
    }

    return (
        <span ref={hostRef} className="inline-flex shrink-0">
            {shouldLoad ? (
                <button
                    type="button"
                    className="h-8 w-8 overflow-hidden rounded border border-slate-200 bg-white shadow-sm transition-transform hover:scale-105 hover:ring-2 hover:ring-blue-300"
                    title="点击放大"
                    onClick={(e) => {
                        e.stopPropagation();
                        onEnlarge(url);
                    }}
                >
                    <img
                        src={url}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        onError={() => setFailed(true)}
                        onLoad={(event) => {
                            // 亚马逊对没有主图的 ASIN 会返回 43 字节的 1×1 透明 GIF（HTTP 200、不报错），
                            // 不识别的话就是「一片空白」：当成加载失败处理，显示占位图标。
                            if (event.currentTarget.naturalWidth <= 2 || event.currentTarget.naturalHeight <= 2) {
                                setFailed(true);
                            }
                        }}
                    />
                </button>
            ) : (
                <span className="inline-block h-8 w-8 rounded border border-slate-100 bg-slate-50" />
            )}
        </span>
    );
});

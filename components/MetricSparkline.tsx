/**
 * 迷你走势图（小多图模式里每一格用）
 *
 * 为什么不用 recharts：小多图每格都要「自己缩放 + 共享十字准星」，
 * recharts 的 tooltip / 坐标系在这一档尺寸里全是负担。这里用纯 SVG：
 *   · 宽度用 ResizeObserver 实测后按像素绘制，圆点不会被 non-uniform scale 拉成椭圆
 *   · 描边固定 1.75px，配「末点 + 悬浮点」，一眼能看到最新值落在什么位置
 *   · 父组件只负责 hoverIndex，四格自然对齐到同一个月
 */
import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { ChartTheme } from './chartTheme';

interface MetricSparklineProps {
    values: number[];
    color: string;
    theme: ChartTheme;
    height?: number;
    /** 由父组件控制的共享悬浮下标；null 表示未悬浮 */
    hoverIndex: number | null;
    onHover?: (index: number | null) => void;
    /** 目标序列（缺省或全 0 时不画） */
    target?: (number | undefined)[];
}

const PAD = { l: 5, r: 7, t: 8, b: 6 };

/** 容器宽度（像素），用于按真实尺寸绘制，避免 SVG 缩放导致的像素畸变 */
function useElementWidth<T extends HTMLElement>() {
    const ref = useRef<T | null>(null);
    const [width, setWidth] = useState(0);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const sync = () => setWidth(el.clientWidth);
        sync();
        if (typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(sync);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    return [ref, width] as const;
}

export const MetricSparkline: React.FC<MetricSparklineProps> = ({
    values,
    color,
    theme,
    height = 64,
    hoverIndex,
    onHover,
    target,
}) => {
    const [wrapRef, width] = useElementWidth<HTMLDivElement>();
    const gradientId = `spark-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

    const n = values.length;
    const hasTarget = Array.isArray(target) && target.some(v => typeof v === 'number' && v > 0);

    const all: number[] = [...values];
    if (hasTarget) target!.forEach(v => typeof v === 'number' && all.push(v));

    const finite = all.filter(v => Number.isFinite(v));
    const rawMin = finite.length ? Math.min(...finite) : 0;
    const rawMax = finite.length ? Math.max(...finite) : 1;
    // 留 12% 上下余量；全平序列给一个最小跨度，避免除零
    const span = rawMax - rawMin || Math.abs(rawMax) * 0.2 || 1;
    const min = rawMin - span * 0.12;
    const max = rawMax + span * 0.12;

    const iw = Math.max(width - PAD.l - PAD.r, 1);
    const ih = Math.max(height - PAD.t - PAD.b, 1);
    const xAt = (i: number) => PAD.l + (n <= 1 ? iw / 2 : (iw * i) / (n - 1));
    const yAt = (v: number) => PAD.t + ih - ((v - min) / (max - min)) * ih;

    const path = values
        .map((v, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`)
        .join(' ');
    const area = n > 1 ? `${path} L${xAt(n - 1).toFixed(1)},${height - PAD.b} L${xAt(0).toFixed(1)},${height - PAD.b} Z` : '';
    const targetPath = hasTarget
        ? target!.map((v, i) => (typeof v === 'number' ? `${i ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}` : '')).join(' ')
        : '';

    const lastIndex = n - 1;
    const active = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < n ? hoverIndex : null;

    const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!onHover || n === 0) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const relative = e.clientX - rect.left - PAD.l;
        const step = n > 1 ? iw / (n - 1) : iw;
        const index = Math.max(0, Math.min(n - 1, Math.round(relative / step)));
        onHover(index);
    };

    return (
        <div
            ref={wrapRef}
            className="relative w-full"
            style={{ height }}
            data-sparkline="1"
            onMouseMove={handleMove}
            onMouseLeave={() => onHover?.(null)}
        >
            {width > 0 && n > 0 ? (
                <svg width={width} height={height} role="img" aria-hidden>
                    <defs>
                        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={color} stopOpacity={0.20} />
                            <stop offset="100%" stopColor={color} stopOpacity={0} />
                        </linearGradient>
                    </defs>

                    {hasTarget && targetPath ? (
                        <path
                            d={targetPath}
                            fill="none"
                            stroke={theme.target}
                            strokeWidth={1.25}
                            strokeDasharray="3 3"
                            opacity={0.85}
                        />
                    ) : null}

                    {area ? <path d={area} fill={`url(#${gradientId})`} /> : null}
                    <path d={path} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />

                    {active !== null ? (
                        <>
                            <line
                                x1={xAt(active)}
                                y1={PAD.t - 3}
                                x2={xAt(active)}
                                y2={height - PAD.b}
                                stroke={theme.cursor}
                                strokeWidth={1}
                                strokeDasharray="2 2"
                            />
                            <circle cx={xAt(active)} cy={yAt(values[active])} r={3.4} fill={color} stroke={theme.surface} strokeWidth={2} />
                        </>
                    ) : null}

                    <circle cx={xAt(lastIndex)} cy={yAt(values[lastIndex])} r={2.8} fill={color} stroke={theme.surface} strokeWidth={1.5} />
                </svg>
            ) : null}
        </div>
    );
};

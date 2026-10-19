/**
 * 图表悬浮提示卡片（亮 / 暗统一）
 *
 * recharts 自带的 <Tooltip> 是一个白底小方框 + 默认阴影，在不同卡片背景上很「脏」。
 * 这里统一成：毫秒级玻璃卡片 + 顶部时间 + 「较上期」+ 色点行 + 右对齐等宽数字。
 * 单指标图与多指标图共用同一套，保证系统里所有 tooltip 长得一样。
 */
import React from 'react';
import { ChartTheme } from './chartTheme';

export type TooltipRow = {
    /** 行唯一键 */
    key: string;
    color: string;
    label: string;
    value: string;
    /** 目标 / 预算系列：色点画成空心，呼应虚线 */
    hollow?: boolean;
    /** 次要行（如目标差值）弱化显示 */
    muted?: boolean;
    /** 该行相对上一期的变化（只描述涨跌方向，不暗示好坏） */
    delta?: TooltipDelta;
};

export type TooltipDelta = {
    text: string;
    direction: 'up' | 'down' | 'flat';
};

interface ChartTooltipCardProps {
    theme: ChartTheme;
    title: string;
    /** 标题右侧补充说明，如「月」「W15 周」 */
    subtitle?: string;
    delta?: TooltipDelta | null;
    rows: TooltipRow[];
    /** 底部一行小字，如「达成率 92.4%」 */
    footer?: React.ReactNode;
}

export const ChartTooltipCard: React.FC<ChartTooltipCardProps> = ({
    theme,
    title,
    subtitle,
    delta,
    rows,
    footer,
}) => {
    const deltaColor = !delta
        ? theme.textSubtle
        : delta.direction === 'up'
          ? theme.positive
          : delta.direction === 'down'
            ? theme.negative
            : theme.textSubtle;

    return (
        <div
            className="pointer-events-none min-w-[9.5rem] rounded-xl px-3 py-2.5"
            style={{
                background: theme.tooltipBg,
                border: `1px solid ${theme.tooltipBorder}`,
                boxShadow: theme.tooltipShadow,
                backdropFilter: 'blur(10px)',
            }}
        >
            <div className="mb-1.5 flex items-baseline justify-between gap-4">
                <span className="font-mono text-[11px] font-semibold" style={{ color: theme.textMuted }}>
                    {title}
                    {subtitle ? <span className="ml-1 font-normal opacity-70">{subtitle}</span> : null}
                </span>
                {delta ? (
                    <span className="font-mono text-[10px] font-semibold" style={{ color: deltaColor }}>
                        {delta.text}
                    </span>
                ) : null}
            </div>

            <div className="space-y-1">
                {rows.map(row => (
                    <div key={row.key} className="flex items-center gap-2">
                        <span
                            aria-hidden
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={
                                row.hollow
                                    ? { border: `2px solid ${row.color}`, background: 'transparent' }
                                    : { background: row.color }
                            }
                        />
                        <span
                            className="max-w-[8.5rem] truncate text-[11px]"
                            style={{ color: row.muted ? theme.textSubtle : theme.textMuted }}
                        >
                            {row.label}
                        </span>
                        <span
                            className="ml-auto font-mono text-[11.5px] font-semibold tabular-nums"
                            style={{ color: row.muted ? theme.textMuted : theme.text }}
                        >
                            {row.value}
                        </span>
                        {row.delta ? (
                            <span
                                className="w-[3.4rem] shrink-0 text-right font-mono text-[9.5px] tabular-nums"
                                style={{
                                    color:
                                        row.delta.direction === 'up'
                                            ? theme.positive
                                            : row.delta.direction === 'down'
                                              ? theme.negative
                                              : theme.textSubtle,
                                }}
                            >
                                {row.delta.text}
                            </span>
                        ) : null}
                    </div>
                ))}
            </div>

            {footer ? (
                <div
                    className="mt-1.5 border-t pt-1.5 text-[10px]"
                    style={{ borderColor: theme.tooltipBorder, color: theme.textSubtle }}
                >
                    {footer}
                </div>
            ) : null}
        </div>
    );
};

/** 图例（自定义行，替代 recharts <Legend>：字号、间距、配色都可控） */
export const ChartLegendItem: React.FC<{
    color: string;
    label: string;
    dashed?: boolean;
    value?: string;
    onClick?: () => void;
}> = ({ color, label, dashed, value, onClick }) => {
    const content = (
        <>
            <span
                aria-hidden
                className="shrink-0"
                style={
                    dashed
                        ? { width: 12, height: 0, borderTop: `2px dashed ${color}` }
                        : { width: 12, height: 2.5, borderRadius: 2, background: color }
                }
            />
            <span className="truncate">{label}</span>
            {value ? <span className="font-mono tabular-nums opacity-70">{value}</span> : null}
        </>
    );

    if (onClick) {
        return (
            <button
                type="button"
                onClick={onClick}
                className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[10.5px] transition-colors hover:bg-slate-500/10"
            >
                {content}
            </button>
        );
    }
    return <span className="inline-flex items-center gap-1.5 text-[10.5px]">{content}</span>;
};

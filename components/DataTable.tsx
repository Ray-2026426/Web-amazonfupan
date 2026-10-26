import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { formatNumber } from '../utils';

export type DataTableColumn<T> = {
    key: string;
    title: string;
    align?: 'left' | 'right';
    width?: string;
    /** 单元格内容 */
    render: (row: T, index: number) => React.ReactNode;
    /** 数字列：返回用于画背景迷你条的值，null 表示不画 */
    bar?: (row: T) => number | null;
    /** 迷你条颜色 */
    barClass?: string;
    /** 可排序列：返回排序用的数值/字符串 */
    sortValue?: (row: T) => number | string;
};

interface DataTableProps<T> {
    rows: T[];
    columns: DataTableColumn<T>[];
    rowKey: (row: T, index: number) => string;
    emptyText?: string;
    /** 表头以下最多显示多少行时不做高度限制（默认不限） */
    maxHeight?: string;
}

/**
 * 统一数据表：表头吸顶、首列粘性、数字右对齐等宽、可选迷你条形、点表头排序。
 * 目的：以后加表只写列配置，不再各自复制一套表头/边框/滚动样式。
 */
export function DataTable<T>({ rows, columns, rowKey, emptyText = '暂无数据', maxHeight }: DataTableProps<T>) {
    const [sortKey, setSortKey] = useState<string | null>(null);
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

    const sorted = useMemo(() => {
        const column = columns.find(item => item.key === sortKey);
        if (!column?.sortValue) return rows;
        const copy = [...rows];
        copy.sort((a, b) => {
            const left = column.sortValue!(a);
            const right = column.sortValue!(b);
            if (typeof left === 'number' && typeof right === 'number') {
                return sortDir === 'asc' ? left - right : right - left;
            }
            const text = String(left).localeCompare(String(right));
            return sortDir === 'asc' ? text : -text;
        });
        return copy;
    }, [rows, columns, sortKey, sortDir]);

    if (rows.length === 0) {
        return <p className="px-3 py-6 text-center text-xs text-slate-400">{emptyText}</p>;
    }

    const maxByColumn = new Map<string, number>();
    for (const column of columns) {
        if (!column.bar) continue;
        let max = 0;
        for (const row of rows) {
            const value = column.bar(row);
            if (value !== null && Number.isFinite(value)) max = Math.max(max, Math.abs(value));
        }
        maxByColumn.set(column.key, max);
    }

    return (
        <div className="overflow-x-auto rounded-2xl border border-slate-100" style={maxHeight ? { maxHeight } : undefined}>
            <table className="min-w-full text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500">
                    <tr>
                        {columns.map(column => (
                            <th
                                key={column.key}
                                style={column.width ? { width: column.width } : undefined}
                                className={`whitespace-nowrap px-3 py-2 text-[11px] font-medium ${column.align === 'right' ? 'text-right' : 'text-left'}`}
                            >
                                {column.sortValue ? (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (sortKey === column.key) {
                                                setSortDir(prev => (prev === 'desc' ? 'asc' : 'desc'));
                                            } else {
                                                setSortKey(column.key);
                                                setSortDir('desc');
                                            }
                                        }}
                                        className={`inline-flex items-center gap-0.5 transition hover:text-slate-800 ${sortKey === column.key ? 'text-slate-800' : ''}`}
                                        title="点击排序"
                                    >
                                        {column.title}
                                        {sortKey === column.key
                                            ? (sortDir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)
                                            : <ArrowDown className="h-3 w-3 opacity-20" />}
                                    </button>
                                ) : column.title}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {sorted.map((row, index) => (
                        <tr key={rowKey(row, index)} className="transition-colors hover:bg-sky-50/60">
                            {columns.map(column => {
                                const barValue = column.bar ? column.bar(row) : null;
                                const max = maxByColumn.get(column.key) || 0;
                                const width = barValue !== null && max > 0 ? Math.min(Math.abs(barValue) / max, 1) * 100 : 0;
                                return (
                                    <td
                                        key={column.key}
                                        className={`relative px-3 py-2 ${column.align === 'right' ? 'text-right font-mono tabular-nums' : 'text-left'}`}
                                    >
                                        {barValue !== null && width > 0 && (
                                            <span
                                                aria-hidden="true"
                                                className={`pointer-events-none absolute inset-y-1 right-1 rounded ${column.barClass || 'bg-sky-100/70'}`}
                                                style={{ width: `calc(${width}% - 8px)` }}
                                            />
                                        )}
                                        <span className="relative">{column.render(row, index)}</span>
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/** 常用的数字单元格（带千分位） */
export const numberCell = (value: number) => <span>{formatNumber(value)}</span>;

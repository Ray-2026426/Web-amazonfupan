import React, { useMemo, useState, useEffect, useRef } from 'react';
import { X, TrendingUp } from 'lucide-react';
import { DataRow, TargetRow } from '../types';
import {
    aggregateData,
    formatMoney,
    formatMoneyNoDecimals,
    formatNumber,
    formatPercent,
    formatBusinessWeekFromDateStr,
    allocateWeeklyTargetsLegacy,
} from '../utils';
import { Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart } from 'recharts';
import { useEscClose } from './useEscClose';

export interface TrendColumn {
    title: string;
    shortLabel?: string;
    dataKey?: string;
    key?: string;
    calculator?: (d: any) => number;
    isPercent: boolean;
    isMoney: boolean;
    metricGroup?: 'result' | 'process' | 'target';
}

export type TrendChartScope =
    | { mode: 'dimensions'; dimensions: Record<string, string> }
    | {
          mode: 'total';
          dimFilters: Record<string, string[]>;
          selectedDimensions: string[];
          visibleGroupKeys: string[];
      };

interface TrendChartModalProps {
    isOpen: boolean;
    onClose: () => void;
    rawMonthly: DataRow[];
    rawWeekly: DataRow[];
    scope: TrendChartScope;
    sidebarWeeklyMode: boolean;
    columns: TrendColumn[];
    targetRows?: TargetRow[];
}

const COLORS = [
    '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', 
    '#0ea5e9', '#f43f5e', '#6366f1', '#14b8a6', '#f97316'
];

const DEFAULT_METRIC_TITLES = ['销量', '毛利率', '广告占比', '退款占比', '头程占比'];

/** 跨趋势图共享的指标选择，仅在用户手动切换后写入；更新数据源时重置 */
let persistedTrendMetrics: string[] | null = null;

export function resetTrendChartMetricsSelection() {
    persistedTrendMetrics = null;
}

const getDefaultMetrics = (columns: TrendColumn[]): string[] => {
    const preferred = DEFAULT_METRIC_TITLES.filter(t => columns.some(c => c.title === t));
    return preferred.length > 0 ? preferred : columns.slice(0, Math.min(5, columns.length)).map(c => c.title);
};

const resolveInitialMetrics = (columns: TrendColumn[]): string[] => {
    if (persistedTrendMetrics) {
        const valid = persistedTrendMetrics.filter(t => columns.some(c => c.title === t));
        if (valid.length > 0) return valid;
    }
    return getDefaultMetrics(columns);
};

const weekKeysForMonth = (monthKey: string): string[] => {
    const [y, m] = monthKey.split('-').map(Number);
    if (!y || !m) return [];
    const dim = new Date(y, m, 0).getDate();
    const keys = new Set<string>();
    for (let d = 1; d <= dim; d++) {
        const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        keys.add(formatBusinessWeekFromDateStr(dateStr));
    }
    return Array.from(keys);
};

const rowPassesDimFilters = (row: DataRow, dimFilters: Record<string, string[]>, sidebarWeekly: boolean) => {
    return Object.entries(dimFilters).every(([dimKey, selectedVals]) => {
        const vals = selectedVals as string[];
        if (vals.length === 0) return true;
        let rowVal = '';
        if (dimKey === 'year_month') {
            rowVal = sidebarWeekly ? formatBusinessWeekFromDateStr(row.date) : row.date.substring(0, 7);
        } else {
            rowVal = String((row as any)[dimKey] ?? '');
        }
        return vals.includes(rowVal);
    });
};

const compositeKeyForRow = (row: DataRow, selectedDimensions: string[], sidebarWeekly: boolean) =>
    selectedDimensions
        .map(d => {
            if (d === 'year_month') return sidebarWeekly ? formatBusinessWeekFromDateStr(row.date) : row.date.substring(0, 7);
            return String((row as any)[d] || 'Unknown');
        })
        .join('|||');

const compositeKeyForTargetRow = (t: TargetRow, selectedDimensions: string[], sidebarWeekly: boolean) =>
    selectedDimensions
        .map(d => {
            if (d === 'year_month') return sidebarWeekly ? formatBusinessWeekFromDateStr(`${t.month}-15`) : t.month;
            return String((t as any)[d] || 'Unknown');
        })
        .join('|||');

const targetRowPassesDimFilters = (t: TargetRow, dimFilters: Record<string, string[]>, sidebarWeekly: boolean) =>
    Object.entries(dimFilters).every(([dimKey, selectedVals]) => {
        const vals = selectedVals as string[];
        if (vals.length === 0) return true;
        let rowVal = '';
        if (dimKey === 'year_month') {
            rowVal = sidebarWeekly ? formatBusinessWeekFromDateStr(`${t.month}-15`) : t.month;
        } else {
            rowVal = String((t as any)[dimKey] ?? '');
        }
        return vals.includes(rowVal);
    });

/** 列头筛选里对「年月/年周」的过滤只作用于业绩行；目标行按其它维度筛，避免未来月目标被挡掉 */
const dimFiltersForTargets = (dimFilters: Record<string, string[]>): Record<string, string[]> => {
    const { year_month: _ym, ...rest } = dimFilters;
    return rest;
};

/** 子表按「时间+其它维度」拆行时：业绩仍按可见行；目标则匹配「同一组非时间维度」下所有月份/周的目标 */
const targetMatchesVisibleGroupLoose = (
    t: TargetRow,
    scope: Extract<TrendChartScope, { mode: 'total' }>,
    sidebarWeekly: boolean
): boolean => {
    const dims = scope.selectedDimensions;
    const ymIdx = dims.indexOf('year_month');
    if (ymIdx < 0) {
        const k = compositeKeyForTargetRow(t, dims, sidebarWeekly);
        return scope.visibleGroupKeys.includes(k);
    }
    const tParts = compositeKeyForTargetRow(t, dims, sidebarWeekly).split('|||');
    if (tParts.length !== dims.length) return false;
    return scope.visibleGroupKeys.some(vk => {
        const vParts = vk.split('|||');
        if (vParts.length !== tParts.length) return false;
        for (let i = 0; i < tParts.length; i++) {
            if (i === ymIdx) continue;
            if (vParts[i] !== tParts[i]) return false;
        }
        return true;
    });
};

type TgAcc = { sq: number; sa: number; gp: number; ad: number };

export const TrendChartModal: React.FC<TrendChartModalProps> = ({
    isOpen,
    onClose,
    rawMonthly,
    rawWeekly,
    scope,
    sidebarWeeklyMode,
    columns,
    targetRows = []
}) => {
    const [selectedMetrics, setSelectedMetrics] = useState<string[]>([]);
    const [chartWeekly, setChartWeekly] = useState(false);
    const wasTrendOpenRef = useRef(false);

    /** 仅在趋势弹窗从关→开时同步指标，避免父组件重渲染导致 columns 引用变化而把已选指标冲掉 */
    useEffect(() => {
        if (isOpen && !wasTrendOpenRef.current) {
            setSelectedMetrics(resolveInitialMetrics(columns));
        }
        wasTrendOpenRef.current = isOpen;
    }, [isOpen, columns]);

    /** 弹窗打开期间跟随侧栏月/周切换 */
    useEffect(() => {
        if (isOpen) setChartWeekly(sidebarWeeklyMode);
    }, [isOpen, sidebarWeeklyMode]);

    const toggleMetric = (title: string) => {
        setSelectedMetrics(prev => {
            let next: string[];
            if (prev.includes(title)) {
                if (prev.length === 1) return prev;
                next = prev.filter(m => m !== title);
            } else if (prev.length >= 7) {
                return prev;
            } else {
                next = [...prev, title];
            }
            persistedTrendMetrics = next;
            return next;
        });
    };

    const baseRaw = chartWeekly ? rawWeekly : rawMonthly;

    const chartData = useMemo(() => {
        if (!isOpen || !baseRaw || baseRaw.length === 0) return [];

        let filteredData: DataRow[];
        if (scope.mode === 'dimensions') {
            const { dimensions } = scope;
            filteredData = baseRaw.filter(row => {
                return Object.entries(dimensions).every(([dimKey, dimVal]) => {
                    if (dimKey === 'year_month') return true;
                    return String((row as any)[dimKey]) === String(dimVal);
                });
            });
        } else {
            const keySet = new Set(scope.visibleGroupKeys);
            filteredData = baseRaw.filter(row => {
                if (!rowPassesDimFilters(row, scope.dimFilters, sidebarWeeklyMode)) return false;
                const k = compositeKeyForRow(row, scope.selectedDimensions, sidebarWeeklyMode);
                return keySet.has(k);
            });
        }

        const timeGroups: Record<string, DataRow[]> = {};
        filteredData.forEach(row => {
            const timeKey = chartWeekly ? formatBusinessWeekFromDateStr(row.date) : row.date.substring(0, 7);
            if (!timeGroups[timeKey]) timeGroups[timeKey] = [];
            timeGroups[timeKey].push(row);
        });

        let filteredTargets: TargetRow[] = targetRows;
        if (scope.mode === 'dimensions') {
            const { dimensions } = scope;
            filteredTargets = targetRows.filter(t =>
                Object.entries(dimensions).every(([dimKey, dimVal]) => {
                    if (dimKey === 'year_month') return true;
                    return String((t as any)[dimKey]) === String(dimVal);
                })
            );
        } else {
            const keySet = new Set(scope.visibleGroupKeys);
            const tgtDimFilters = dimFiltersForTargets(scope.dimFilters);
            filteredTargets = targetRows.filter(t => {
                if (!targetRowPassesDimFilters(t, tgtDimFilters, sidebarWeeklyMode)) return false;
                if (scope.selectedDimensions.includes('year_month')) {
                    return targetMatchesVisibleGroupLoose(t, scope, sidebarWeeklyMode);
                }
                const k = compositeKeyForTargetRow(t, scope.selectedDimensions, sidebarWeeklyMode);
                return keySet.has(k);
            });
        }

        const targetByMonth: Record<string, TgAcc> = {};
        filteredTargets.forEach(t => {
            const cur = targetByMonth[t.month] || { sq: 0, sa: 0, gp: 0, ad: 0 };
            cur.sq += t.sales_quantity_target;
            cur.sa += t.sales_amount_target;
            cur.gp += t.gross_profit_target;
            cur.ad += t.ad_spend_target;
            targetByMonth[t.month] = cur;
        });

        /** 仅当勾选了「目标」类指标时，才把有目标但尚无业绩的月份/周补进横轴 */
        const extendAxisForTargets = selectedMetrics.some(title =>
            columns.some(c => c.title === title && c.metricGroup === 'target')
        );

        const allTimeKeys = new Set(Object.keys(timeGroups));
        if (extendAxisForTargets) {
            Object.keys(targetByMonth).forEach(monthKey => {
                if (chartWeekly) {
                    weekKeysForMonth(monthKey).forEach(wk => allTimeKeys.add(wk));
                } else {
                    allTimeKeys.add(monthKey);
                }
            });
        }

        const aggregated = Array.from(allTimeKeys).sort().map(timeKey => {
            const agg = aggregateData(timeGroups[timeKey] || []);
            const rowData: any = { time: timeKey };

            columns.forEach(col => {
                if (col.metricGroup === 'target') return;
                if (col.calculator) {
                    rowData[col.title] = col.calculator(agg);
                } else if (col.key) {
                    rowData[col.title] = (agg as any)[col.key] || 0;
                }
            });

            return rowData;
        });

        return aggregated.map(row => {
            const tg = chartWeekly
                ? allocateWeeklyTargetsLegacy(row.time, targetByMonth)
                : targetByMonth[row.time] || { sq: 0, sa: 0, gp: 0, ad: 0 };
            const gm = tg.sa > 0 ? tg.gp / tg.sa : 0;
            const ar = tg.sa > 0 ? tg.ad / tg.sa : 0;
            return {
                ...row,
                tg_sales_quantity: tg.sq,
                tg_sales_amount: tg.sa,
                tg_gross_profit: tg.gp,
                tg_gross_margin: gm,
                tg_ad_spend: tg.ad,
                tg_ad_ratio: ar
            };
        });
    }, [isOpen, baseRaw, scope, chartWeekly, sidebarWeeklyMode, columns, targetRows, selectedMetrics]);

    useEscClose(isOpen, onClose);

    if (!isOpen) return null;

    const title =
        scope.mode === 'dimensions'
            ? Object.entries(scope.dimensions)
                  .filter(([k]) => k !== 'year_month')
                  .map(([_, v]) => v)
                  .join(' > ') || '全局'
            : '子表总计（当前筛选与可见分组）';

    const canWeekly = rawWeekly.length > 0;
    const canMonthly = rawMonthly.length > 0;

    const formatTooltipValue = (value: number, name: string) => {
        const col = columns.find(c => c.title === name);
        if (!col) return formatNumber(value);
        if (col.isPercent) return formatPercent(value);
        if (col.isMoney) {
            if (
                name === '销售额' ||
                name === '毛利额' ||
                name === '销售额（目标）' ||
                name === '毛利额（目标）'
            )
                return formatMoneyNoDecimals(value);
            return formatMoney(value);
        }
        if (name === 'CPC') return `$${value.toFixed(2)}`;
        if (name === '评分') return value.toFixed(1);
        return formatNumber(value);
    };

    const hasAbsolute = selectedMetrics.some(m => !columns.find(c => c.title === m)?.isPercent);
    const hasPercent = selectedMetrics.some(m => columns.find(c => c.title === m)?.isPercent);

    return (
        <div className="fixed inset-0 z-[110] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="flex h-[88vh] w-full max-w-[min(96vw,86.4rem)] flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
                <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-700/50 bg-slate-800 px-4 py-2.5 text-white">
                    <div className="flex min-w-0 items-center gap-2.5">
                        <div className="flex-shrink-0 rounded-md bg-blue-500/90 p-1.5">
                            <TrendingUp className="h-4 w-4 text-white" />
                        </div>
                        <div className="min-w-0">
                            <h2 className="truncate text-base font-semibold tracking-tight">趋势 · {title}</h2>
                            <p className="truncate text-[10px] text-slate-400">最多 7 项 · 结果 / 过程 / 目标</p>
                        </div>
                    </div>
                    <button type="button" onClick={onClose} className="flex-shrink-0 rounded-full p-1.5 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50">
                    <div className="flex-shrink-0 border-b border-slate-200/90 bg-white px-3 py-2">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                            <div className="flex items-center gap-1.5">
                                <span className="text-[10px] font-medium text-slate-400">粒度</span>
                                <div className="inline-flex rounded-md bg-slate-100 p-0.5">
                                    <button
                                        type="button"
                                        disabled={!canMonthly}
                                        onClick={() => canMonthly && setChartWeekly(false)}
                                        className={`rounded px-2.5 py-1 text-[11px] font-medium transition-all ${
                                            !chartWeekly ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                                        } disabled:cursor-not-allowed disabled:opacity-40`}
                                    >
                                        月
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!canWeekly}
                                        onClick={() => canWeekly && setChartWeekly(true)}
                                        className={`rounded px-2.5 py-1 text-[11px] font-medium transition-all ${
                                            chartWeekly ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                                        } disabled:cursor-not-allowed disabled:opacity-40`}
                                    >
                                        周
                                    </button>
                                </div>
                                {!canWeekly && <span className="text-[10px] text-amber-600/90">无周表</span>}
                            </div>
                            <div className="h-4 w-px bg-slate-200 max-sm:hidden" aria-hidden />
                            <div className="min-w-0 flex-1 space-y-1.5 sm:min-w-[200px]">
                                <div className="flex items-center gap-1.5">
                                    <span className="w-7 flex-shrink-0 text-center text-[9px] font-semibold leading-none text-emerald-700/85">结果</span>
                                    <div className="custom-scroll flex min-w-0 gap-1 overflow-x-auto pb-0.5">
                                        {columns
                                            .filter(c => c.metricGroup === 'result')
                                            .map(col => {
                                                const isSelected = selectedMetrics.includes(col.title);
                                                return (
                                                    <button
                                                        key={col.title}
                                                        type="button"
                                                        onClick={() => toggleMetric(col.title)}
                                                        title={col.title}
                                                        className={`flex-shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
                                                            isSelected
                                                                ? 'bg-emerald-600/12 text-emerald-900 ring-1 ring-emerald-500/35'
                                                                : 'bg-slate-50 text-slate-600 ring-1 ring-slate-200/80 hover:bg-slate-100'
                                                        }`}
                                                    >
                                                        {col.title}
                                                    </button>
                                                );
                                            })}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <span className="w-7 flex-shrink-0 text-center text-[9px] font-semibold leading-none text-violet-700/85">过程</span>
                                    <div className="custom-scroll flex min-w-0 gap-1 overflow-x-auto pb-0.5">
                                        {columns
                                            .filter(c => c.metricGroup === 'process')
                                            .map(col => {
                                                const isSelected = selectedMetrics.includes(col.title);
                                                return (
                                                    <button
                                                        key={col.title}
                                                        type="button"
                                                        onClick={() => toggleMetric(col.title)}
                                                        title={col.title}
                                                        className={`flex-shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
                                                            isSelected
                                                                ? 'bg-violet-600/12 text-violet-900 ring-1 ring-violet-500/35'
                                                                : 'bg-slate-50 text-slate-600 ring-1 ring-slate-200/80 hover:bg-slate-100'
                                                        }`}
                                                    >
                                                        {col.title}
                                                    </button>
                                                );
                                            })}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <span className="w-7 flex-shrink-0 text-center text-[9px] font-semibold leading-none text-amber-800/90">目标</span>
                                    <div className="custom-scroll flex min-w-0 gap-1 overflow-x-auto pb-0.5">
                                        {columns
                                            .filter(c => c.metricGroup === 'target')
                                            .map(col => {
                                                const isSelected = selectedMetrics.includes(col.title);
                                                return (
                                                    <button
                                                        key={col.title}
                                                        type="button"
                                                        onClick={() => toggleMetric(col.title)}
                                                        title={col.title}
                                                        className={`flex-shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
                                                            isSelected
                                                                ? 'bg-amber-500/15 text-amber-950 ring-1 ring-amber-500/40'
                                                                : 'bg-slate-50 text-slate-600 ring-1 ring-slate-200/80 hover:bg-slate-100'
                                                        }`}
                                                    >
                                                        {col.shortLabel || col.title}
                                                    </button>
                                                );
                                            })}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="min-h-0 flex-1 overflow-hidden p-3">
                        {chartData.length === 0 ? (
                            <div className="flex h-full items-center justify-center text-sm text-slate-400">暂无历史趋势数据</div>
                        ) : (
                            <div className="flex h-full flex-col rounded-lg border border-slate-200/90 bg-white p-2 shadow-sm">
                                <div className="min-h-0 flex-1">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ComposedChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                            <XAxis dataKey="time" tick={{fontSize: 12, fill: '#64748b'}} tickMargin={10} />
                                            
                                            {hasAbsolute && (
                                                <YAxis 
                                                    yAxisId="left" 
                                                    tickFormatter={(v) => Math.abs(v) >= 1000 ? `${(v/1000).toFixed(1)}k` : v} 
                                                    tick={{fontSize: 12, fill: '#64748b'}} 
                                                />
                                            )}
                                            
                                            {hasPercent && (
                                                <YAxis 
                                                    yAxisId="right" 
                                                    orientation="right" 
                                                    tickFormatter={(v) => `${(v*100).toFixed(0)}%`} 
                                                    tick={{fontSize: 12, fill: '#64748b'}} 
                                                />
                                            )}
                                            
                                            <Tooltip
                                                formatter={formatTooltipValue}
                                                labelStyle={{ color: '#1e293b', fontWeight: 'bold', marginBottom: '8px' }}
                                                contentStyle={{
                                                    borderRadius: '8px',
                                                    border: '1px solid rgba(148, 163, 184, 0.4)',
                                                    backgroundColor: 'rgba(255, 255, 255, 0.82)',
                                                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.06)',
                                                }}
                                                wrapperStyle={{ outline: 'none' }}
                                            />
                                            <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                                            
                                            {selectedMetrics.map((metricTitle, idx) => {
                                                const col = columns.find(c => c.title === metricTitle);
                                                if (!col) return null;
                                                const color = COLORS[idx % COLORS.length];
                                                const seriesKey = col.dataKey || col.title;
                                                return (
                                                    <Line
                                                        key={metricTitle}
                                                        yAxisId={col.isPercent ? "right" : "left"}
                                                        type="monotone"
                                                        dataKey={seriesKey}
                                                        name={col.title}
                                                        stroke={color}
                                                        strokeWidth={3}
                                                        dot={{ r: 4, strokeWidth: 2, fill: '#fff' }}
                                                        activeDot={{ r: 6, strokeWidth: 0 }}
                                                    />
                                                );
                                            })}
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

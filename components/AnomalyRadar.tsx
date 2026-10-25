import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Target } from 'lucide-react';
import type { RadarReport, Finding, Dimension } from '../utils/diagnosticRadar';

const DIMENSION_LABEL: Record<Dimension, { label: string; hint: string }> = {
    volume: { label: '销量', hint: '曝光 × 点击率 × 转化率' },
    asp: { label: '客单价', hint: '折扣 / 销售结构 / 价格战' },
    margin: { label: '毛利率', hint: '成本占比 / 广告 TACOS' },
};

const SEVERITY_STYLE: Record<Finding['severity'], { dot: string; chip: string; text: string }> = {
    critical: { dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700 ring-rose-100', text: '严重' },
    warning: { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 ring-amber-100', text: '预警' },
    info: { dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700 ring-sky-100', text: '提示' },
};

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const signed = (value: number | null) => (value === null ? '—' : `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`);

/** 经营异常雷达：默认只看结论，点开才看证据与动作 */
export const AnomalyRadar: React.FC<{ report: RadarReport }> = ({ report }) => {
    const [openId, setOpenId] = useState<string | null>(null);
    const [showAll, setShowAll] = useState(false);
    const { core, findings } = report;

    const visible = showAll ? findings : findings.slice(0, 3);
    const grouped = (['volume', 'asp', 'margin'] as Dimension[])
        .map(dimension => ({ dimension, items: visible.filter(item => item.dimension === dimension) }))
        .filter(group => group.items.length > 0);

    return (
        <section
            id="radar"
            className={`rounded-2xl border p-5 ${core.anomalous ? 'border-rose-200 bg-gradient-to-br from-rose-50/70 to-white' : 'border-emerald-200 bg-gradient-to-br from-emerald-50/60 to-white'}`}
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                    <span className={`mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-xl ${core.anomalous ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600'}`}>
                        {core.anomalous ? <AlertTriangle className="h-4.5 w-4.5" /> : <CheckCircle2 className="h-4.5 w-4.5" />}
                    </span>
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-base font-bold text-slate-900">经营异常雷达</h2>
                            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-slate-200">核心指标：毛利额</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-600">{core.verdict}</p>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px]">
                    <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-slate-200">
                        <Target className="mr-1 inline h-3 w-3 text-slate-400" />
                        达成 <b className={core.attainment !== null && core.attainment >= 0.9 ? 'text-emerald-600' : 'text-rose-600'}>{core.attainment === null ? '—' : pct(core.attainment)}</b>
                    </span>
                    <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-slate-200">同比 <b className={core.yoy !== null && core.yoy < 0 ? 'text-rose-600' : 'text-slate-700'}>{signed(core.yoy)}</b></span>
                    <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-slate-200">环比 <b className={core.mom !== null && core.mom < 0 ? 'text-rose-600' : 'text-slate-700'}>{signed(core.mom)}</b></span>
                </div>
            </div>

            {!core.anomalous && (
                <div className="mt-3 space-y-1 border-t border-emerald-100 pt-3 text-[11px] text-slate-600">
                    {report.normalNotes.map(note => <p key={note}>· {note}</p>)}
                </div>
            )}

            {core.anomalous && (
                <div className="mt-4 space-y-3">
                    {grouped.length === 0 && <p className="text-xs text-slate-500">已触发诊断，但当前数据不足以定位到具体维度，建议先补全库存与广告数据。</p>}
                    {grouped.map(group => (
                        <div key={group.dimension}>
                            <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold text-slate-500">
                                <span>{DIMENSION_LABEL[group.dimension].label}诊断</span>
                                <span className="font-normal text-slate-400">{DIMENSION_LABEL[group.dimension].hint}</span>
                            </div>
                            <div className="space-y-1.5">
                                {group.items.map(item => {
                                    const open = openId === item.id;
                                    const style = SEVERITY_STYLE[item.severity];
                                    return (
                                        <div key={item.id} className={`rounded-xl border bg-white transition ${open ? 'border-slate-300 shadow-sm' : 'border-slate-200 hover:border-slate-300'}`}>
                                            <button
                                                type="button"
                                                onClick={() => setOpenId(open ? null : item.id)}
                                                className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left"
                                            >
                                                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
                                                <span className="min-w-0 flex-1">
                                                    <span className="flex flex-wrap items-center gap-1.5">
                                                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ${style.chip}`}>{style.text}</span>
                                                        <span className="text-[13px] font-semibold text-slate-800">{item.title}</span>
                                                    </span>
                                                    <span className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-slate-400">
                                                        {item.path.map((node, index) => (
                                                            <React.Fragment key={node}>
                                                                {index > 0 && <span className="text-slate-300">›</span>}
                                                                <span className={index === item.path.length - 1 ? 'text-slate-600' : ''}>{node}</span>
                                                            </React.Fragment>
                                                        ))}
                                                    </span>
                                                </span>
                                                <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                                            </button>

                                            {open && (
                                                <div className="border-t border-slate-100 px-3 py-3">
                                                    <div className="grid gap-1.5 sm:grid-cols-2">
                                                        {item.evidence.map(row => (
                                                            <div key={row.label} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px]">
                                                                <span className="text-slate-500">{row.label}</span>
                                                                <span className="font-mono font-medium text-slate-800">{row.value}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                    <div className="mt-2 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-[11px] leading-relaxed text-sky-900">
                                                        <b>动作：</b>{item.action}
                                                    </div>
                                                    {item.checks && item.checks.length > 0 && (
                                                        <div className="mt-1.5 text-[10px] text-slate-500">
                                                            需核查：{item.checks.join(' · ')}
                                                            {item.confidence !== 'high' && <span className="ml-1 text-amber-600">（数据不足以完全证实）</span>}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                    {findings.length > 3 && (
                        <button type="button" onClick={() => setShowAll(value => !value)} className="text-[11px] font-medium text-slate-500 hover:text-slate-800">
                            {showAll ? '只看前 3 条' : `展开全部 ${findings.length} 条`}
                        </button>
                    )}
                </div>
            )}
        </section>
    );
};

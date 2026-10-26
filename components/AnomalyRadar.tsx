import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Printer, Target } from 'lucide-react';
import type { RadarReport, Finding, Dimension } from '../utils/diagnosticRadar';

const DIMENSION_LABEL: Record<Dimension, { label: string; hint: string }> = {
    volume: { label: '销量', hint: '曝光 × 点击率 × 转化率' },
    asp: { label: '客单价', hint: '折扣 / 销售结构 / 价格战' },
    margin: { label: '毛利率', hint: '成本占比 / 广告 TACOS' },
};

const SEVERITY: Record<Finding['severity'], { text: string; dot: string; chip: string; rail: string }> = {
    critical: { text: '严重', dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700 ring-rose-200', rail: 'before:bg-rose-500' },
    warning: { text: '预警', dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 ring-amber-200', rail: 'before:bg-amber-500' },
    info: { text: '提示', dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700 ring-sky-200', rail: 'before:bg-sky-400' },
};

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const signed = (value: number | null) => (value === null ? '—' : `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`);
const money = (value: number) => (Math.abs(value) >= 10000 ? `${(value / 10000).toFixed(2)} 万` : value.toFixed(0));

/** 结论格：一个指标 + 判定色 */
const MetricCell: React.FC<{ label: string; value: string; tone?: 'good' | 'bad' | 'neutral'; note?: string }> = ({ label, value, tone = 'neutral', note }) => (
    <div className="flex flex-col gap-1 border-l border-slate-200 pl-4 first:border-l-0 first:pl-0">
        <span className="text-[10px] uppercase tracking-[0.14em] text-slate-400">{label}</span>
        <span className={`font-mono text-[22px] leading-none font-semibold tabular-nums ${
            tone === 'bad' ? 'text-rose-600' : tone === 'good' ? 'text-emerald-600' : 'text-slate-900'
        }`}>{value}</span>
        {note && <span className="text-[10px] text-slate-400">{note}</span>}
    </div>
);

/**
 * 业绩诊断书。
 *
 * 排版按「报告」而不是「卡片堆」来做：
 *   抬头（诊断对象/区间/状态）→ 结论 → 诊断路径 → 编号问题清单 → 复核栏 → 口径说明
 * 每条问题都带：证据（可核对）、动作（可执行）、嫌疑 ASIN（可下钻）。
 */
export const AnomalyRadar: React.FC<{
    report: RadarReport;
    onDrillAsin?: (asin: string) => void;
    /** 诊断区间，如 2026-10-01 ~ 2026-10-31 */
    periodLabel?: string;
    /** 生成时间，不传则用当前时间 */
    generatedAt?: string;
}> = ({ report, onDrillAsin, periodLabel, generatedAt }) => {
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const { core, findings, normalNotes } = report;

    const status = core.anomalous ? (findings.some(item => item.severity === 'critical') ? 'critical' : 'warning') : 'healthy';
    const statusMeta = status === 'critical'
        ? { label: '需立即处理', tone: 'bg-rose-600', text: 'text-rose-700', ring: 'ring-rose-200', bg: 'bg-rose-50' }
        : status === 'warning'
            ? { label: '需关注', tone: 'bg-amber-500', text: 'text-amber-700', ring: 'ring-amber-200', bg: 'bg-amber-50' }
            : { label: '表现正常', tone: 'bg-emerald-600', text: 'text-emerald-700', ring: 'ring-emerald-200', bg: 'bg-emerald-50' };

    const stamp = generatedAt || new Date().toLocaleString('zh-CN', { hour12: false });
    const serial = useMemo(() => {
        const seed = `${periodLabel || ''}${findings.length}${core.value.toFixed(0)}`;
        let hash = 0;
        for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) % 100000;
        return `DX-${String(hash).padStart(5, '0')}`;
    }, [periodLabel, findings.length, core.value]);

    const reviewItems = findings.flatMap(item => (item.checks || []).map(check => ({ check, finding: item })));

    return (
        <section id="radar" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_50px_-40px_rgba(15,23,42,0.5)] print:border-0 print:shadow-none">
            {/* 抬头 */}
            <header className="relative border-b border-slate-200 px-6 pb-5 pt-6">
                <span className={`absolute left-0 top-0 h-full w-1 ${statusMeta.tone}`} aria-hidden="true" />
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.22em] text-slate-400">
                            业绩诊断书
                            <span className="h-px w-10 bg-slate-200" />
                            {serial}
                        </div>
                        <h2 className="mt-2 text-[19px] font-bold tracking-tight text-slate-900">
                            毛利额诊断 · {periodLabel || '当前区间'}
                        </h2>
                        <p className="mt-1 text-[11px] text-slate-400">生成时间 {stamp} · 口径：领星同步数据（已与订单利润对账）</p>
                    </div>
                    <div className="flex items-start gap-2">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold ring-1 ${statusMeta.bg} ${statusMeta.text} ${statusMeta.ring}`}>
                            {core.anomalous ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                            {statusMeta.label}
                        </span>
                        <button
                            type="button"
                            onClick={() => window.print()}
                            className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-[11px] text-slate-500 transition hover:border-slate-300 hover:text-slate-700 print:hidden"
                        >
                            <Printer className="h-3.5 w-3.5" /> 打印
                        </button>
                    </div>
                </div>

                {/* 结论数字 */}
                <div className="mt-5 grid grid-cols-2 gap-y-4 sm:grid-cols-4">
                    <MetricCell
                        label="毛利额"
                        value={money(core.value)}
                        tone={core.value < 0 ? 'bad' : 'neutral'}
                        note={core.value < 0 ? '本期为负' : '核心指标'}
                    />
                    <MetricCell
                        label="目标达成"
                        value={core.attainment === null ? '—' : pct(core.attainment)}
                        tone={core.attainment === null ? 'neutral' : core.attainment >= 0.9 ? 'good' : 'bad'}
                        note={core.attainment === null ? '未设目标' : '目标 100%'}
                    />
                    <MetricCell
                        label="同比"
                        value={signed(core.yoy)}
                        tone={core.yoy === null ? 'neutral' : core.yoy >= 0 ? 'good' : 'bad'}
                        note="较去年同期"
                    />
                    <MetricCell
                        label="环比"
                        value={signed(core.mom)}
                        tone={core.mom === null ? 'neutral' : core.mom >= 0 ? 'good' : 'bad'}
                        note="较上一周期"
                    />
                </div>

                <p className="mt-5 border-l-2 border-slate-300 pl-3 text-[12.5px] leading-relaxed text-slate-700">
                    <b className="font-semibold text-slate-900">诊断结论　</b>{core.verdict}
                </p>
            </header>

            {/* 正常：给出正向结论 */}
            {!core.anomalous && (
                <div className="px-6 py-5">
                    <SectionTitle index="01" title="检查结果" />
                    <ul className="mt-2 space-y-1.5">
                        {normalNotes.map(note => (
                            <li key={note} className="flex items-start gap-2 text-[12px] text-slate-600">
                                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                                {note}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* 异常：诊断路径 + 编号问题 */}
            {core.anomalous && (
                <div className="px-6 py-5">
                    <SectionTitle index="01" title="诊断路径" hint="毛利额 → 达成/同比/环比 → 量 · 价 · 率 → 根因 → 动作" />
                    <DiagnosisPath findings={findings} />

                    <div className="mt-6">
                        <SectionTitle index="02" title={`问题清单（${findings.length} 项）`} hint="按严重程度排序，展开可看证据与动作" />
                        <ol className="mt-3 space-y-3">
                            {findings.map((item, index) => {
                                const open = expanded[item.id] ?? index < 2;
                                const meta = SEVERITY[item.severity];
                                const dimension = DIMENSION_LABEL[item.dimension];
                                return (
                                    <li
                                        key={item.id}
                                        className={`relative rounded-xl border border-slate-200 bg-white pl-5 transition ${open ? 'shadow-[0_10px_30px_-26px_rgba(15,23,42,0.6)]' : ''} before:absolute before:left-0 before:top-0 before:h-full before:w-[3px] before:rounded-l-xl ${meta.rail}`}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => setExpanded(prev => ({ ...prev, [item.id]: !open }))}
                                            className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left"
                                        >
                                            <div className="min-w-0">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="font-mono text-[11px] text-slate-300">{String(index + 1).padStart(2, '0')}</span>
                                                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${meta.chip}`}>{meta.text}</span>
                                                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{dimension.label}</span>
                                                    <span className="text-[10px] text-slate-400">{dimension.hint}</span>
                                                </div>
                                                <p className="mt-1.5 truncate text-[13px] font-medium text-slate-900">{item.title}</p>
                                            </div>
                                            <ChevronRight className={`mt-1 h-4 w-4 shrink-0 text-slate-300 transition-transform ${open ? 'rotate-90' : ''} print:hidden`} />
                                        </button>

                                        {open && (
                                            <div className="space-y-3 border-t border-dashed border-slate-200 px-4 py-3">
                                                {item.path.length > 0 && (
                                                    <div className="flex flex-wrap items-center gap-1 text-[10px] text-slate-400">
                                                        {item.path.map((step, stepIndex) => (
                                                            <React.Fragment key={`${item.id}-${step}`}>
                                                                {stepIndex > 0 && <ChevronRight className="h-2.5 w-2.5" />}
                                                                <span className="rounded bg-slate-50 px-1.5 py-0.5 text-slate-600">{step}</span>
                                                            </React.Fragment>
                                                        ))}
                                                    </div>
                                                )}
                                                <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                                                    {item.evidence.map(evidence => (
                                                        <div key={evidence.label} className="flex items-baseline justify-between gap-2 border-b border-dotted border-slate-100 pb-1">
                                                            <dt className="text-[11px] text-slate-500">{evidence.label}</dt>
                                                            <dd className="font-mono text-[11.5px] font-medium tabular-nums text-slate-800">{evidence.value}</dd>
                                                        </div>
                                                    ))}
                                                </dl>
                                                <div className="rounded-lg bg-slate-900 px-3 py-2 text-[11.5px] leading-relaxed text-slate-100">
                                                    <span className="mr-1.5 rounded bg-white/15 px-1 py-0.5 text-[10px] font-semibold">动作</span>
                                                    {item.action}
                                                </div>
                                                {onDrillAsin && item.drillAsins && item.drillAsins.length > 0 && (
                                                    <div className="flex flex-wrap items-center gap-1.5">
                                                        <span className="text-[10px] text-slate-400">嫌疑父体</span>
                                                        {item.drillAsins.map(asin => (
                                                            <button
                                                                key={asin.asin}
                                                                type="button"
                                                                onClick={() => onDrillAsin(asin.asin)}
                                                                title={asin.name}
                                                                className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
                                                            >
                                                                <span className="font-mono">{asin.asin}</span>
                                                                <span className={asin.delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                                                                    {asin.delta >= 0 ? '+' : ''}{Math.abs(asin.delta) >= 10000 ? `${(asin.delta / 10000).toFixed(1)}万` : asin.delta.toFixed(0)}
                                                                </span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                                {item.confidence !== 'high' && (
                                                    <p className="text-[10px] text-amber-600">数据不足以完全证实，需人工核对下方复核项</p>
                                                )}
                                            </div>
                                        )}
                                    </li>
                                );
                            })}
                        </ol>
                    </div>

                    {reviewItems.length > 0 && (
                        <div className="mt-6">
                            <SectionTitle index="03" title="复核清单" hint="以下项目数据无法自动判定，需人工确认" />
                            <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                                {reviewItems.map(item => (
                                    <li key={`${item.finding.id}-${item.check}`} className="flex items-start gap-2 text-[11.5px] text-slate-600">
                                        <Target className="mt-0.5 h-3 w-3 shrink-0 text-slate-300" />
                                        {item.check}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}

            {/* 页脚 */}
            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50/70 px-6 py-3 text-[10px] text-slate-400">
                <span>判定阈值：达成率 &lt; 90% · 同比 &lt; −10% · 环比 &lt; −10%</span>
                <span>数据来源：领星 · 每日对账差异 &lt; 2% 视为可信</span>
            </footer>
        </section>
    );
};

const SectionTitle: React.FC<{ index: string; title: string; hint?: string }> = ({ index, title, hint }) => (
    <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-[10px] text-slate-300">{index}</span>
        <h3 className="text-[12px] font-semibold tracking-wide text-slate-800">{title}</h3>
        {hint && <span className="text-[10px] text-slate-400">{hint}</span>}
    </div>
);

/** 诊断路径：把判断树画成一条链，一眼看出结论是怎么来的 */
const DiagnosisPath: React.FC<{ findings: Finding[] }> = ({ findings }) => {
    const chains = useMemo(() => {
        const seen = new Set<string>();
        const list: { dimension: Dimension; steps: string[] }[] = [];
        for (const finding of findings) {
            const key = finding.path.join('>');
            if (seen.has(key) || finding.path.length === 0) continue;
            seen.add(key);
            list.push({ dimension: finding.dimension, steps: finding.path });
        }
        return list.slice(0, 3);
    }, [findings]);

    if (chains.length === 0) return null;

    return (
        <div className="mt-3 space-y-2">
            {chains.map(chain => (
                <div key={chain.dimension + chain.steps.join('')} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
                    <span className="mr-1 rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-slate-200">
                        {DIMENSION_LABEL[chain.dimension].label}
                    </span>
                    {chain.steps.map((step, index) => (
                        <React.Fragment key={`${chain.dimension}-${step}-${index}`}>
                            {index > 0 && <ChevronRight className="h-3 w-3 text-slate-300" />}
                            <span className="text-[11px] text-slate-600">{step}</span>
                        </React.Fragment>
                    ))}
                </div>
            ))}
        </div>
    );
};

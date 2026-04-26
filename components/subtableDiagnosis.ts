import type { AggregatedData } from '../types';

export const SUBTABLE_DIAGNOSIS_STORAGE_KEY = 'subtable_diagnosis_settings_v2';

/** v1 仅含阈值与 enabled，迁移时补全默认短语与名称 */
const LEGACY_STORAGE_KEY = 'subtable_diagnosis_settings_v1';

export type SubtableDiagnosisType = 'PL' | 'Traffic';

export type DiagnosisTone = 'red' | 'green';

export type DiagnosisTag = {
    text: string;
    tone: DiagnosisTone;
};

/** 模板可用占位：{metric}、{双期}、{环比}、{同比}（周度下自动替换为周同环比、周环比、周同比） */
export type DiagnosisPhrases = {
    /** 越高越好：环+同 均异常走低 */
    badBothDownHi: string;
    badMomDownHi: string;
    badYoyDownHi: string;
    /** 越低越好：环+同 均异常走高 */
    badBothUpLo: string;
    badMomUpLo: string;
    badYoyUpLo: string;
    /** 越高越好：环+同 均显著走高 */
    goodBothUpHi: string;
    goodMomUpHi: string;
    goodYoyUpHi: string;
    /** 越低越好：环+同 均显著走低 */
    goodBothDownLo: string;
    goodMomDownLo: string;
    goodYoyDownLo: string;
    /** 未达/超目标（含反色预算类） */
    targetMiss: string;
};

export const DEFAULT_DIAGNOSIS_PHRASES: DiagnosisPhrases = {
    badBothDownHi: '🔴{metric}{双期}异常下降',
    badMomDownHi: '🔴{metric}{环比}异常下降',
    badYoyDownHi: '🔴{metric}{同比}异常下降',
    badBothUpLo: '🔴{metric}{双期}异常上升',
    badMomUpLo: '🔴{metric}{环比}异常上升',
    badYoyUpLo: '🔴{metric}{同比}异常上升',
    goodBothUpHi: '🟢{metric}{双期}显著上升',
    goodMomUpHi: '🟢{metric}{环比}显著上升',
    goodYoyUpHi: '🟢{metric}{同比}显著上升',
    goodBothDownLo: '🟢{metric}{双期}显著下降',
    goodMomDownLo: '🟢{metric}{环比}显著下降',
    goodYoyDownLo: '🟢{metric}{同比}显著下降',
    targetMiss: '🔴{metric}不达目标',
};

export type SubtableDiagnosisSettings = {
    redThreshold: number;
    greenThreshold: number;
    enabled: Record<string, boolean | undefined>;
    /** 自定义指标在诊断里的显示名，key 为 pl_* / tr_* */
    metricLabels?: Record<string, string | undefined>;
    phrases?: Partial<DiagnosisPhrases>;
    /** 为 false 时子表与复制表格均不展示「标签」列 */
    showTagColumn?: boolean;
};

export const DEFAULT_SUBTABLE_DIAGNOSIS: SubtableDiagnosisSettings = {
    redThreshold: 0.1,
    greenThreshold: 0.3,
    enabled: {},
    metricLabels: {},
    phrases: {},
    showTagColumn: false,
};

export function mergeDiagnosisPhrases(p?: Partial<DiagnosisPhrases>): DiagnosisPhrases {
    return { ...DEFAULT_DIAGNOSIS_PHRASES, ...p };
}

function applyPhraseTemplate(tpl: string, metric: string, isWeekly: boolean): string {
    const 双期 = isWeekly ? '周同环比' : '同环比';
    const 环比 = isWeekly ? '周环比' : '环比';
    const 同比 = isWeekly ? '周同比' : '同比';
    return tpl
        .replace(/\{metric\}/g, metric)
        .replace(/\{双期\}/g, 双期)
        .replace(/\{环比\}/g, 环比)
        .replace(/\{同比\}/g, 同比);
}

export function loadSubtableDiagnosisSettings(): SubtableDiagnosisSettings {
    const fallback = (): SubtableDiagnosisSettings => ({
        ...DEFAULT_SUBTABLE_DIAGNOSIS,
        enabled: { ...DEFAULT_SUBTABLE_DIAGNOSIS.enabled },
        metricLabels: { ...DEFAULT_SUBTABLE_DIAGNOSIS.metricLabels },
        phrases: {},
        showTagColumn: false,
    });
    if (typeof localStorage === 'undefined') return fallback();
    try {
        let raw = localStorage.getItem(SUBTABLE_DIAGNOSIS_STORAGE_KEY);
        if (!raw) {
            raw = localStorage.getItem(LEGACY_STORAGE_KEY);
        }
        if (!raw) return fallback();
        const p = JSON.parse(raw) as Partial<SubtableDiagnosisSettings>;
        return {
            redThreshold: typeof p.redThreshold === 'number' && p.redThreshold > 0 ? p.redThreshold : DEFAULT_SUBTABLE_DIAGNOSIS.redThreshold,
            greenThreshold: typeof p.greenThreshold === 'number' && p.greenThreshold > 0 ? p.greenThreshold : DEFAULT_SUBTABLE_DIAGNOSIS.greenThreshold,
            enabled: p.enabled && typeof p.enabled === 'object' ? { ...p.enabled } : {},
            metricLabels: p.metricLabels && typeof p.metricLabels === 'object' ? { ...p.metricLabels } : {},
            phrases: p.phrases && typeof p.phrases === 'object' ? { ...p.phrases } : {},
            /** 仅当显式为 true 时显示；缺省/旧数据未写该项 → 不显示 */
            showTagColumn: p.showTagColumn === true,
        };
    } catch {
        return fallback();
    }
}

export function saveSubtableDiagnosisSettings(s: SubtableDiagnosisSettings) {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(
            SUBTABLE_DIAGNOSIS_STORAGE_KEY,
            JSON.stringify({
                redThreshold: s.redThreshold,
                greenThreshold: s.greenThreshold,
                enabled: s.enabled,
                metricLabels: s.metricLabels || {},
                phrases: s.phrases || {},
                showTagColumn: s.showTagColumn === true,
            })
        );
    } catch {
        // ignore
    }
}

const safeRatio = (a: number, b: number) => (b ? a / b : 0);

type MetricDef = {
    id: string;
    short: string;
    higherIsBetter: boolean;
} & (
    | { kind: 'key'; key: string }
    | { kind: 'title'; matchTitle: string }
    | { kind: 'fn'; getValue: (d: AggregatedData) => number; labelFor: string }
);

const PL_SPECS: MetricDef[] = [
    { id: 'pl_gross_profit', short: '毛利额', kind: 'key', key: 'gross_profit', higherIsBetter: true },
    { id: 'pl_gross_margin', short: '毛利率', kind: 'key', key: 'gross_margin', higherIsBetter: true },
    { id: 'pl_avg_ticket', short: '客单价', kind: 'key', key: 'avg_ticket', higherIsBetter: true },
    { id: 'pl_sales_q', short: '销量', kind: 'key', key: 'sales_quantity', higherIsBetter: true },
    { id: 'pl_fm', short: '头程占比', kind: 'title', matchTitle: '头程占比', higherIsBetter: false },
    { id: 'pl_procure', short: '采购占比', kind: 'title', matchTitle: '采购占比', higherIsBetter: false },
    { id: 'pl_storage', short: '仓储占比', kind: 'title', matchTitle: '仓储占比', higherIsBetter: false },
    { id: 'pl_fba', short: 'FBA费占比', kind: 'title', matchTitle: 'FBA费占比', higherIsBetter: false },
    { id: 'pl_refund', short: '退款占比', kind: 'title', matchTitle: '退款占比', higherIsBetter: false },
    { id: 'pl_comm', short: '佣金占比', kind: 'title', matchTitle: '佣金占比', higherIsBetter: false },
    { id: 'pl_ad', short: '广告占比', kind: 'title', matchTitle: '广告占比', higherIsBetter: false },
];

const TR_SPECS: MetricDef[] = [
    { id: 'tr_spend', short: '广告花费', kind: 'key', key: 'ad_spend', higherIsBetter: false },
    { id: 'tr_cpc', short: 'CPC', kind: 'title', matchTitle: 'CPC', higherIsBetter: false },
    {
        id: 'tr_ticket',
        short: '客单价',
        kind: 'fn',
        getValue: (d) => safeRatio(d.sales_amount, d.sales_quantity),
        labelFor: '客单价(销额/销量)',
        higherIsBetter: true,
    },
    { id: 'tr_cvr', short: '广告CVR', kind: 'title', matchTitle: '广告CVR', higherIsBetter: true },
    { id: 'tr_impr', short: '展示量', kind: 'key', key: 'impressions', higherIsBetter: true },
    { id: 'tr_ctr', short: 'CTR', kind: 'title', matchTitle: 'CTR', higherIsBetter: true },
    { id: 'tr_asoas', short: 'ASoAS', kind: 'title', matchTitle: 'ASoAS (广告订单占比)', higherIsBetter: true },
];

export const ALL_DIAGNOSIS_METRIC_IDS: string[] = [...PL_SPECS.map((s) => s.id), ...TR_SPECS.map((s) => s.id)];

type Col = {
    key?: string;
    title?: string;
    isTrend?: boolean;
    isDiagnosis?: boolean;
    hasTarget?: boolean;
    reverseColor?: boolean;
    calculator?: (d: AggregatedData) => number;
    formatter: (n: number) => string;
};

function resolveMetric(
    d: AggregatedData | null | undefined,
    spec: MetricDef,
    columnByKey: Map<string, Col>,
    columnByTitle: Map<string, Col>
): { val: number; col: Col | null } {
    if (!d) return { val: 0, col: null };
    if (spec.kind === 'key') {
        const col = columnByKey.get(spec.key) || null;
        if (!col) return { val: (d as any)[spec.key] || 0, col: null };
        const val = col.calculator ? col.calculator(d) : (d as any)[col.key!] || 0;
        return { val, col };
    }
    if (spec.kind === 'title') {
        const col = columnByTitle.get(spec.matchTitle) || null;
        if (!col) return { val: 0, col: null };
        const val = col.calculator ? col.calculator(d) : (d as any)[col.key!] || 0;
        return { val, col };
    }
    return { val: spec.getValue(d), col: null };
}

function relFromPrev(curr: number, base: number | null | undefined): number | null {
    if (base === null || base === undefined) return null;
    if (base === 0) return null;
    return (curr - base) / Math.abs(base);
}

function targetShortfall(
    curr: number,
    tgt: number,
    col: Col | null,
    isWeekly: boolean
): { miss: boolean } | null {
    if (isWeekly) return null;
    if (!col || !col.hasTarget) return null;
    if (tgt == null || (typeof tgt === 'number' && Number.isNaN(tgt))) return null;
    if (typeof curr !== 'number' || Number.isNaN(curr)) return null;
    const isRev = !!col.reverseColor;
    if (isRev) {
        return { miss: curr > tgt * 1.001 };
    }
    return { miss: curr < tgt * 0.999 };
}

export function getDiagnosisSortKey(tags: DiagnosisTag[]): number {
    const reds = tags.filter((t) => t.tone === 'red').length;
    const greens = tags.filter((t) => t.tone === 'green').length;
    return reds * 1000 + greens;
}

function metricDisplayName(spec: MetricDef, settings: SubtableDiagnosisSettings): string {
    const o = settings.metricLabels?.[spec.id];
    if (typeof o === 'string' && o.trim()) return o.trim();
    return spec.short;
}

export function getDiagnosisMetricOptions(
    subType: SubtableDiagnosisType
): { id: string; short: string; hint: string }[] {
    const specs = subType === 'PL' ? PL_SPECS : TR_SPECS;
    return specs.map((s) => {
        const hint = s.kind === 'title' ? s.matchTitle : s.kind === 'key' ? s.key : s.labelFor;
        return { id: s.id, short: s.short, hint };
    });
}

export function computeSubtableRowDiagnosis(args: {
    subType: SubtableDiagnosisType;
    settings: SubtableDiagnosisSettings;
    isWeekly: boolean;
    current: AggregatedData;
    last: AggregatedData | null | undefined;
    year: AggregatedData | null | undefined;
    target: AggregatedData | null | undefined;
    columnConfig: Col[];
}): DiagnosisTag[] {
    const { subType, settings, isWeekly, current, last, year, target, columnConfig } = args;
    const redT = settings.redThreshold;
    const grT = settings.greenThreshold;
    const phrases = mergeDiagnosisPhrases(settings.phrases);
    const specs = subType === 'PL' ? PL_SPECS : TR_SPECS;

    const columnByKey = new Map<string, Col>();
    const columnByTitle = new Map<string, Col>();
    for (const c of columnConfig) {
        if (c.isTrend || c.isDiagnosis) continue;
        if (c.key) columnByKey.set(String(c.key), c);
        if (typeof c.title === 'string') columnByTitle.set(c.title, c);
    }

    const tags: DiagnosisTag[] = [];

    for (const spec of specs) {
        if (settings.enabled[spec.id] === false) continue;

        const name = metricDisplayName(spec, settings);

        const a = resolveMetric(current, spec, columnByKey, columnByTitle);
        const b = last != null ? resolveMetric(last, spec, columnByKey, columnByTitle) : { val: 0, col: null as Col | null };
        const cY = year != null ? resolveMetric(year, spec, columnByKey, columnByTitle) : { val: 0, col: null as Col | null };
        const tB = target != null ? resolveMetric(target, spec, columnByKey, columnByTitle) : { val: 0, col: null as Col | null };

        const curV = a.val;
        const lastV = b.val;
        const yearV = cY.val;
        const tgtV = tB.val;
        const col = a.col || b.col || cY.col || tB.col;
        const effCol: Col | null = spec.kind === 'fn' && spec.id === 'tr_ticket' ? null : col;

        if (!isWeekly && effCol && effCol.hasTarget && target != null) {
            const th = targetShortfall(curV, tgtV, effCol, isWeekly);
            if (th?.miss) {
                tags.push({ text: applyPhraseTemplate(phrases.targetMiss, name, isWeekly), tone: 'red' });
            }
        }

        const mom = relFromPrev(curV, lastV);
        const yoy = relFromPrev(curV, yearV);
        const hasMom = last !== undefined && last !== null && mom !== null;
        const hasYoy = year !== undefined && year !== null && yoy !== null;
        const hi = spec.higherIsBetter;

        if (hi) {
            const momBad = hasMom && mom! <= -redT;
            const yoyBad = hasYoy && yoy! <= -redT;
            const momGood = hasMom && mom! >= grT;
            const yoyGood = hasYoy && yoy! >= grT;

            if (momBad && yoyBad) {
                tags.push({ text: applyPhraseTemplate(phrases.badBothDownHi, name, isWeekly), tone: 'red' });
            } else {
                if (momBad) tags.push({ text: applyPhraseTemplate(phrases.badMomDownHi, name, isWeekly), tone: 'red' });
                if (yoyBad) tags.push({ text: applyPhraseTemplate(phrases.badYoyDownHi, name, isWeekly), tone: 'red' });
            }

            if (momGood && yoyGood) {
                tags.push({ text: applyPhraseTemplate(phrases.goodBothUpHi, name, isWeekly), tone: 'green' });
            } else {
                if (momGood) tags.push({ text: applyPhraseTemplate(phrases.goodMomUpHi, name, isWeekly), tone: 'green' });
                if (yoyGood) tags.push({ text: applyPhraseTemplate(phrases.goodYoyUpHi, name, isWeekly), tone: 'green' });
            }
        } else {
            const momBad = hasMom && mom! >= redT;
            const yoyBad = hasYoy && yoy! >= redT;
            const momGood = hasMom && mom! <= -grT;
            const yoyGood = hasYoy && yoy! <= -grT;

            if (momBad && yoyBad) {
                tags.push({ text: applyPhraseTemplate(phrases.badBothUpLo, name, isWeekly), tone: 'red' });
            } else {
                if (momBad) tags.push({ text: applyPhraseTemplate(phrases.badMomUpLo, name, isWeekly), tone: 'red' });
                if (yoyBad) tags.push({ text: applyPhraseTemplate(phrases.badYoyUpLo, name, isWeekly), tone: 'red' });
            }

            if (momGood && yoyGood) {
                tags.push({ text: applyPhraseTemplate(phrases.goodBothDownLo, name, isWeekly), tone: 'green' });
            } else {
                if (momGood) tags.push({ text: applyPhraseTemplate(phrases.goodMomDownLo, name, isWeekly), tone: 'green' });
                if (yoyGood) tags.push({ text: applyPhraseTemplate(phrases.goodYoyDownLo, name, isWeekly), tone: 'green' });
            }
        }
    }

    return tags;
}

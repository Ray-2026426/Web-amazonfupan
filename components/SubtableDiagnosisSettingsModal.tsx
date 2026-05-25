import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import {
    getDiagnosisMetricOptions,
    loadSubtableDiagnosisSettings,
    saveSubtableDiagnosisSettings,
    DEFAULT_SUBTABLE_DIAGNOSIS,
    DEFAULT_DIAGNOSIS_PHRASES,
    mergeDiagnosisPhrases,
    type SubtableDiagnosisSettings,
    type SubtableDiagnosisType,
    type DiagnosisPhrases,
} from './subtableDiagnosis';
import { useEscClose } from './useEscClose';

type Props = {
    isOpen: boolean;
    onClose: () => void;
    subType: SubtableDiagnosisType;
    onSaved: () => void;
};

function pctToRatio(v: string): number {
    const n = parseFloat(v);
    if (Number.isNaN(n) || n <= 0) return DEFAULT_SUBTABLE_DIAGNOSIS.redThreshold;
    return n / 100;
}

function ratioToPct(r: number): string {
    return (r * 100).toFixed(0);
}

const PHRASE_ROWS: { key: keyof DiagnosisPhrases; label: string }[] = [
    { key: 'badBothDownHi', label: '环+同变差（高为好）' },
    { key: 'badMomDownHi', label: '环比变差（高为好）' },
    { key: 'badYoyDownHi', label: '同比变差（高为好）' },
    { key: 'badBothUpLo', label: '环+同变差（低为好）' },
    { key: 'badMomUpLo', label: '环比变差（低为好）' },
    { key: 'badYoyUpLo', label: '同比变差（低为好）' },
    { key: 'goodBothUpHi', label: '环+同向好（高为好）' },
    { key: 'goodMomUpHi', label: '环比向好（高为好）' },
    { key: 'goodYoyUpHi', label: '同比向好（高为好）' },
    { key: 'goodBothDownLo', label: '环+同向好（低为好）' },
    { key: 'goodMomDownLo', label: '环比向好（低为好）' },
    { key: 'goodYoyDownLo', label: '同比向好（低为好）' },
    { key: 'targetMiss', label: '未达目标' },
];

export const SubtableDiagnosisSettingsModal: React.FC<Props> = ({ isOpen, onClose, subType, onSaved }) => {
    const [redPct, setRedPct] = useState(String(ratioToPct(DEFAULT_SUBTABLE_DIAGNOSIS.redThreshold)));
    const [grPct, setGrPct] = useState(String(ratioToPct(DEFAULT_SUBTABLE_DIAGNOSIS.greenThreshold)));
    const [en, setEn] = useState<Record<string, boolean>>({});
    const [labels, setLabels] = useState<Record<string, string>>({});
    const [phrases, setPhrases] = useState<DiagnosisPhrases>(DEFAULT_DIAGNOSIS_PHRASES);
    const [showTagCol, setShowTagCol] = useState(false);

    const options = getDiagnosisMetricOptions(subType);

    useEffect(() => {
        if (!isOpen) return;
        const s = loadSubtableDiagnosisSettings();
        setRedPct(ratioToPct(s.redThreshold));
        setGrPct(ratioToPct(s.greenThreshold));
        setShowTagCol(s.showTagColumn === true);
        const m: Record<string, boolean> = {};
        const lab: Record<string, string> = {};
        for (const o of getDiagnosisMetricOptions(subType)) {
            m[o.id] = s.enabled[o.id] !== false;
            lab[o.id] = s.metricLabels?.[o.id] ?? '';
        }
        setEn(m);
        setLabels(lab);
        setPhrases(mergeDiagnosisPhrases(s.phrases));
    }, [isOpen, subType]);

    useEscClose(isOpen, onClose);

    if (!isOpen) return null;

    const allOn = (v: boolean) => {
        const m: Record<string, boolean> = { ...en };
        for (const o of options) m[o.id] = v;
        setEn(m);
    };

    const buildSettings = (): SubtableDiagnosisSettings => {
        const prev = loadSubtableDiagnosisSettings();
        const mergedEnabled = { ...prev.enabled };
        for (const o of options) {
            mergedEnabled[o.id] = en[o.id] !== false;
        }
        const mergedLabels: Record<string, string | undefined> = { ...(prev.metricLabels || {}) };
        for (const o of options) {
            const raw = (labels[o.id] ?? '').trim();
            if (!raw || raw === o.short) delete mergedLabels[o.id];
            else mergedLabels[o.id] = raw;
        }
        const mergedPhrases: Partial<DiagnosisPhrases> = { ...prev.phrases };
        (Object.keys(DEFAULT_DIAGNOSIS_PHRASES) as (keyof DiagnosisPhrases)[]).forEach((k) => {
            const cur = (phrases[k] ?? '').trim();
            const def = DEFAULT_DIAGNOSIS_PHRASES[k];
            if (!cur || cur === def) delete mergedPhrases[k];
            else mergedPhrases[k] = cur;
        });
        return {
            redThreshold: pctToRatio(redPct),
            greenThreshold: pctToRatio(grPct),
            enabled: mergedEnabled,
            metricLabels: mergedLabels,
            phrases: mergedPhrases,
            showTagColumn: showTagCol,
        };
    };

    const save = () => {
        const n = buildSettings();
        saveSubtableDiagnosisSettings(n);
        onSaved();
        onClose();
    };

    const reset = () => {
        setRedPct(ratioToPct(DEFAULT_SUBTABLE_DIAGNOSIS.redThreshold));
        setGrPct(ratioToPct(DEFAULT_SUBTABLE_DIAGNOSIS.greenThreshold));
        const m: Record<string, boolean> = {};
        const lab: Record<string, string> = {};
        for (const o of options) {
            m[o.id] = true;
            lab[o.id] = '';
        }
        setEn(m);
        setLabels(lab);
        setPhrases(DEFAULT_DIAGNOSIS_PHRASES);
        setShowTagCol(false);
        saveSubtableDiagnosisSettings({
            ...DEFAULT_SUBTABLE_DIAGNOSIS,
            enabled: {},
            metricLabels: {},
            phrases: {},
            showTagColumn: false,
        });
    };

    const setPhrase = (key: keyof DiagnosisPhrases, v: string) => {
        setPhrases((prev) => ({ ...prev, [key]: v }));
    };

    return (
        <div
            className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/50 p-4"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-0 shadow-2xl">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                    <h3 className="text-sm font-bold text-slate-800">子表「标签」列规则</h3>
                    <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100">
                        <X className="h-5 w-5" />
                    </button>
                </div>
                <div className="space-y-5 p-4 text-sm text-slate-700">
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 shadow-sm select-none">
                        <input
                            type="checkbox"
                            checked={showTagCol}
                            onChange={(e) => setShowTagCol(e.target.checked)}
                            className="h-3.5 w-3.5 rounded border-slate-300"
                        />
                        显示「标签」列
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-semibold text-slate-600">环/同 变差(红) ≥</span>
                            <div className="flex items-center gap-1">
                                <input
                                    className="w-full rounded border border-slate-200 px-2 py-1.5"
                                    value={redPct}
                                    onChange={(e) => setRedPct(e.target.value)}
                                    type="text"
                                />
                                <span className="text-slate-500">%</span>
                            </div>
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-semibold text-slate-600">环/同 明显向好(绿) ≥</span>
                            <div className="flex items-center gap-1">
                                <input
                                    className="w-full rounded border border-slate-200 px-2 py-1.5"
                                    value={grPct}
                                    onChange={(e) => setGrPct(e.target.value)}
                                    type="text"
                                />
                                <span className="text-slate-500">%</span>
                            </div>
                        </label>
                    </div>

                    <div>
                        <div className="mb-2 flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-700">参与指标</span>
                            <div className="flex gap-2">
                                <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => allOn(true)}>
                                    全选
                                </button>
                                <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => allOn(false)}>
                                    全不选
                                </button>
                            </div>
                        </div>
                        <ul className="max-h-52 space-y-2 overflow-y-auto rounded border border-slate-100 p-2">
                            {options.map((o) => (
                                <li key={o.id} className="flex flex-wrap items-center gap-2 text-xs sm:flex-nowrap">
                                    <input
                                        type="checkbox"
                                        id={`en-${o.id}`}
                                        checked={en[o.id] !== false}
                                        onChange={(e) => setEn((prev) => ({ ...prev, [o.id]: e.target.checked }))}
                                        className="shrink-0"
                                    />
                                    <label htmlFor={`en-${o.id}`} className="w-24 shrink-0 cursor-pointer font-medium text-slate-800">
                                        {o.short}
                                    </label>
                                    <input
                                        type="text"
                                        className="min-w-[8rem] flex-1 rounded border border-slate-200 px-2 py-1 text-xs"
                                        placeholder={`默认：${o.short}`}
                                        value={labels[o.id] ?? ''}
                                        onChange={(e) => setLabels((prev) => ({ ...prev, [o.id]: e.target.value }))}
                                    />
                                </li>
                            ))}
                        </ul>
                    </div>

                    <details className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                        <summary className="cursor-pointer select-none text-xs font-bold text-slate-700">标签用词模板</summary>
                        <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
                            {PHRASE_ROWS.map(({ key, label }) => (
                                <label key={key} className="block text-xs">
                                    <span className="mb-0.5 block text-[11px] font-medium text-slate-600">{label}</span>
                                    <input
                                        type="text"
                                        className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 font-mono text-[11px]"
                                        value={phrases[key]}
                                        onChange={(e) => setPhrase(key, e.target.value)}
                                    />
                                </label>
                            ))}
                        </div>
                    </details>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-4 py-3">
                    <button type="button" className="rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100" onClick={reset}>
                        恢复默认
                    </button>
                    <button
                        type="button"
                        className="rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                        onClick={onClose}
                    >
                        取消
                    </button>
                    <button type="button" className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700" onClick={save}>
                        保存
                    </button>
                </div>
            </div>
        </div>
    );
};

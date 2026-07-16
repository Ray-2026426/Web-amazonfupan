
import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileSpreadsheet, X, CheckCircle, AlertCircle, Info, HelpCircle, PackageSearch, Target, FileText, MessageSquare, FolderOpen, Image } from 'lucide-react';
import { DataCoverage, DataSourceDebugInfo } from '../types';
import { PERFORMANCE_ALIASES, COLUMN_DISPLAY_NAMES } from '../dataLoader';
import { assignFilesToSlots, UploadSlots, UPLOAD_SLOT_LABELS, UploadSlotKey, listMissingOptionalSlots } from '../uploadFileClassifier';
import { useEscClose } from './useEscClose';

export type DataUploadResult = {
    reports: DataSourceDebugInfo[];
    missingOptional: string[];
    unrecognizedNames: string[];
};

interface DataUploadModalProps {
    isOpen: boolean;
    onClose: () => void;
    onUpload: (slots: UploadSlots, coverage: DataCoverage) => Promise<DataUploadResult | undefined>;
    /** 再次导入时回填上次填写的起止日 */
    initialCoverage?: DataCoverage;
}

const DEFAULT_DATA_START = '2025-01-01';

const SLOT_ORDER: UploadSlotKey[] = ['monthly', 'weekly', 'target', 'inventory', 'refund', 'review', 'productImages'];

const emptySlots = (): UploadSlots => ({
    monthly: null,
    weekly: null,
    target: null,
    inventory: null,
    refund: null,
    review: null,
    productImages: null,
});

export const DataUploadModal: React.FC<DataUploadModalProps> = ({ isOpen, onClose, onUpload, initialCoverage }) => {
    const [slots, setSlots] = useState<UploadSlots>(emptySlots);
    const [unrecognized, setUnrecognized] = useState<File[]>([]);
    const [error, setError] = useState<string>('');
    const [isUploading, setIsUploading] = useState(false);
    const [result, setResult] = useState<DataUploadResult | null>(null);
    const [showGuide, setShowGuide] = useState(false);
    const [dataStartDate, setDataStartDate] = useState(DEFAULT_DATA_START);
    const [dataEndDate, setDataEndDate] = useState('');

    const batchInputRef = useRef<HTMLInputElement>(null);
    const slotInputRefs = useRef<Record<UploadSlotKey, HTMLInputElement | null>>({
        monthly: null,
        weekly: null,
        target: null,
        inventory: null,
        refund: null,
        review: null,
        productImages: null,
    });

    useEffect(() => {
        if (!isOpen) {
            const timer = setTimeout(() => {
                setResult(null);
                setError('');
                setShowGuide(false);
                setSlots(emptySlots());
                setUnrecognized([]);
            }, 200);
            return () => clearTimeout(timer);
        }
        setDataStartDate(initialCoverage?.dataStartDate || DEFAULT_DATA_START);
        setDataEndDate(initialCoverage?.dataEndDate || '');
    }, [isOpen, initialCoverage?.dataStartDate, initialCoverage?.dataEndDate]);

    useEscClose(isOpen, onClose);

    if (!isOpen) return null;

    const setSlotFile = (key: UploadSlotKey, file: File | null) => {
        setSlots(prev => ({ ...prev, [key]: file }));
        setError('');
    };

    const handleBatchFiles = (fileList: FileList | null) => {
        if (!fileList?.length) return;
        const arr = Array.from(fileList);
        const { slots: next, unrecognized: un } = assignFilesToSlots(arr);
        setSlots(prev => {
            const merged = { ...prev };
            (Object.keys(next) as UploadSlotKey[]).forEach(k => {
                if (next[k]) merged[k] = next[k];
            });
            return merged;
        });
        setUnrecognized(un);
        setError('');
    };

    const handleSlotInput = (key: UploadSlotKey, e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (f) setSlotFile(key, f);
        e.target.value = '';
    };

    const handleSubmit = async () => {
        if (!slots.monthly) {
            setError('【月度业绩表】为必填项：请一键上传或点选对应格子添加文件。');
            return;
        }
        if (!dataEndDate) {
            setError('请填写【数据截止日】：例如导入的是 7.1–7.13 的数据，截止日选 2026-07-13。');
            return;
        }
        if (dataStartDate && dataEndDate < dataStartDate) {
            setError('数据截止日不能早于起始日。');
            return;
        }
        setIsUploading(true);
        setError('');
        try {
            const uploadResult = await onUpload(slots, {
                dataStartDate: dataStartDate || DEFAULT_DATA_START,
                dataEndDate,
            });
            setIsUploading(false);
            if (uploadResult) {
                setResult({
                    ...uploadResult,
                    unrecognizedNames: [...uploadResult.unrecognizedNames, ...unrecognized.map(f => f.name)],
                });
            } else {
                setError('导入未完成：请确保已选择【月度业绩表】。');
            }
        } catch {
            setIsUploading(false);
            setError('解析发生未知错误，请检查文件格式。');
        }
    };

    const slotIcon = (key: UploadSlotKey) => {
        if (key === 'target') return <Target className="h-6 w-6 text-red-400" />;
        if (key === 'inventory') return <PackageSearch className="h-6 w-6 text-indigo-400" />;
        if (key === 'refund') return <FileText className="h-6 w-6 text-orange-400" />;
        if (key === 'review') return <MessageSquare className="h-6 w-6 text-yellow-400" />;
        if (key === 'productImages') return <Image className="h-6 w-6 text-pink-400" />;
        return <FileSpreadsheet className="h-6 w-6 text-slate-400" />;
    };

    const FileZone = ({ slotKey, required }: { slotKey: UploadSlotKey; required?: boolean }) => {
        const file = slots[slotKey];
        const label = UPLOAD_SLOT_LABELS[slotKey];
        const inputRef = (el: HTMLInputElement | null) => {
            slotInputRefs.current[slotKey] = el;
        };
        return (
            <div
                className={`relative flex h-[120px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition-all
                    ${file ? 'border-green-500 bg-green-50' : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'}
                `}
                onClick={() => slotInputRefs.current[slotKey]?.click()}
            >
                <input
                    ref={inputRef}
                    type="file"
                    className="hidden"
                    accept=".xlsx,.xls,.csv"
                    onChange={e => handleSlotInput(slotKey, e)}
                />
                {file ? (
                    <>
                        {React.cloneElement(slotIcon(slotKey) as React.ReactElement<{ className?: string }>, { className: 'h-6 w-6 text-green-600 mb-1' })}
                        <span className="max-w-full truncate px-1 text-center text-[11px] font-medium text-slate-800" title={file.name}>
                            {file.name}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1 text-[10px] font-bold text-green-600">
                            <CheckCircle className="h-3 w-3" /> 已匹配
                        </span>
                        <button
                            type="button"
                            className="absolute right-1 top-1 rounded-full p-1 text-slate-400 hover:bg-white/50 hover:text-red-500"
                            onClick={e => {
                                e.stopPropagation();
                                setSlotFile(slotKey, null);
                            }}
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </>
                ) : (
                    <>
                        {React.cloneElement(slotIcon(slotKey) as React.ReactElement<{ className?: string }>, { className: 'h-7 w-7 text-slate-400 mb-1' })}
                        <span className="text-center text-xs font-bold text-slate-600">{label}</span>
                        <span className="mt-0.5 text-[10px] text-slate-400">{required ? '必填' : '可选'}</span>
                    </>
                )}
            </div>
        );
    };

    if (showGuide) {
        return (
            <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
                <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl animate-in fade-in zoom-in duration-200">
                    <div className="flex flex-shrink-0 items-center justify-between bg-slate-800 px-6 py-4">
                        <h2 className="flex items-center gap-2 text-lg font-bold text-white">
                            <HelpCircle className="h-5 w-5 text-blue-400" />
                            表头匹配规范
                        </h2>
                        <button type="button" onClick={() => setShowGuide(false)} className="text-slate-400 transition-colors hover:text-white">
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                    <div className="custom-scroll flex-1 overflow-y-auto p-6">
                        <div className="mb-4 flex items-start gap-2 rounded border border-orange-100 bg-orange-50 p-3 text-sm text-slate-500">
                            <AlertCircle className="mt-0.5 h-4 w-4 text-orange-500" />
                            <div>
                                <span className="font-bold text-orange-700">严格匹配模式：</span>
                                您的 Excel 表头必须与系统识别的名称一致。
                            </div>
                        </div>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                            {Object.entries(COLUMN_DISPLAY_NAMES).map(([key, displayName]) => {
                                const aliases = PERFORMANCE_ALIASES[key];
                                if (!aliases?.length) return null;
                                return (
                                    <div key={key} className="rounded border border-slate-200 bg-slate-50 p-2">
                                        <div className="text-xs font-bold text-slate-700">{displayName}</div>
                                        <div className="mt-1 font-mono text-xs text-green-700">{aliases[0]}</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (result) {
        return (
            <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
                <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl animate-in fade-in zoom-in duration-200">
                    <div className="flex flex-shrink-0 items-center justify-between bg-green-600 px-6 py-4">
                        <h2 className="flex items-center gap-2 text-lg font-bold text-white">
                            <CheckCircle className="h-5 w-5" />
                            解析完成 ({result.reports.length} 个文件)
                        </h2>
                        <button type="button" onClick={onClose} className="text-green-100 transition-colors hover:text-white">
                            <X className="h-5 w-5" />
                        </button>
                    </div>

                    <div className="custom-scroll flex-1 space-y-4 overflow-y-auto p-6">
                        {(result.missingOptional.length > 0 || result.unrecognizedNames.length > 0) && (
                            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                                {result.missingOptional.length > 0 && (
                                    <p>
                                        <span className="font-bold">未上传的可选表：</span>
                                        {result.missingOptional.join('、')}
                                    </p>
                                )}
                                {result.unrecognizedNames.length > 0 && (
                                    <p>
                                        <span className="font-bold">未能自动归类的文件（已忽略）：</span>
                                        {result.unrecognizedNames.join('、')}
                                    </p>
                                )}
                            </div>
                        )}
                        {result.reports.map((report, idx) => (
                            <div key={idx} className="overflow-hidden rounded-lg border border-slate-200">
                                <div className="flex items-center justify-between border-b border-slate-200 bg-slate-100 px-4 py-2">
                                    <span className="text-sm font-bold text-slate-700">{report.filename}</span>
                                    <div className="flex gap-3 text-xs">
                                        <span className="text-slate-500">总行数: {report.totalRows}</span>
                                        <span className={`font-bold ${report.validRows > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            有效行数: {report.validRows}
                                        </span>
                                    </div>
                                </div>
                                <div className="bg-white p-4">
                                    {report.errors.length > 0 && (
                                        <div className="mb-3 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                                            <ul className="list-inside list-disc">
                                                {report.errors.map((e, i) => (
                                                    <li key={i}>{e}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                    <div className="text-xs text-slate-500">已成功映射 {Object.keys(report.mappedColumns).length} 个字段。</div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="flex flex-shrink-0 justify-end border-t border-gray-100 bg-gray-50 px-6 py-4">
                        <button type="button" onClick={onClose} className="rounded bg-blue-600 px-6 py-2 font-medium text-white shadow-sm hover:bg-blue-700">
                            开始分析
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    const missingPreview = listMissingOptionalSlots(slots);

    return (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
            <div className="max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-xl bg-white shadow-2xl animate-in fade-in zoom-in duration-200">
                <div className="flex items-center justify-between bg-slate-800 px-6 py-4">
                    <h2 className="flex items-center gap-2 text-lg font-bold text-white">
                        <FileSpreadsheet className="h-5 w-5 text-blue-400" />
                        数据源导入
                    </h2>
                    <button type="button" onClick={onClose} className="text-slate-400 transition-colors hover:text-white">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="custom-scroll max-h-[calc(92vh-200px)] space-y-5 overflow-y-auto p-6">
                    <div
                        className="cursor-pointer rounded-xl border-2 border-dashed border-sky-300 bg-sky-50/80 p-6 text-center transition-all hover:border-sky-500 hover:bg-sky-50"
                        onClick={() => batchInputRef.current?.click()}
                    >
                        <input
                            ref={batchInputRef}
                            type="file"
                            multiple
                            className="hidden"
                            accept=".xlsx,.xls,.csv"
                            onChange={e => {
                                handleBatchFiles(e.target.files);
                                e.target.value = '';
                            }}
                        />
                        <FolderOpen className="mx-auto mb-2 h-10 w-10 text-sky-500" />
                        <p className="text-sm font-bold text-slate-800">一键上传（可多选）</p>
                        <p className="mt-1 text-xs text-slate-500">按文件名中英文关键词自动归类到下方格子；可归类的文件会覆盖同类型旧文件</p>
                    </div>

                    {unrecognized.length > 0 && (
                        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                            <div>
                                <span className="font-bold">以下文件未能自动识别类型，请手动点对应格子选择：</span>
                                <span className="ml-1">{unrecognized.map(f => f.name).join('、')}</span>
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {SLOT_ORDER.map((slotKey) => (
                            <React.Fragment key={slotKey}>
                                <FileZone slotKey={slotKey} required={slotKey === 'monthly'} />
                            </React.Fragment>
                        ))}
                    </div>

                    {missingPreview.length > 0 && slots.monthly && (
                        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                            <span className="font-bold">当前仍缺（可选）：</span>
                            {missingPreview.join('、')}
                        </div>
                    )}

                    <div className="rounded-lg border border-sky-200 bg-sky-50/70 p-4">
                        <div className="mb-2 text-sm font-bold text-slate-800">数据覆盖日期（算序时用）</div>
                        <p className="mb-3 text-xs text-slate-500">
                            填写本次导入数据实际覆盖的起止日。例如 7.1–7.13 的数据，截止日选 13 号；系统会用「截止日当天 ÷ 当月天数」算序时进度。整月数据（截止日=月末）则不额外显示序时。
                        </p>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <label className="flex flex-col gap-1 text-xs text-slate-600">
                                <span className="font-medium">起始日</span>
                                <input
                                    type="date"
                                    value={dataStartDate}
                                    onChange={e => setDataStartDate(e.target.value)}
                                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                                />
                            </label>
                            <label className="flex flex-col gap-1 text-xs text-slate-600">
                                <span className="font-medium">
                                    截止日 <span className="text-red-500">*</span>
                                </span>
                                <input
                                    type="date"
                                    value={dataEndDate}
                                    onChange={e => setDataEndDate(e.target.value)}
                                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                                />
                            </label>
                        </div>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 rounded border border-red-100 bg-red-50 p-3 text-sm text-red-600">
                            <AlertCircle className="h-4 w-4" />
                            {error}
                        </div>
                    )}

                    <div className="flex items-center justify-between rounded border border-slate-100 bg-slate-50 p-3 text-xs text-slate-500">
                        <span>支持 .xlsx / .xls / .csv。商品图片表：SKU、品名、第三列可为嵌入图片或 http 链接（嵌入图请用 .xlsx）。</span>
                        <button type="button" onClick={() => setShowGuide(true)} className="flex items-center gap-1 font-medium whitespace-nowrap text-blue-600 hover:underline">
                            <Info className="h-3 w-3" /> 表头规范
                        </button>
                    </div>
                </div>

                <div className="flex justify-end gap-3 border-t border-gray-100 bg-gray-50 px-6 py-4">
                    <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-800">
                        取消
                    </button>
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={isUploading}
                        className={`flex items-center gap-2 rounded px-6 py-2 text-sm font-bold text-white shadow-sm
                            ${isUploading ? 'cursor-not-allowed bg-blue-400' : 'bg-blue-600 hover:bg-blue-700'}
                        `}
                    >
                        {isUploading ? (
                            <>
                                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                                解析中...
                            </>
                        ) : (
                            <>
                                <Upload className="h-4 w-4" />
                                确认导入
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

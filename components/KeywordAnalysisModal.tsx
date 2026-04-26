
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { X, Upload, Search, Loader2, Filter, Bot, Sparkles, Target, Settings, Trash2, ArrowRight, Zap, Activity, BarChart2, MousePointer, DollarSign, TrendingUp, AlertCircle, ChevronDown, Check, Sliders, Tag, ArrowUp, ArrowDown, Calculator, FileText } from 'lucide-react';
import { parseSearchTermReport } from '../dataLoader';
import { SearchTermRow } from '../types';
import { formatNumber, formatMoney, formatPercent, formatMoneyNoDecimals } from '../utils';
import { PromptSettingsModal, getActivePromptSettings } from './PromptSettingsModal';
import { hasConfiguredAiApi, unifiedGenerateContent } from './aiUnifiedGenerate';

interface KeywordAnalysisModalProps {
    isOpen: boolean;
    onClose: () => void;
    data: SearchTermRow[];
    onDataChange: (data: SearchTermRow[]) => void;
}

// --- Types & Interfaces ---

type ExposureLabel = '高曝光' | '中曝光' | '低曝光';
type EfficiencyLabel = '高点击·高转化' | '高点击·低转化' | '低点击·高转化' | '低点击·低转化';

interface AnalysisSettings {
    exposureMode: 'relative' | 'absolute'; 
    highExposureThreshold: number; 
    lowExposureThreshold: number;  
    
    // New: CTR/CVR Benchmarks
    useCustomBenchmarks: boolean;
    targetCTR: number; // Percentage (e.g. 0.5 for 0.5%)
    targetCVR: number; // Percentage (e.g. 10 for 10%)
}

interface EnrichedRow extends SearchTermRow {
    ctr: number;
    cvr: number;
    acos: number;
    cpc: number;
    exposureLabel: ExposureLabel;
    efficiencyLabel: EfficiencyLabel;
    actionSuggestion: string;
    semanticCategory: string; 
}

type SortKey = 'impressions' | 'clicks' | 'ad_orders' | 'ctr' | 'cvr' | 'spend' | 'acos' | 'ad_sales';
type SortDirection = 'asc' | 'desc';

// --- Constants ---

const SEMANTIC_RULES: Record<string, string[]> = {
    '适用人群': ['men', 'women', 'kid', 'boy', 'girl', 'baby', 'adult', 'child', 'senior', '男', '女', '童', 'old'],
    '颜色属性': ['red', 'blue', 'green', 'black', 'white', 'yellow', 'pink', 'gold', 'silver', 'purple', '黑', '白', '红', '蓝'],
    '尺寸规格': ['small', 'large', 'medium', 'big', 'mini', 'xl', 'xxl', 'cm', 'mm', 'inch', 'size', '大', '小'],
    '场景用途': ['home', 'office', 'car', 'kitchen', 'outdoor', 'party', 'travel', 'gym', 'garden', 'gift', '户外', '家'],
    '品牌词': ['nike', 'adidas', 'apple', 'sony', 'samsung', 'brand', 'official', 'store'], 
    '长尾修饰': ['best', 'cheap', 'top', 'new', 'funny', 'cute', 'soft', 'hard', 'hot', 'cool']
};

const DEFAULT_SETTINGS: AnalysisSettings = {
    exposureMode: 'relative',
    highExposureThreshold: 130, 
    lowExposureThreshold: 70,
    useCustomBenchmarks: false,
    targetCTR: 0.5, 
    targetCVR: 5.0
};

// --- Helper Functions ---

const detectCategory = (term: string): string => {
    const t = term.toLowerCase();
    for (const [cat, keywords] of Object.entries(SEMANTIC_RULES)) {
        if (keywords.some(k => t.includes(k))) return cat;
    }
    return '其他/功能词';
};

const getActionSuggestion = (exp: ExposureLabel, eff: EfficiencyLabel): string => {
    if (eff === '高点击·高转化') {
        return exp === '低曝光' ? '🚀 抢首位/提竞价 (拓流)' : '🌟 保持/适度拓词 (明星)';
    }
    if (eff === '高点击·低转化') {
        return '📉 否词/降价/优化Listing (查内功)';
    }
    if (eff === '低点击·高转化') {
        return '🎨 优化主图/加Coupon/提位置 (提CTR)';
    }
    return exp === '高曝光' ? '🛑 精准否定/检查相关性 (浪费)' : '💤 降权/观察 (长尾)';
};

// --- Sub-Components ---

const DropdownFilter = ({ 
    label, 
    options, 
    selected, 
    onChange 
}: { 
    label: string, 
    options: string[], 
    selected: string[], 
    onChange: (vals: string[]) => void 
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false);
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    const toggleOption = (opt: string) => {
        if (selected.includes(opt)) onChange(selected.filter(s => s !== opt));
        else onChange([...selected, opt]);
    };

    return (
        <div className="relative" ref={containerRef}>
            <button 
                onClick={() => setIsOpen(!isOpen)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all max-w-[160px]
                    ${selected.length > 0 ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'}
                `}
                title={selected.length > 0 ? selected.join(', ') : label}
            >
                <span className="truncate">{label} {selected.length > 0 && `(${selected.length})`}</span>
                <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
            </button>
            {isOpen && (
                <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-xl z-50 overflow-hidden flex flex-col">
                    <div className="max-h-60 overflow-y-auto custom-scroll p-1">
                        {options.map(opt => (
                            <div 
                                key={opt} 
                                onClick={() => toggleOption(opt)}
                                className="flex items-center gap-2 px-2 py-2 hover:bg-slate-50 cursor-pointer rounded text-xs text-slate-700"
                            >
                                <div className={`w-3.5 h-3.5 border rounded flex items-center justify-center flex-shrink-0 ${selected.includes(opt) ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'}`}>
                                    {selected.includes(opt) && <Check className="w-2.5 h-2.5 text-white" />}
                                </div>
                                <span className="truncate">{opt}</span>
                            </div>
                        ))}
                    </div>
                    {selected.length > 0 && (
                        <div className="p-2 border-t border-slate-100 bg-slate-50">
                            <button onClick={() => onChange([])} className="w-full text-center text-[10px] text-slate-500 hover:text-red-500">清除筛选</button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const SettingsPanel = ({ 
    isOpen, 
    onClose, 
    settings, 
    onSave,
    avgImpression,
    avgCtr,
    avgCvr
}: { 
    isOpen: boolean, 
    onClose: () => void, 
    settings: AnalysisSettings, 
    onSave: (s: AnalysisSettings) => void,
    avgImpression: number,
    avgCtr: number,
    avgCvr: number
}) => {
    const [localSettings, setLocalSettings] = useState(settings);

    useEffect(() => { setLocalSettings(settings); }, [settings, isOpen]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[150] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in zoom-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200 flex flex-col max-h-[90vh]">
                <div className="bg-slate-800 px-4 py-3 flex justify-between items-center text-white flex-shrink-0">
                    <h3 className="font-bold flex items-center gap-2"><Sliders className="w-4 h-4" /> 分析标准配置</h3>
                    <button onClick={onClose}><X className="w-4 h-4" /></button>
                </div>
                <div className="p-6 space-y-6 overflow-y-auto custom-scroll">
                    
                    {/* 1. Exposure Settings */}
                    <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                        <div className="flex justify-between items-center mb-3">
                            <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                                <Target className="w-4 h-4 text-blue-500" /> 曝光量分层标准
                            </label>
                            <div className="flex bg-white p-0.5 rounded border border-slate-200">
                                <button 
                                    onClick={() => setLocalSettings(s => ({...s, exposureMode: 'relative'}))}
                                    className={`px-2 py-1 text-[10px] font-bold rounded transition-all ${localSettings.exposureMode === 'relative' ? 'bg-blue-100 text-blue-700' : 'text-slate-400'}`}
                                >
                                    相对(%)
                                </button>
                                <button 
                                    onClick={() => setLocalSettings(s => ({...s, exposureMode: 'absolute'}))}
                                    className={`px-2 py-1 text-[10px] font-bold rounded transition-all ${localSettings.exposureMode === 'absolute' ? 'bg-blue-100 text-blue-700' : 'text-slate-400'}`}
                                >
                                    绝对值
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <div className="text-xs text-slate-500 mb-1">高曝光 (High) ≥</div>
                                <div className="flex items-center gap-2">
                                    <input 
                                        type="number" 
                                        value={localSettings.highExposureThreshold}
                                        onChange={e => setLocalSettings(s => ({...s, highExposureThreshold: Number(e.target.value)}))}
                                        className="border border-slate-300 rounded px-2 py-1 text-sm w-full outline-none focus:border-blue-500"
                                    />
                                    <span className="text-xs text-slate-400">{localSettings.exposureMode === 'relative' ? '%' : ''}</span>
                                </div>
                                <div className="text-[10px] text-slate-400 mt-1">
                                    当前参考: {localSettings.exposureMode === 'relative' ? Math.round(avgImpression * localSettings.highExposureThreshold / 100) : localSettings.highExposureThreshold}
                                </div>
                            </div>
                            <div>
                                <div className="text-xs text-slate-500 mb-1">低曝光 (Low) &lt;</div>
                                <div className="flex items-center gap-2">
                                    <input 
                                        type="number" 
                                        value={localSettings.lowExposureThreshold}
                                        onChange={e => setLocalSettings(s => ({...s, lowExposureThreshold: Number(e.target.value)}))}
                                        className="border border-slate-300 rounded px-2 py-1 text-sm w-full outline-none focus:border-blue-500"
                                    />
                                    <span className="text-xs text-slate-400">{localSettings.exposureMode === 'relative' ? '%' : ''}</span>
                                </div>
                                <div className="text-[10px] text-slate-400 mt-1">
                                    当前参考: {localSettings.exposureMode === 'relative' ? Math.round(avgImpression * localSettings.lowExposureThreshold / 100) : localSettings.lowExposureThreshold}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 2. Efficiency Settings (CTR/CVR) */}
                    <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                        <div className="flex justify-between items-center mb-3">
                            <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                                <Zap className="w-4 h-4 text-orange-500" /> 效能达标基准 (Benchmarks)
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <span className="text-[10px] text-slate-500">使用自定义</span>
                                <div 
                                    className={`w-8 h-4 rounded-full relative transition-colors ${localSettings.useCustomBenchmarks ? 'bg-orange-500' : 'bg-slate-300'}`}
                                    onClick={() => setLocalSettings(s => ({...s, useCustomBenchmarks: !s.useCustomBenchmarks}))}
                                >
                                    <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${localSettings.useCustomBenchmarks ? 'translate-x-4' : ''}`}></div>
                                </div>
                            </label>
                        </div>

                        <div className={`grid grid-cols-2 gap-4 ${!localSettings.useCustomBenchmarks ? 'opacity-70' : ''}`}>
                            <div>
                                <div className="text-xs text-slate-500 mb-1">目标 CTR (%)</div>
                                <input 
                                    type="number" 
                                    step="0.1"
                                    value={localSettings.useCustomBenchmarks ? localSettings.targetCTR : (avgCtr * 100).toFixed(2)}
                                    onChange={e => setLocalSettings(s => ({...s, targetCTR: Number(e.target.value)}))}
                                    className="border border-slate-300 rounded px-2 py-1 text-sm w-full outline-none focus:border-orange-500 disabled:bg-slate-100 disabled:text-slate-500"
                                    disabled={!localSettings.useCustomBenchmarks}
                                />
                            </div>
                            <div>
                                <div className="text-xs text-slate-500 mb-1">目标 CVR (%)</div>
                                <input 
                                    type="number" 
                                    step="0.5"
                                    value={localSettings.useCustomBenchmarks ? localSettings.targetCVR : (avgCvr * 100).toFixed(2)}
                                    onChange={e => setLocalSettings(s => ({...s, targetCVR: Number(e.target.value)}))}
                                    className="border border-slate-300 rounded px-2 py-1 text-sm w-full outline-none focus:border-orange-500 disabled:bg-slate-100 disabled:text-slate-500"
                                    disabled={!localSettings.useCustomBenchmarks}
                                />
                            </div>
                        </div>
                        
                        {!localSettings.useCustomBenchmarks && (
                            <div className="mt-2 text-[10px] text-slate-500 flex gap-4 bg-white p-2 rounded border border-slate-100">
                                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span> 自动使用当前数据加权平均值</span>
                            </div>
                        )}
                    </div>
                </div>
                <div className="p-4 border-t border-slate-100 flex justify-end gap-2 bg-slate-50">
                    <button onClick={onClose} className="px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-200 rounded">取消</button>
                    <button onClick={() => { onSave(localSettings); onClose(); }} className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded shadow">保存配置</button>
                </div>
            </div>
        </div>
    );
};

// --- Funnel Header Component ---
const FunnelHeader = ({ stats }: { stats: any }) => {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-6 mb-4 flex items-center justify-between relative overflow-hidden w-full">
        {/* Stage 1: Exposure */}
        <div className="flex-1 flex flex-col items-center relative z-10 text-center">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-2">
                <Target className="w-3.5 h-3.5 text-slate-300" />
                曝光 (Exposure)
            </div>
            <div className="text-xl md:text-3xl font-bold text-slate-800 tracking-tight">{formatNumber(stats.imp)}</div>
            <div className="text-[10px] text-slate-400 mt-1 uppercase tracking-wider mb-1">Impressions</div>
            <div className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-mono border border-slate-200">
                {stats.count} Keywords
            </div>
        </div>

        {/* Connector 1: CTR */}
        <div className="flex-none flex flex-col items-center justify-center px-2 md:px-6 relative z-10 w-[20%]">
             <div className="h-0.5 w-full bg-slate-200 relative">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-3 py-1 rounded-full border border-blue-200 text-blue-600 font-bold text-[10px] md:text-xs shadow-sm flex flex-col items-center min-w-[80px]">
                    <span className="text-[9px] text-slate-400 uppercase mb-0.5">CTR</span>
                    {formatPercent(stats.ctr)}
                </div>
             </div>
        </div>

        {/* Stage 2: Traffic */}
        <div className="flex-1 flex flex-col items-center relative z-10 text-center">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-2">
                <MousePointer className="w-3.5 h-3.5 text-blue-300" />
                点击 (Traffic)
            </div>
            <div className="text-xl md:text-3xl font-bold text-blue-600 tracking-tight">{formatNumber(stats.click)}</div>
            <div className="flex flex-col md:flex-row gap-1 md:gap-3 mt-1.5 text-[10px] md:text-xs justify-center w-full">
                <span className="text-slate-500 bg-slate-50 px-2 py-0.5 rounded border border-slate-100 whitespace-nowrap">Spend: {formatMoneyNoDecimals(stats.spend)}</span>
                <span className="text-slate-500 bg-slate-50 px-2 py-0.5 rounded border border-slate-100 whitespace-nowrap">CPC: {formatMoney(stats.click > 0 ? stats.spend/stats.click : 0)}</span>
            </div>
        </div>

        {/* Connector 2: CVR */}
        <div className="flex-none flex flex-col items-center justify-center px-2 md:px-6 relative z-10 w-[20%]">
             <div className="h-0.5 w-full bg-slate-200 relative">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-3 py-1 rounded-full border border-purple-200 text-purple-600 font-bold text-[10px] md:text-xs shadow-sm flex flex-col items-center min-w-[80px]">
                    <span className="text-[9px] text-slate-400 uppercase mb-0.5">CVR</span>
                    {formatPercent(stats.cvr)}
                </div>
             </div>
        </div>

        {/* Stage 3: Conversion */}
        <div className="flex-1 flex flex-col items-center relative z-10 text-center">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-2">
                <DollarSign className="w-3.5 h-3.5 text-green-300" />
                转化 (Order)
            </div>
            <div className="text-xl md:text-3xl font-bold text-green-600 tracking-tight">{formatNumber(stats.order)}</div>
            <div className="flex flex-col md:flex-row gap-1 md:gap-3 mt-1.5 text-[10px] md:text-xs justify-center w-full">
                <span className="text-slate-500 bg-slate-50 px-2 py-0.5 rounded border border-slate-100 whitespace-nowrap">Sales: {formatMoneyNoDecimals(stats.sales)}</span>
                <span className={`px-2 py-0.5 rounded border whitespace-nowrap ${stats.acos > 0.4 ? 'bg-red-50 border-red-100 text-red-600' : 'bg-green-50 border-green-100 text-green-600'}`}>
                    ACOS: {formatPercent(stats.acos)}
                </span>
            </div>
        </div>
    </div>
  )
}

export const KeywordAnalysisModal: React.FC<KeywordAnalysisModalProps> = ({ isOpen, onClose, data, onDataChange }) => {
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState('');
    const [filterText, setFilterText] = useState('');
    
    // Filters
    const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
    const [selectedExposures, setSelectedExposures] = useState<string[]>([]);
    const [selectedEfficiencies, setSelectedEfficiencies] = useState<string[]>([]);
    const [selectedPortfolios, setSelectedPortfolios] = useState<string[]>([]); // Changed from Campaign to Portfolio

    const [settings, setSettings] = useState<AnalysisSettings>(DEFAULT_SETTINGS);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    
    // Sorting
    const [sortConfig, setSortConfig] = useState<{ key: SortKey, direction: SortDirection }>({ key: 'spend', direction: 'desc' });

    // AI
    const [aiInsight, setAiInsight] = useState('');
    const [isGeneratingAi, setIsGeneratingAi] = useState(false);
    const [isAiConfigOpen, setIsAiConfigOpen] = useState(false);

    // Virtual Scroll State
    const [visibleCount, setVisibleCount] = useState(50);
    const tableContainerRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // --- 1. Base Statistics ---
    const stats = useMemo(() => {
        if (!data || data.length === 0) return { avgImp: 0, avgClick: 0, avgCtr: 0, avgCvr: 0 };
        
        let totalImp = 0, totalClick = 0, totalOrder = 0;
        data.forEach(r => {
            totalImp += r.impressions;
            totalClick += r.clicks;
            totalOrder += r.ad_orders;
        });
        
        const count = data.length;
        const avgImp = totalImp / count;
        const avgClick = totalClick / count;
        const avgCtr = totalImp > 0 ? totalClick / totalImp : 0; // Weighted Avg
        const avgCvr = totalClick > 0 ? totalOrder / totalClick : 0; // Weighted Avg

        return { avgImp, avgClick, avgCtr, avgCvr };
    }, [data]);

    // --- 2. Enrich Data (Classify & Label) ---
    const enrichedData = useMemo(() => {
        if (!data) return [];

        const benchmarkCtr = settings.useCustomBenchmarks ? settings.targetCTR / 100 : stats.avgCtr;
        const benchmarkCvr = settings.useCustomBenchmarks ? settings.targetCVR / 100 : stats.avgCvr;

        return data.map(r => {
            const ctr = r.impressions > 0 ? r.clicks / r.impressions : 0;
            const cvr = r.clicks > 0 ? r.ad_orders / r.clicks : 0;
            const acos = r.ad_sales > 0 ? r.spend / r.ad_sales : 0;
            const cpc = r.clicks > 0 ? r.spend / r.clicks : 0;

            // Exposure Label
            let expLabel: ExposureLabel = '中曝光';
            let highThresh = 0, lowThresh = 0;
            
            if (settings.exposureMode === 'relative') {
                highThresh = stats.avgImp * (settings.highExposureThreshold / 100);
                lowThresh = stats.avgImp * (settings.lowExposureThreshold / 100);
            } else {
                highThresh = settings.highExposureThreshold;
                lowThresh = settings.lowExposureThreshold;
            }

            if (r.impressions >= highThresh) expLabel = '高曝光';
            else if (r.impressions < lowThresh) expLabel = '低曝光';

            // Efficiency Label
            const isHighClick = ctr >= benchmarkCtr; 
            const isHighConv = cvr >= benchmarkCvr;

            let effLabel: EfficiencyLabel = '低点击·低转化';
            if (isHighClick && isHighConv) effLabel = '高点击·高转化';
            else if (isHighClick && !isHighConv) effLabel = '高点击·低转化';
            else if (!isHighClick && isHighConv) effLabel = '低点击·高转化';

            const category = detectCategory(r.search_term);

            return {
                ...r,
                ctr, cvr, acos, cpc,
                exposureLabel: expLabel,
                efficiencyLabel: effLabel,
                actionSuggestion: getActionSuggestion(expLabel, effLabel),
                semanticCategory: category
            } as EnrichedRow;
        });
    }, [data, stats, settings]);

    // --- 3. Filtering & Sorting ---
    const processedData = useMemo(() => {
        // Filter
        let result = enrichedData.filter(r => {
            const matchesText = !filterText || r.search_term.toLowerCase().includes(filterText.toLowerCase());
            const matchesCat = selectedCategories.length === 0 || selectedCategories.includes(r.semanticCategory);
            const matchesExp = selectedExposures.length === 0 || selectedExposures.includes(r.exposureLabel);
            const matchesEff = selectedEfficiencies.length === 0 || selectedEfficiencies.includes(r.efficiencyLabel);
            const matchesPort = selectedPortfolios.length === 0 || selectedPortfolios.includes(r.portfolio_name || 'Unknown'); // Changed to portfolio
            
            return matchesText && matchesCat && matchesExp && matchesEff && matchesPort;
        });

        // Sort
        result.sort((a, b) => {
            const valA = a[sortConfig.key];
            const valB = b[sortConfig.key];
            if (sortConfig.direction === 'asc') return valA - valB;
            return valB - valA;
        });

        return result;
    }, [enrichedData, filterText, selectedCategories, selectedExposures, selectedEfficiencies, selectedPortfolios, sortConfig]);

    // --- 4. Aggregation for Current View ---
    const viewStats = useMemo(() => {
        let imp = 0, click = 0, order = 0, spend = 0, sales = 0;
        processedData.forEach(r => {
            imp += r.impressions;
            click += r.clicks;
            order += r.ad_orders;
            spend += r.spend;
            sales += r.ad_sales;
        });
        const ctr = imp > 0 ? click / imp : 0;
        const cvr = click > 0 ? order / click : 0;
        const acos = sales > 0 ? spend / sales : 0;
        
        return { imp, click, order, spend, sales, ctr, cvr, acos, count: processedData.length };
    }, [processedData]);

    // Options Lists
    const filterOptions = useMemo(() => {
        const cats = Array.from(new Set(enrichedData.map(r => r.semanticCategory))).sort();
        const exps = Array.from(new Set(enrichedData.map(r => r.exposureLabel))).sort();
        const effs = Array.from(new Set(enrichedData.map(r => r.efficiencyLabel))).sort();
        const portfolios = Array.from(new Set(enrichedData.map(r => r.portfolio_name || 'Unknown'))).sort(); // Changed to portfolios
        return { cats, exps, effs, portfolios };
    }, [enrichedData]);

    // --- Handlers ---

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setIsUploading(true);
        setUploadError('');
        try {
            const { data: parsedData, debug } = await parseSearchTermReport(file);
            if (parsedData.length === 0) {
                setUploadError("解析失败，未找到有效数据。");
            } else {
                onDataChange(parsedData);
            }
        } catch (err) {
            setUploadError("文件解析发生未知错误。");
        } finally {
            setIsUploading(false);
        }
    };

    const handleSort = (key: SortKey) => {
        setSortConfig(prev => ({
            key,
            direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
        }));
    };

    const generateExpertAnalysis = async () => {
        if (!hasConfiguredAiApi() || processedData.length === 0) return;
        setIsGeneratingAi(true);
        setAiInsight('');
        try {
            const top5Spend = processedData.slice(0, 5).map(r => `${r.search_term} (Spend: $${Math.round(r.spend)}, ACOS: ${(r.acos*100).toFixed(1)}%)`).join(', ');
            const top5Sales = [...processedData].sort((a,b) => b.ad_sales - a.ad_sales).slice(0, 5).map(r => `${r.search_term} (Sales: $${Math.round(r.ad_sales)})`).join(', ');
            const summary = `Total Spend: $${Math.round(viewStats.spend)}, Sales: $${Math.round(viewStats.sales)}, ACOS: ${(viewStats.acos*100).toFixed(1)}%`;
            
            const context = `
            【当前筛选数据概览】
            ${summary}
            包含关键词数量: ${viewStats.count}
            平均 CTR: ${(viewStats.ctr*100).toFixed(2)}%, 平均 CVR: ${(viewStats.cvr*100).toFixed(2)}%
            
            【Top 5 花费词】: ${top5Spend}
            【Top 5 销售词】: ${top5Sales}
            `;

            const defaultPrompt = `你是一个亚马逊顶级SEO专家。请根据以上关键词数据进行深度诊断。
            请输出 Markdown 格式报告：
            1. **整体效能评估**: 针对当前筛选的词群，评价广告花费效率 (ACOS) 和流量质量 (CTR/CVR)。
            2. **问题诊断**: 找出主要浪费点或机会点。
            3. **优化策略**: 给出3-5条具体的操作建议（如：否词、提价、优化Listing文案等）。
            语气：专业、犀利、数据驱动。`;

            const settings = getActivePromptSettings('keyword_ai_settings', defaultPrompt, '');
            const finalPrompt = (settings.template || defaultPrompt) + `\n\n数据上下文:\n${context}`;

            const text = await unifiedGenerateContent({
                systemInstruction: settings.system,
                contents: finalPrompt,
                geminiModel: 'gemini-3-pro-preview',
            });
            setAiInsight(text || '分析无内容');
        } catch (e: any) {
            setAiInsight(`Error: ${e.message}`);
        } finally {
            setIsGeneratingAi(false);
        }
    };

    const handleScroll = () => {
        if (tableContainerRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = tableContainerRef.current;
            if (scrollTop + clientHeight >= scrollHeight - 200) {
                setVisibleCount(prev => Math.min(prev + 50, processedData.length));
            }
        }
    };

    // Reset visible count on filter change
    useEffect(() => {
        setVisibleCount(50);
        if(tableContainerRef.current) tableContainerRef.current.scrollTop = 0;
    }, [processedData]);

    const SortIcon = ({ colKey }: { colKey: SortKey }) => {
        if (sortConfig.key !== colKey) return <div className="flex flex-col opacity-20"><ArrowUp className="w-2 h-2"/><ArrowDown className="w-2 h-2"/></div>;
        return sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3 text-indigo-600"/> : <ArrowDown className="w-3 h-3 text-indigo-600"/>;
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[110] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in zoom-in duration-200">
            <SettingsPanel 
                isOpen={isSettingsOpen} 
                onClose={() => setIsSettingsOpen(false)} 
                settings={settings} 
                onSave={setSettings} 
                avgImpression={stats.avgImp}
                avgCtr={stats.avgCtr}
                avgCvr={stats.avgCvr}
            />
            
            <PromptSettingsModal 
                isOpen={isAiConfigOpen}
                onClose={() => setIsAiConfigOpen(false)}
                configKey="keyword_ai_settings"
                title="关键词 AI 专家"
                defaultSystemPrompt="你是一个亚马逊顶级SEO专家。"
            />

            <div className="bg-slate-50 w-full h-full max-w-[95vw] max-h-[95vh] rounded-xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
                {/* Header */}
                <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="bg-purple-600 p-2 rounded-lg">
                            <Target className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold tracking-tight">亚马逊关键词深度诊断</h2>
                            <p className="text-xs text-purple-200">关键词分析与行动建议</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-700 rounded-full transition-colors">
                        <X className="w-6 h-6 text-slate-300" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-hidden flex flex-col relative bg-slate-100">
                    {!data || data.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center space-y-8 p-6">
                            <div 
                                onClick={() => fileInputRef.current?.click()}
                                className="w-full max-w-2xl border-2 border-dashed border-slate-300 hover:border-purple-500 hover:bg-purple-50/50 rounded-3xl p-16 flex flex-col items-center cursor-pointer transition-all group bg-white shadow-sm"
                            >
                                <div className="w-20 h-20 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform shadow-inner">
                                    <Upload className="w-10 h-10" />
                                </div>
                                <h3 className="text-2xl font-bold text-slate-800">上传搜词报告 (Search Term Report)</h3>
                                <p className="text-slate-500 mt-3 text-center max-w-md text-sm">
                                    请上传包含以下字段的 Excel/CSV：<br/>
                                    投放, 匹配方式, 用户搜索词, 曝光, 点击, CPC, 广告订单, 销售额, 广告组合
                                </p>
                                <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx,.csv,.xls" onChange={handleFileUpload} />
                            </div>
                            {isUploading && <div className="text-purple-600 font-medium animate-pulse flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin"/> 正在解析关键词数据...</div>}
                            {uploadError && <div className="text-red-500 bg-red-50 px-4 py-2 rounded-lg border border-red-100 flex items-center gap-2"><AlertCircle className="w-4 h-4"/>{uploadError}</div>}
                        </div>
                    ) : (
                        <div className="flex flex-col h-full">
                            {/* Toolbar */}
                            <div className="bg-white border-b border-slate-200 p-4 shadow-sm z-20 flex-shrink-0 space-y-4">
                                <div className="flex flex-wrap items-center justify-between gap-4">
                                    <div className="flex items-center gap-2 flex-1">
                                        <div className="text-sm font-bold text-slate-500 mr-2 flex items-center gap-1"><Filter className="w-4 h-4"/> 筛选:</div>
                                        <DropdownFilter label="词分类" options={filterOptions.cats} selected={selectedCategories} onChange={setSelectedCategories} />
                                        <DropdownFilter label="广告组合" options={filterOptions.portfolios} selected={selectedPortfolios} onChange={setSelectedPortfolios} />
                                        <DropdownFilter label="曝光标签" options={filterOptions.exps} selected={selectedExposures} onChange={setSelectedExposures} />
                                        <DropdownFilter label="效能标签" options={filterOptions.effs} selected={selectedEfficiencies} onChange={setSelectedEfficiencies} />
                                        
                                        <div className="relative ml-2">
                                            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                                            <input 
                                                type="text" 
                                                placeholder="搜索关键词..." 
                                                className="pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm w-48 focus:outline-none focus:border-purple-500 transition-colors"
                                                value={filterText}
                                                onChange={e => setFilterText(e.target.value)}
                                            />
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <button 
                                            onClick={generateExpertAnalysis}
                                            disabled={isGeneratingAi}
                                            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 shadow transition-all active:scale-95 disabled:opacity-50"
                                        >
                                            {isGeneratingAi ? <Loader2 className="w-4 h-4 animate-spin"/> : <Bot className="w-4 h-4"/>}
                                            AI 专家诊断
                                        </button>
                                        <div className="h-6 w-px bg-slate-200"></div>
                                        <button onClick={() => setIsSettingsOpen(true)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-purple-600 transition-colors border border-transparent hover:border-slate-200" title="设置分析标准"><Settings className="w-5 h-5"/></button>
                                        <button onClick={() => setIsAiConfigOpen(true)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-purple-600 transition-colors border border-transparent hover:border-slate-200" title="配置 AI"><FileText className="w-5 h-5"/></button>
                                        <button onClick={() => onDataChange([])} className="p-2 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-500 transition-colors"><Trash2 className="w-5 h-5" /></button>
                                    </div>
                                </div>

                                {/* Horizontal Funnel Summary */}
                                <FunnelHeader stats={viewStats} />
                            </div>

                            <div className="flex flex-1 overflow-hidden">
                                {/* Main Table */}
                                <div className="flex-1 overflow-auto custom-scroll relative" ref={tableContainerRef} onScroll={handleScroll}>
                                    <table className="w-full text-left text-sm border-collapse min-w-[1200px]">
                                        <thead className="bg-white sticky top-0 z-10 shadow-sm text-slate-500 font-semibold text-xs">
                                            <tr>
                                                <th className="p-3 border-b border-slate-100 w-[20%]">搜索词 (Search Term)</th>
                                                
                                                <th className="p-3 border-b border-slate-100 text-right cursor-pointer hover:bg-slate-50" onClick={() => handleSort('impressions')}>
                                                    <div className="flex items-center justify-end gap-1">曝光 (Imp) <SortIcon colKey='impressions'/></div>
                                                </th>
                                                <th className="p-3 border-b border-slate-100 text-right cursor-pointer hover:bg-slate-50" onClick={() => handleSort('clicks')}>
                                                    <div className="flex items-center justify-end gap-1">点击 (Click) <SortIcon colKey='clicks'/></div>
                                                </th>
                                                <th className="p-3 border-b border-slate-100 text-right cursor-pointer hover:bg-slate-50" onClick={() => handleSort('ad_orders')}>
                                                    <div className="flex items-center justify-end gap-1">订单 (Ord) <SortIcon colKey='ad_orders'/></div>
                                                </th>
                                                <th className="p-3 border-b border-slate-100 text-right cursor-pointer hover:bg-slate-50" onClick={() => handleSort('ctr')}>
                                                    <div className="flex items-center justify-end gap-1">CTR <SortIcon colKey='ctr'/></div>
                                                </th>
                                                <th className="p-3 border-b border-slate-100 text-right cursor-pointer hover:bg-slate-50" onClick={() => handleSort('cvr')}>
                                                    <div className="flex items-center justify-end gap-1">CVR <SortIcon colKey='cvr'/></div>
                                                </th>
                                                <th className="p-3 border-b border-slate-100 text-right cursor-pointer hover:bg-slate-50" onClick={() => handleSort('spend')}>
                                                    <div className="flex items-center justify-end gap-1">花费 ($) <SortIcon colKey='spend'/></div>
                                                </th>
                                                <th className="p-3 border-b border-slate-100 text-right cursor-pointer hover:bg-slate-50" onClick={() => handleSort('acos')}>
                                                    <div className="flex items-center justify-end gap-1">ACOS <SortIcon colKey='acos'/></div>
                                                </th>
                                                
                                                <th className="p-3 border-b border-slate-100 text-center">曝光标签</th>
                                                <th className="p-3 border-b border-slate-100 text-center">效能标签</th>
                                                <th className="p-3 border-b border-slate-100">智能建议 (Action)</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 bg-white">
                                            {processedData.slice(0, visibleCount).map((r, i) => (
                                                <tr key={i} className="hover:bg-purple-50/30 transition-colors group">
                                                    <td className="p-3 font-medium text-slate-700 break-words max-w-[250px]" title={r.search_term}>
                                                        <div className="mb-1">{r.search_term}</div>
                                                        <div className="flex gap-1">
                                                            <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded border border-slate-200">{r.match_type}</span>
                                                            <span className="text-[10px] bg-indigo-50 text-indigo-500 px-1.5 py-0.5 rounded border border-indigo-100">{r.semanticCategory}</span>
                                                        </div>
                                                        <div className="text-[9px] text-slate-400 mt-1 truncate" title={r.portfolio_name}>{r.portfolio_name}</div>
                                                    </td>
                                                    <td className="p-3 text-right font-mono">{formatNumber(r.impressions)}</td>
                                                    <td className="p-3 text-right font-mono">{formatNumber(r.clicks)}</td>
                                                    <td className="p-3 text-right font-mono">{formatNumber(r.ad_orders)}</td>
                                                    <td className={`p-3 text-right font-mono ${r.efficiencyLabel.includes('低点击') ? 'text-orange-500' : ''}`}>{formatPercent(r.ctr)}</td>
                                                    <td className={`p-3 text-right font-mono ${r.efficiencyLabel.includes('低转化') ? 'text-red-500' : ''}`}>{formatPercent(r.cvr)}</td>
                                                    <td className="p-3 text-right font-mono text-slate-500">{formatMoneyNoDecimals(r.spend)}</td>
                                                    <td className={`p-3 text-right font-mono font-bold ${r.acos > 0.4 ? 'text-red-500' : 'text-green-600'}`}>{formatPercent(r.acos)}</td>
                                                    
                                                    <td className="p-3 text-center">
                                                        <span className={`px-2 py-1 rounded text-[10px] font-bold border
                                                            ${r.exposureLabel === '高曝光' ? 'bg-purple-50 text-purple-700 border-purple-200' : 
                                                            r.exposureLabel === '低曝光' ? 'bg-slate-50 text-slate-500 border-slate-200' : 'bg-blue-50 text-blue-600 border-blue-200'}
                                                        `}>
                                                            {r.exposureLabel}
                                                        </span>
                                                    </td>
                                                    
                                                    <td className="p-3 text-center">
                                                        <span className={`px-2 py-1 rounded text-[10px] font-bold border whitespace-nowrap
                                                            ${r.efficiencyLabel.includes('高点击·高转化') ? 'bg-green-50 text-green-700 border-green-200' :
                                                            r.efficiencyLabel.includes('低点击·低转化') ? 'bg-red-50 text-red-600 border-red-200' :
                                                            'bg-yellow-50 text-yellow-700 border-yellow-200'}
                                                        `}>
                                                            {r.efficiencyLabel}
                                                        </span>
                                                    </td>

                                                    <td className="p-3">
                                                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                                                            <Zap className={`w-3.5 h-3.5 ${r.efficiencyLabel.includes('高转化') ? 'text-green-500' : 'text-orange-500'}`} />
                                                            {r.actionSuggestion}
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                            {processedData.length === 0 && (
                                                <tr>
                                                    <td colSpan={11} className="p-12 text-center text-slate-400 italic">
                                                        没有找到符合条件的关键词
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                    {visibleCount < processedData.length && (
                                        <div className="py-4 text-center text-xs text-slate-400 animate-pulse">
                                            向下滚动加载更多 ({visibleCount} / {processedData.length})...
                                        </div>
                                    )}
                                </div>

                                {/* Right: AI Analysis Panel (if generated) */}
                                {aiInsight && (
                                    <div className="w-96 border-l border-slate-200 bg-white flex flex-col flex-shrink-0 animate-in slide-in-from-right-10 duration-300">
                                        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-indigo-50/50">
                                            <h3 className="font-bold text-indigo-700 flex items-center gap-2">
                                                <Sparkles className="w-4 h-4"/> 专家诊断报告
                                            </h3>
                                            <button onClick={() => setAiInsight('')} className="text-slate-400 hover:text-red-500"><X className="w-4 h-4"/></button>
                                        </div>
                                        <div className="p-4 overflow-y-auto custom-scroll flex-1">
                                            <div className="prose prose-sm max-w-none text-slate-700 leading-relaxed text-xs">
                                                <div className="whitespace-pre-wrap">{aiInsight}</div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

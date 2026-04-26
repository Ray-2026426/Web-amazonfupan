
import React, { useState, useMemo, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { X, Upload, AlertCircle, AlertTriangle, Layers, Activity, Sparkles, Loader2, FileText, Grid, Calendar, Filter, PieChart, TrendingUp, Search, ChevronDown, Check, Square, CheckSquare, BarChart2, Bot, Settings, Plus, Trash2, Save, RotateCcw, Table, Download } from 'lucide-react';
import { parseRefundData } from '../dataLoader';
import { RefundRow, DataRow, FilterState } from '../types';
import { formatNumber, formatPercent, formatMoney, formatMoneyNoDecimals } from '../utils';
import { PromptSettingsModal, getActivePromptSettings } from './PromptSettingsModal';
import { hasConfiguredAiApi, unifiedGenerateContent, AI_API_SETUP_HINT } from './aiUnifiedGenerate';

interface RefundAnalysisModalProps {
    isOpen: boolean;
    onClose: () => void;
    refundData: RefundRow[];
    rawPerformance?: DataRow[];
    onDataChange: (data: RefundRow[]) => void;
    initialFilters?: FilterState;
}

const DEFAULT_GRANULAR_ISSUES: Record<string, string[]> = {
    "1. 尺寸：偏小/紧": ["too small", "small", "tiny", "tight", "short", "child size", "baby size", "fit", "run small", "smaller"],
    "2. 尺寸：偏大/松": ["too big", "big", "large", "huge", "loose", "baggy", "long", "run big", "oversized", "larger"],
    "3. 质量：做工差/破损": ["quality", "poor", "bad", "cheap", "broke", "broken", "torn", "ripped", "hole", "seam", "stitch", "defect", "damage", "apart", "flimsy"],
    "4. 功能：不好用/失效": ["work", "stop", "fail", "useless", "function", "hard to use", "difficult", "battery", "charge", "power", "dead"],
    "5. 描述：货不对板": ["description", "picture", "photo", "image", "color", "wrong", "different", "misleading", "false", "lie", "looks different"],
    "6. 舒适度：不舒服/硬": ["comfortable", "uncomfortable", "hard", "stiff", "rough", "scratchy", "itchy", "soft", "pain", "hurt", "rub"],
    "7. 气味：异味/化学味": ["smell", "odor", "scent", "stink", "chemical", "toxic", "bad smell", "weird smell"],
    "8. 缺件：配件缺失": ["missing", "miss", "lost", "part", "piece", "accessory", "screw", "incomplete", "received only"],
    "9. 包装：包装破损/旧货": ["package", "box", "open", "used", "old", "dirty", "stain", "hair", "repackaged", "seal broken"],
    "10. 物流：延迟/没收到": ["arrive", "receive", "late", "delay", "lost", "shipping", "delivery", "never", "tracking"],
};

const identifyIssueCluster = (comment: string, reason: string, rules: Record<string, string[]>) => {
    const text = `${comment || ''} ${reason || ''}`.toLowerCase();
    for (const [cluster, keywords] of Object.entries(rules)) {
        if (keywords.some(k => text.includes(k.toLowerCase()))) return cluster;
    }
    return '其他/未分类';
};

interface MultiSelectProps {
    label: string;
    options: string[];
    selected: string[];
    onChange: (selected: string[]) => void;
}

const MultiSelectDropdown: React.FC<MultiSelectProps> = ({ label, options, selected, onChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);

    const filteredOptions = useMemo(() => {
        if (!searchTerm) return options;
        return options.filter(o => o.toLowerCase().includes(searchTerm.toLowerCase()));
    }, [options, searchTerm]);

    const handleSelect = (val: string) => {
        if (selected.includes(val)) {
            onChange(selected.filter(s => s !== val));
        } else {
            onChange([...selected, val]);
        }
    };

    const handleSelectAll = () => {
        const targets = searchTerm ? filteredOptions : options;
        const allSelected = targets.every(t => selected.includes(t));
        if (allSelected) {
            onChange(selected.filter(s => !targets.includes(s)));
        } else {
            onChange(Array.from(new Set([...selected, ...targets])));
        }
    };

    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        if (isOpen) document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [isOpen]);

    return (
        <div className="relative min-w-[140px]" ref={containerRef}>
            <button 
                onClick={() => setIsOpen(!isOpen)}
                className={`w-full flex items-center justify-between bg-white border rounded-lg px-3 py-2 text-sm transition-all
                    ${isOpen ? 'border-orange-500 ring-1 ring-orange-500' : 'border-slate-200 hover:border-slate-300'}
                `}
            >
                <span className="truncate max-w-[120px] text-slate-700">
                    {selected.length === 0 ? label : `${label} (${selected.length})`}
                </span>
                <ChevronDown className="w-4 h-4 text-slate-400 ml-2" />
            </button>

            {isOpen && (
                <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-slate-200 rounded-lg shadow-xl z-50 flex flex-col max-h-80">
                    <div className="p-2 border-b border-slate-100 flex-shrink-0 bg-slate-50 rounded-t-lg">
                        <div className="relative mb-2">
                            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                            <input 
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full bg-white border border-slate-200 rounded px-8 py-1.5 text-xs focus:border-orange-500 focus:outline-none"
                                placeholder="搜索..."
                                autoFocus
                            />
                        </div>
                        <div className="flex justify-between px-1">
                            <button onClick={handleSelectAll} className="text-[10px] text-orange-600 hover:underline">
                                {searchTerm ? '全选结果' : '全选'}
                            </button>
                            <button onClick={() => onChange([])} className="text-[10px] text-slate-400 hover:text-red-500 hover:underline">
                                清空
                            </button>
                        </div>
                    </div>
                    <div className="overflow-y-auto custom-scroll p-1 flex-1">
                        {filteredOptions.length > 0 ? filteredOptions.map(opt => {
                            const isSelected = selected.includes(opt);
                            return (
                                <div 
                                    key={opt}
                                    onClick={() => handleSelect(opt)}
                                    className="flex items-center gap-2 px-2 py-1.5 hover:bg-orange-50 cursor-pointer rounded text-xs text-slate-700"
                                >
                                    {isSelected ? <CheckSquare className="w-4 h-4 text-orange-600" /> : <Square className="w-4 h-4 text-slate-300" />}
                                    <span className="truncate" title={opt}>{opt}</span>
                                </div>
                            );
                        }) : (
                            <div className="p-4 text-center text-xs text-slate-400">无结果</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

const ClusteringSettingsModal = ({ isOpen, onClose, onSave, initialRules }: any) => {
    const [rules, setRules] = useState(initialRules);
    const [selectedCategory, setSelectedCategory] = useState<string>(Object.keys(initialRules)[0] || '');
    const [newCategoryName, setNewCategoryName] = useState('');
    const [newKeyword, setNewKeyword] = useState('');

    useEffect(() => {
        if (isOpen) {
            setRules(initialRules);
            setSelectedCategory(Object.keys(initialRules)[0] || '');
        }
    }, [isOpen, initialRules]);

    const handleAddCategory = () => {
        if (newCategoryName && !rules[newCategoryName]) {
            setRules((prev: any) => ({ [newCategoryName]: [], ...prev }));
            setSelectedCategory(newCategoryName);
            setNewCategoryName('');
        }
    };
    const handleDeleteCategory = (cat: string) => {
        if (window.confirm(`确定删除分类 "${cat}" 吗?`)) {
            const newRules = { ...rules };
            delete newRules[cat];
            setRules(newRules);
            if (selectedCategory === cat) setSelectedCategory(Object.keys(newRules)[0] || '');
        }
    };
    const handleAddKeyword = () => {
        if (newKeyword && selectedCategory) {
            setRules((prev: any) => ({ ...prev, [selectedCategory]: [...prev[selectedCategory], newKeyword] }));
            setNewKeyword('');
        }
    };
    const handleDeleteKeyword = (cat: string, keyword: string) => {
        setRules((prev: any) => ({ ...prev, [cat]: prev[cat].filter((k: string) => k !== keyword) }));
    };
    const handleReset = () => {
        if(window.confirm("确定恢复到系统默认规则吗？")) {
            setRules(DEFAULT_GRANULAR_ISSUES);
            setSelectedCategory(Object.keys(DEFAULT_GRANULAR_ISSUES)[0]);
        }
    }

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[200] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-4xl h-[80vh] rounded-xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
                <div className="bg-slate-800 px-6 py-4 flex items-center justify-between text-white flex-shrink-0">
                    <h3 className="font-bold flex items-center gap-2"><Settings className="w-5 h-5" /> 标签聚类配置</h3>
                    <button onClick={onClose} className="hover:bg-white/20 p-1 rounded-full transition-colors"><X className="w-5 h-5" /></button>
                </div>
                <div className="flex-1 flex overflow-hidden">
                    <div className="w-1/3 border-r border-slate-200 bg-slate-50 flex flex-col">
                        <div className="p-3 border-b border-slate-200 bg-white">
                            <div className="flex gap-2">
                                <input className="flex-1 border rounded px-2 py-1 text-xs outline-none focus:border-orange-500" placeholder="新分类名称..." value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddCategory()} />
                                <button onClick={handleAddCategory} className="bg-orange-600 text-white p-1 rounded hover:bg-orange-700"><Plus className="w-4 h-4" /></button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scroll">
                            {Object.keys(rules).map(cat => (
                                <div key={cat} onClick={() => setSelectedCategory(cat)} className={`px-4 py-3 cursor-pointer border-b border-slate-100 flex justify-between items-center group ${selectedCategory === cat ? 'bg-white border-l-4 border-l-orange-600 shadow-sm' : 'hover:bg-slate-100 text-slate-600'}`}>
                                    <span className="text-sm font-medium truncate">{cat}</span>
                                    <button onClick={(e) => { e.stopPropagation(); handleDeleteCategory(cat); }} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-opacity"><Trash2 className="w-3.5 h-3.5" /></button>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="flex-1 flex flex-col bg-white">
                        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50/50">
                            <h4 className="font-bold text-slate-700">{selectedCategory || '请选择分类'}</h4>
                            <span className="text-xs text-slate-400">包含以下任意关键词即命中此分类</span>
                        </div>
                        <div className="p-4 flex-1 overflow-y-auto custom-scroll">
                            {selectedCategory && (
                                <div className="flex flex-wrap gap-2">
                                    {rules[selectedCategory]?.map((kw: string) => (
                                        <div key={kw} className="bg-orange-50 text-orange-700 px-3 py-1.5 rounded-full text-xs font-medium border border-orange-100 flex items-center gap-2">
                                            {kw}
                                            <button onClick={() => handleDeleteKeyword(selectedCategory, kw)} className="hover:text-red-500"><X className="w-3 h-3" /></button>
                                        </div>
                                    ))}
                                    <div className="flex items-center gap-2">
                                        <input className="border-b border-slate-300 px-2 py-1 text-xs outline-none focus:border-orange-500 min-w-[100px]" placeholder="添加关键词 (Enter)..." value={newKeyword} onChange={e => setNewKeyword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddKeyword()} autoFocus />
                                        <button onClick={handleAddKeyword} className="text-orange-600 hover:bg-orange-50 rounded-full p-1"><Plus className="w-4 h-4" /></button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-between">
                    <button onClick={handleReset} className="flex items-center gap-2 text-slate-500 hover:text-red-600 text-xs font-bold px-3"><RotateCcw className="w-3.5 h-3.5" /> 恢复默认</button>
                    <div className="flex gap-2">
                        <button onClick={onClose} className="px-4 py-2 text-slate-600 text-sm hover:bg-slate-200 rounded">取消</button>
                        <button onClick={() => { onSave(rules); onClose(); }} className="px-6 py-2 bg-orange-600 text-white text-sm font-bold rounded shadow hover:bg-orange-700 flex items-center gap-2"><Save className="w-4 h-4" /> 保存配置</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const ExpertReportOverlay = ({ isOpen, onClose, onGenerate, report, isGenerating, onReset }: any) => {
    if (!isOpen) return null;
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [copied, setCopied] = useState(false);

    const handleCopyMarkdown = async () => {
        if (!report) return;
        try {
            await navigator.clipboard.writeText(report);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch (e) {
            alert('复制失败，请重试');
        }
    };

    return (
        <div className="fixed inset-0 z-[150] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in zoom-in duration-200">
            <div className="bg-white w-full max-w-2xl max-h-[80vh] rounded-xl shadow-2xl flex flex-col overflow-hidden">
                <PromptSettingsModal 
                    isOpen={isSettingsOpen}
                    onClose={() => setIsSettingsOpen(false)}
                    configKey="refund_analysis_settings"
                    title="退货分析配置"
                    defaultSystemPrompt="你是一个亚马逊FBA退货分析专家。"
                    defaultTemplate={`请根据以下数据生成退货诊断报告：\n{{DATA}}\n\n请严格输出 **Markdown**，并按以下结构返回：\n\n# 退货诊断报告\n\n## 1. 核心痛点总结\n- 用 3-5 条要点总结最核心问题。\n\n## 2. 重点关注产品\n请输出表格：\n| 产品 | 主要问题 | 影响程度 | 说明 |\n|---|---|---|---|\n\n## 3. 行动建议\n请输出表格：\n| 优先级 | 问题 | 建议动作 | 预期收益 |\n|---|---|---|---|\n\n要求：\n- 不要输出 JSON\n- 必须包含以上两个 Markdown 表格\n- 语言专业、直接、可执行。`}
                />
                <div className="bg-orange-600 px-6 py-4 flex items-center justify-between text-white flex-shrink-0">
                    <h3 className="font-bold flex items-center gap-2">
                        <Sparkles className="w-5 h-5" />
                        AI 专家诊断报告
                    </h3>
                    <div className="flex items-center gap-2">
                        {report && (
                            <button
                                onClick={handleCopyMarkdown}
                                className="px-2 py-1 bg-orange-700/50 hover:bg-orange-700 rounded text-xs flex items-center gap-1 transition-colors"
                                title="复制 Markdown"
                            >
                                {copied ? <Check className="w-3 h-3" /> : <Download className="w-3 h-3" />}
                                {copied ? '已复制' : '复制'}
                            </button>
                        )}
                        {report && (
                            <button onClick={onReset} className="px-2 py-1 bg-orange-700/50 hover:bg-orange-700 rounded text-xs flex items-center gap-1 transition-colors mr-2">
                                <RotateCcw className="w-3 h-3" /> 重新分析
                            </button>
                        )}
                        <button onClick={() => setIsSettingsOpen(true)} className="p-1.5 hover:bg-white/20 rounded-full transition-colors" title="配置 Prompt">
                            <Settings className="w-4 h-4" />
                        </button>
                        <button onClick={onClose} className="hover:bg-white/20 p-1 rounded-full transition-colors"><X className="w-5 h-5" /></button>
                    </div>
                </div>
                <div className="p-6 overflow-y-auto custom-scroll flex-1">
                    {!report && !isGenerating ? (
                        <div className="flex flex-col items-center justify-center h-full text-center space-y-4 py-8">
                            <div className="bg-orange-50 p-4 rounded-full"><Bot className="w-12 h-12 text-orange-500" /></div>
                            <div>
                                <h4 className="font-bold text-slate-800">准备就绪</h4>
                                <p className="text-sm text-slate-500 mt-1 max-w-xs mx-auto">AI 将分析当前的退货数据（原因、产品、评论），并给出改进建议。</p>
                            </div>
                            <button onClick={onGenerate} className="bg-orange-600 hover:bg-orange-700 text-white px-6 py-2 rounded-full font-bold shadow-lg transform active:scale-95 transition-all flex items-center gap-2">
                                <Sparkles className="w-4 h-4" /> 生成诊断报告
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {isGenerating ? <div className="flex items-center gap-3 text-orange-600 font-medium p-4 bg-orange-50 rounded-lg animate-pulse"><Loader2 className="w-5 h-5 animate-spin" /> 正在深入分析数据模式...</div> : null}
                            {report && <div className="prose prose-sm max-w-none text-slate-700 leading-relaxed bg-slate-50 p-4 rounded-lg border border-slate-100"><div className="whitespace-pre-wrap">{report}</div></div>}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const HeatmapTable = ({ rows, cols, data }: { rows: string[], cols: string[], data: Record<string, Record<string, number>> }) => (
    <div className="overflow-auto custom-scroll h-full">
        <table className="w-full text-xs text-left border-collapse">
            <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                <tr><th className="p-2 border border-slate-200 min-w-[100px] text-slate-500 font-normal bg-slate-50">品名 \ 痛点</th>{cols.map(c => <th key={c} className="p-2 border border-slate-200 text-slate-700 font-semibold min-w-[60px] truncate max-w-[80px] bg-slate-50" title={c}>{c.split('(')[0]}</th>)}</tr>
            </thead>
            <tbody>
                {rows.map(r => (
                    <tr key={r} className="hover:bg-slate-50/50">
                        <td className="p-2 border border-slate-200 font-medium text-slate-700 truncate max-w-[120px] bg-white sticky left-0 z-10" title={r}>{r}</td>
                        {cols.map(c => {
                            const val = data[r]?.[c] || 0;
                            const rowMax = Math.max(...cols.map(col => data[r]?.[col] || 0)) || 1;
                            const opacity = val > 0 ? (val / rowMax) * 0.8 + 0.1 : 0;
                            return ( <td key={c} className="p-1 border border-slate-200 text-center relative">{val > 0 ? ( <div className="w-full h-8 rounded bg-red-500 flex items-center justify-center text-white font-bold shadow-sm" style={{ backgroundColor: `rgba(239, 68, 68, ${opacity})`, color: opacity > 0.5 ? 'white' : '#7f1d1d' }}><span className="z-10 relative">{val}</span></div> ) : ( <span className="text-slate-200">-</span> )}</td> );
                        })}
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

const RobustTrendChart = ({ data, colors = ['#f97316', '#ef4444', '#f59e0b', '#10b981', '#6366f1', '#ec4899'], focusKey }: { data: Record<string, Record<string, number>>, colors?: string[], focusKey?: string | null }) => {
    const [hoverIndex, setHoverIndex] = useState<number | null>(null);
    const seriesKeys = Object.keys(data);
    if (seriesKeys.length === 0) return <div className="flex items-center justify-center h-full text-xs text-slate-400">无数据</div>;
    
    // Collect all unique months across all series
    const allMonthsSet = new Set<string>();
    Object.values(data).forEach(series => { Object.keys(series).forEach(m => { if (/^\d{4}-\d{2}$/.test(m)) allMonthsSet.add(m); }); });
    let sortedMonths = Array.from(allMonthsSet).sort();
    
    // Fill gaps
    if (sortedMonths.length > 1) {
        const start = new Date(sortedMonths[0] + "-01");
        const end = new Date(sortedMonths[sortedMonths.length - 1] + "-01");
        const filled = [];
        let curr = new Date(start);
        while (curr <= end) {
            const mStr = `${curr.getFullYear()}-${String(curr.getMonth() + 1).padStart(2, '0')}`;
            filled.push(mStr);
            curr.setMonth(curr.getMonth() + 1);
        }
        sortedMonths = filled;
    }
    
    if (sortedMonths.length === 0) return <div className="flex items-center justify-center h-full text-xs text-slate-400">无有效时间数据</div>;
    
    let globalMax = 0;
    const seriesPoints: Record<string, number[]> = {};
    seriesKeys.forEach(key => {
        seriesPoints[key] = sortedMonths.map(m => {
            const val = data[key][m] || 0;
            if (val > globalMax) globalMax = val;
            return val;
        });
    });
    
    const yMax = globalMax > 0 ? globalMax * 1.1 : 5; 
    const W = 1000; const H = 300; const PADDING_Y = 20; const GRAPH_H = H - PADDING_Y * 2;
    const getX = (idx: number) => (idx / (sortedMonths.length - 1 || 1)) * W;
    const getY = (val: number) => H - PADDING_Y - ((val / yMax) * GRAPH_H);
    
    const paths = seriesKeys.map((key, i) => {
        const points = seriesPoints[key].map((val, idx) => `${getX(idx).toFixed(1)},${getY(val).toFixed(1)}`);
        const d = `M ${points.join(' L ')}`;
        const areaD = `${d} L ${W},${H} L 0,${H} Z`;
        return { key, d, areaD, color: colors[i % colors.length], points: seriesPoints[key] };
    });

    return (
        <div className="w-full h-full flex flex-col">
            <div className="flex-1 relative w-full overflow-hidden select-none" onMouseLeave={() => setHoverIndex(null)}>
                <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
                    <line x1="0" y1={getY(0)} x2={W} y2={getY(0)} stroke="#f1f5f9" strokeWidth="2" />
                    <line x1="0" y1={getY(yMax/2)} x2={W} y2={getY(yMax/2)} stroke="#f1f5f9" strokeWidth="2" strokeDasharray="5,5"/>
                    <line x1="0" y1={getY(yMax)} x2={W} y2={getY(yMax)} stroke="#f1f5f9" strokeWidth="2" />
                    {paths.map((p, idx) => {
                        const isFocused = !focusKey || focusKey === p.key;
                        const opacity = isFocused ? 1 : 0.1;
                        return (
                            <g key={p.key} style={{ opacity, transition: 'opacity 0.3s' }}>
                                <path d={p.areaD} fill={p.color} fillOpacity="0.05" stroke="none" />
                                <path d={p.d} fill="none" stroke={p.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="drop-shadow-sm" />
                                {hoverIndex !== null && isFocused && ( <circle cx={getX(hoverIndex)} cy={getY(p.points[hoverIndex])} r="5" fill="white" stroke={p.color} strokeWidth="3" /> )}
                            </g>
                        )
                    })}
                    <g className="opacity-0 hover:opacity-100">
                        {sortedMonths.map((_, idx) => ( <rect key={idx} x={getX(idx) - (W / sortedMonths.length / 2)} y="0" width={W / sortedMonths.length} height={H} fill="transparent" onMouseEnter={() => setHoverIndex(idx)} /> ))}
                    </g>
                    {hoverIndex !== null && ( <line x1={getX(hoverIndex)} y1="0" x2={getX(hoverIndex)} y2={H} stroke="#94a3b8" strokeWidth="1" strokeDasharray="4,4" pointerEvents="none" /> )}
                </svg>
                {hoverIndex !== null && (
                    <div className="absolute bg-white/95 backdrop-blur border border-slate-200 shadow-xl rounded-lg p-3 text-xs z-50 pointer-events-none transition-all" style={{ left: `${(hoverIndex / (sortedMonths.length - 1 || 1)) * 100}%`, top: '10%', transform: 'translateX(-50%)' }}>
                        <div className="font-bold text-slate-700 mb-2 border-b border-slate-100 pb-1">{sortedMonths[hoverIndex]}</div>
                        <div className="flex flex-col gap-1">
                            {paths.filter(p => !focusKey || focusKey === p.key).map(p => ( <div key={p.key} className="flex items-center gap-2 justify-between min-w-[120px]"><div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{backgroundColor: p.color}}></span><span className="text-slate-600 truncate max-w-[80px]">{p.key}</span></div><span className="font-mono font-bold text-slate-800">{p.points[hoverIndex]}</span></div> ))}
                        </div>
                    </div>
                )}
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 mt-2 px-1 font-mono select-none h-4 flex-shrink-0">
                <span>{sortedMonths[0]}</span>{sortedMonths.length > 2 && <span>{sortedMonths[Math.floor(sortedMonths.length/2)]}</span>}{sortedMonths.length > 1 && <span>{sortedMonths[sortedMonths.length-1]}</span>}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-2 mt-2 max-h-16 overflow-y-auto custom-scroll flex-shrink-0 px-1">
                {seriesKeys.map((k, i) => {
                    const isFocused = !focusKey || focusKey === k;
                    return ( 
                        <div key={k} className={`flex items-center gap-1.5 text-[10px] cursor-default px-2 py-1 rounded border transition-all ${isFocused ? 'bg-slate-50 border-slate-200' : 'opacity-30 border-transparent'}`}>
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colors[i % colors.length] }}></span>
                            <span className="text-slate-600 font-medium truncate max-w-[120px]" title={k}>{k}</span>
                        </div> 
                    )
                })}
            </div>
        </div>
    );
};

const PainPointBarChart = ({ data, colorClass, onBarClick, activeLabel }: { data: { label: string, value: number, percent: number }[], colorClass: string, onBarClick?: (label: string) => void, activeLabel?: string | null }) => (
    <div className="flex flex-col gap-3 h-full overflow-y-auto custom-scroll pr-2 pt-2">
        {data.map((d, i) => (
            <div 
                key={i} 
                className={`w-full group ${onBarClick ? 'cursor-pointer' : ''}`}
                onClick={() => onBarClick && onBarClick(d.label)}
            >
                <div className="flex justify-between text-xs mb-1.5">
                    <span className={`font-medium truncate max-w-[70%] transition-colors ${activeLabel === d.label ? 'text-blue-600 font-bold' : 'text-slate-700'}`} title={d.label}>
                        {d.label}
                    </span>
                    <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded transition-colors ${activeLabel === d.label ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                        {d.value} ({ (d.percent * 100).toFixed(1) }%)
                    </span>
                </div>
                <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div 
                        className={`h-full rounded-full transition-all duration-500 ${colorClass}`} 
                        style={{ width: `${Math.max(d.percent * 100, 2)}%`, opacity: activeLabel && activeLabel !== d.label ? 0.3 : 1 }}
                    />
                </div>
            </div>
        ))}
    </div>
);

const DonutChart = ({ data, title }: { data: { label: string, value: number, color: string }[], title: string }) => {
    const total = data.reduce((a, b) => a + b.value, 0);
    let cumulative = 0;
    
    return (
        <div className="flex items-center h-full">
            <div className="relative w-32 h-32 flex-shrink-0">
               <svg viewBox="0 0 100 100" className="transform -rotate-90 w-full h-full">
                 {data.map((d, i) => {
                    const val = d.value || 0;
                    if (val === 0) return null;
                    const start = cumulative / (total || 1);
                    const end = (cumulative + val) / (total || 1);
                    cumulative += val;
                    
                    const x1 = 50 + 40 * Math.cos(2 * Math.PI * start);
                    const y1 = 50 + 40 * Math.sin(2 * Math.PI * start);
                    const x2 = 50 + 40 * Math.cos(2 * Math.PI * end);
                    const y2 = 50 + 40 * Math.sin(2 * Math.PI * end);
                    
                    const largeArc = (end - start) > 0.5 ? 1 : 0;
                    
                    // If full circle
                    if (Math.abs(end - start) >= 0.999) {
                        return <circle key={i} cx="50" cy="50" r="40" fill="none" stroke={d.color} strokeWidth="20" />
                    }

                    return (
                        <path key={i} d={`M 50 50 L ${x1} ${y1} A 40 40 0 ${largeArc} 1 ${x2} ${y2} Z`} fill={d.color} />
                    );
                 })}
                 <circle cx="50" cy="50" r="25" fill="white" />
               </svg>
            </div>
            <div className="ml-4 flex-1 overflow-y-auto max-h-full custom-scroll text-xs">
                {data.map((d,i) => (
                    <div key={i} className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full" style={{backgroundColor: d.color}}></span>
                            <span className="text-slate-600 truncate max-w-[80px]" title={d.label}>{d.label}</span>
                        </div>
                        <span className="font-mono text-slate-500">{total > 0 ? ((d.value/total)*100).toFixed(1) : 0}%</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

const HorizontalBarChart = ({ data, colorClass }: { data: { label: string, value: number, percent: number }[], colorClass: string }) => (
    <div className="flex flex-col gap-3 h-full overflow-y-auto custom-scroll pr-2 pt-2">
        {data.map((d, i) => (
            <div key={i} className="w-full">
                <div className="flex justify-between text-xs mb-1.5">
                    <span className="font-medium text-slate-700 truncate max-w-[70%]" title={d.label}>{d.label}</span>
                    <span className="font-mono text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">{d.value}</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${Math.max(d.percent * 100, 2)}%` }} />
                </div>
            </div>
        ))}
    </div>
);

// --- New: Refund Trend Table (UPDATED) ---
const RefundTrendTable = ({ data }: { data: { month: string, sales: number, refunds: number, refundCost: number }[] }) => {
    if (data.length === 0) return <div className="p-4 text-center text-slate-400 text-xs">无数据</div>;

    const sorted = [...data].sort((a, b) => a.month.localeCompare(b.month));

    return (
        <div className="w-full overflow-x-auto custom-scroll">
            <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-slate-100 text-slate-600">
                    <tr>
                        <th className="p-3 border border-slate-200 font-bold whitespace-nowrap sticky left-0 bg-slate-100 z-10">月份</th>
                        {sorted.map(row => <th key={row.month} className="p-3 border border-slate-200 font-mono text-center min-w-[80px]">{row.month}</th>)}
                        <th className="p-3 border border-slate-200 font-bold text-center bg-slate-100 sticky right-0 z-10">合计</th>
                    </tr>
                </thead>
                <tbody>
                    {/* Sales Row */}
                    <tr>
                        <td className="p-3 border border-slate-200 font-bold text-slate-700 sticky left-0 bg-white z-10">业绩销量</td>
                        {sorted.map(row => <td key={row.month} className="p-3 border border-slate-200 text-right font-mono">{formatNumber(row.sales)}</td>)}
                        <td className="p-3 border border-slate-200 text-right font-bold font-mono bg-slate-50 sticky right-0 z-10">
                            {formatNumber(sorted.reduce((a, b) => a + b.sales, 0))}
                        </td>
                    </tr>
                    {/* Refund Qty Row */}
                    <tr>
                        <td className="p-3 border border-slate-200 font-bold text-slate-700 sticky left-0 bg-white z-10">退货数量</td>
                        {sorted.map(row => <td key={row.month} className="p-3 border border-slate-200 text-right font-mono text-orange-600">{formatNumber(row.refunds)}</td>)}
                        <td className="p-3 border border-slate-200 text-right font-bold font-mono text-orange-600 bg-slate-50 sticky right-0 z-10">
                            {formatNumber(sorted.reduce((a, b) => a + b.refunds, 0))}
                        </td>
                    </tr>
                    {/* Return Rate Row (Qty%) */}
                    <tr>
                        <td className="p-3 border border-slate-200 font-bold text-slate-700 sticky left-0 bg-white z-10">退货率 (Qty%)</td>
                        {sorted.map(row => {
                            const rate = row.sales ? row.refunds / row.sales : 0;
                            return (
                                <td key={row.month} className={`p-3 border border-slate-200 text-right font-mono font-bold ${rate > 0.05 ? 'text-red-500 bg-red-50' : 'text-green-600'}`}>
                                    {formatPercent(rate)}
                                </td>
                            );
                        })}
                        <td className="p-3 border border-slate-200 text-right font-bold font-mono bg-slate-50 sticky right-0 z-10">
                            {formatPercent(sorted.reduce((a, b) => a + b.refunds, 0) / (sorted.reduce((a, b) => a + b.sales, 0) || 1))}
                        </td>
                    </tr>
                     {/* Refund Cost Row */}
                     <tr>
                        <td className="p-3 border border-slate-200 font-bold text-slate-700 sticky left-0 bg-white z-10">退款金额</td>
                        {sorted.map(row => <td key={row.month} className="p-3 border border-slate-200 text-right font-mono text-slate-500">{formatMoneyNoDecimals(row.refundCost)}</td>)}
                        <td className="p-3 border border-slate-200 text-right font-bold font-mono text-slate-600 bg-slate-50 sticky right-0 z-10">
                            {formatMoneyNoDecimals(sorted.reduce((a, b) => a + b.refundCost, 0))}
                        </td>
                    </tr>
                    {/* NEW: Refund Amount % Row */}
                    <tr>
                        <td className="p-3 border border-slate-200 font-bold text-slate-700 sticky left-0 bg-white z-10">退款占比 (Amount%)</td>
                        {sorted.map(row => {
                            const salesAmt = (row as any).salesAmount || 0;
                            const pct = salesAmt > 0 ? row.refundCost / salesAmt : 0;
                            return (
                                <td key={row.month} className={`p-3 border border-slate-200 text-right font-mono text-slate-600 ${pct > 0.05 ? 'text-red-500 bg-red-50' : ''}`}>
                                    {salesAmt > 0 ? formatPercent(pct) : '-'}
                                </td>
                            );
                        })}
                         <td className="p-3 border border-slate-200 text-right font-bold font-mono bg-slate-50 sticky right-0 z-10">
                            {(() => {
                                const totalRefundCost = sorted.reduce((a,b)=>a+b.refundCost,0);
                                const totalSalesAmt = sorted.reduce((a,b)=>(a + ((b as any).salesAmount||0)), 0);
                                return totalSalesAmt > 0 ? formatPercent(totalRefundCost/totalSalesAmt) : '-';
                            })()}
                         </td>
                    </tr>
                </tbody>
            </table>
        </div>
    );
};

const RefundOrdersTable = ({ orders }: { orders: any[] }) => {
    const [visible, setVisible] = useState(50);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setVisible(50);
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }, [orders]);

    const handleScroll = () => {
        if (scrollRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
            if (scrollTop + clientHeight >= scrollHeight - 200) {
                setVisible(prev => Math.min(prev + 50, orders.length));
            }
        }
    };

    if (orders.length === 0) return null;

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col h-[500px]">
            <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
                <Search className="w-4 h-4 text-orange-500" />
                退货订单明细 (Order Details)
            </h3>
            <div className="flex-1 overflow-auto custom-scroll" ref={scrollRef} onScroll={handleScroll}>
                <table className="w-full text-xs text-left border-collapse">
                    <thead className="bg-slate-50 sticky top-0 z-10">
                        <tr>
                            <th className="p-3 border-b text-slate-500">退货时间</th>
                            <th className="p-3 border-b text-slate-500">订单号</th>
                            <th className="p-3 border-b text-slate-500">商品 (SKU/ASIN)</th>
                            <th className="p-3 border-b text-slate-500">原因</th>
                            <th className="p-3 border-b text-slate-500 w-1/3">买家备注 (Comments)</th>
                            <th className="p-3 border-b text-slate-500 text-right">数量</th>
                        </tr>
                    </thead>
                    <tbody>
                        {orders.slice(0, visible).map((row, i) => (
                            <tr key={i} className="hover:bg-slate-50 border-b border-slate-100 last:border-0">
                                <td className="p-3 font-mono text-slate-600">{row.date}</td>
                                <td className="p-3 font-mono text-slate-600 select-all">{row.order_id}</td>
                                <td className="p-3">
                                    <div className="font-medium text-slate-700 truncate max-w-[200px]" title={row.product_name}>{row.product_name}</div>
                                    <div className="text-[10px] text-slate-400 font-mono">{row.sku || row.asin}</div>
                                </td>
                                <td className="p-3 text-slate-600">{row.reason}</td>
                                <td className="p-3">
                                    {row.buyer_comment ? (
                                        <div className="text-orange-700 bg-orange-50 p-2 rounded border border-orange-100">
                                            {row.buyer_comment}
                                        </div>
                                    ) : <span className="text-slate-300">-</span>}
                                </td>
                                <td className="p-3 text-right font-mono">{row.quantity}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {visible < orders.length && (
                    <div className="py-4 text-center text-xs text-slate-400 animate-pulse">
                        加载更多数据... ({visible}/{orders.length})
                    </div>
                )}
            </div>
        </div>
    );
};

export const RefundAnalysisModal: React.FC<RefundAnalysisModalProps> = ({ isOpen, onClose, refundData, rawPerformance, onDataChange, initialFilters }) => {
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState('');
    const [aiInsight, setAiInsight] = useState<string>('');
    const [isGeneratingAi, setIsGeneratingAi] = useState(false);
    const [showReportOverlay, setShowReportOverlay] = useState(false);
    const [isClusteringSettingsOpen, setIsClusteringSettingsOpen] = useState(false);
    const [clusteringRules, setClusteringRules] = useState(DEFAULT_GRANULAR_ISSUES);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
    const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
    const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
    const [selectedParentAsins, setSelectedParentAsins] = useState<string[]>([]);
    const [dateRange, setDateRange] = useState<{ start: string, end: string }>({ start: '', end: '' });
    const [isExporting, setIsExporting] = useState(false);
    const reportRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const savedRules = localStorage.getItem('refund_clustering_rules');
        if (savedRules) { try { setClusteringRules(JSON.parse(savedRules)); } catch(e) {} }
    }, []);
    
    useEffect(() => { 
        if (isOpen && initialFilters) { 
            setSelectedCountries(initialFilters.countries); 
            setSelectedCategories(initialFilters.subCategories); 
            setSelectedProducts(initialFilters.productNames); 
            setSelectedParentAsins(initialFilters.parentAsins);
            if (initialFilters.startDate && initialFilters.endDate) {
                setDateRange({ start: initialFilters.startDate, end: initialFilters.endDate });
            }
        } 
    }, [isOpen, initialFilters]);
    
    const saveClusteringRules = (newRules: Record<string, string[]>) => { setClusteringRules(newRules); localStorage.setItem('refund_clustering_rules', JSON.stringify(newRules)); };

    const enrichedRefundData = useMemo(() => {
        if (!rawPerformance || rawPerformance.length === 0) return refundData.map(r => ({ ...r, category: 'Unknown', parent_asin: 'Unknown' }));
        
        const skuMap = new Map<string, string>(); 
        const asinMap = new Map<string, string>(); 
        const nameMap = new Map<string, string>(); 
        const parentMap = new Map<string, string>(); 

        rawPerformance.forEach(row => { 
            if (row.sub_category) { 
                if (row.child_asin) {
                    skuMap.set(row.child_asin, row.sub_category); 
                    asinMap.set(row.child_asin, row.sub_category); 
                    parentMap.set(row.child_asin, row.parent_asin || 'Unknown');
                }
                if (row.product_name) {
                    nameMap.set(row.product_name, row.sub_category); 
                    parentMap.set(row.product_name, row.parent_asin || 'Unknown');
                }
            } 
        });

        return refundData.map(r => { 
            let cat = 'Unknown'; 
            if (skuMap.has(r.sku)) cat = skuMap.get(r.sku)!; 
            else if (asinMap.has(r.asin)) cat = asinMap.get(r.asin)!; 
            else if (nameMap.has(r.product_name)) cat = nameMap.get(r.product_name)!; 
            
            let parent = 'Unknown';
            if (parentMap.has(r.sku)) parent = parentMap.get(r.sku)!;
            else if (parentMap.has(r.asin)) parent = parentMap.get(r.asin)!;
            else if (parentMap.has(r.product_name)) parent = parentMap.get(r.product_name)!;

            return { ...r, category: cat, parent_asin: parent }; 
        });
    }, [refundData, rawPerformance]);

    const filterOptions = useMemo(() => {
        let filtered = enrichedRefundData; if (selectedCountries.length > 0) filtered = enrichedRefundData.filter(r => selectedCountries.includes(r.country || 'Unknown'));
        const countryOpts = Array.from(new Set(enrichedRefundData.map(r => r.country || 'Unknown'))).sort(); 
        const categoryOpts = Array.from(new Set(filtered.map(r => r.category || 'Unknown'))).sort(); 
        const productOpts = Array.from(new Set(filtered.map(r => r.product_name || r.sku || 'Unknown'))).sort();
        const parentOpts = Array.from(new Set(filtered.map(r => (r as any).parent_asin || 'Unknown'))).sort();
        return { countryOpts, categoryOpts, productOpts, parentOpts };
    }, [enrichedRefundData, selectedCountries, selectedCategories]);

    const dashboardData = useMemo(() => {
        if (enrichedRefundData.length === 0) return null;
        
        const filtered = enrichedRefundData.filter(row => { 
            if (selectedCountries.length > 0 && !selectedCountries.includes(row.country || 'Unknown')) return false; 
            if (selectedCategories.length > 0 && !selectedCategories.includes(row.category || 'Unknown')) return false; 
            if (selectedParentAsins.length > 0 && !selectedParentAsins.includes((row as any).parent_asin || 'Unknown')) return false;
            const pName = row.product_name || row.sku || 'Unknown'; 
            if (selectedProducts.length > 0 && !selectedProducts.includes(pName)) return false;
            if (dateRange.start && row.date < dateRange.start) return false;
            if (dateRange.end && row.date > dateRange.end) return false;
            return true; 
        });

        const salesStats: Record<string, { salesQty: number, salesAmount: number, refunds: number, cost: number }> = {};
        
        if (rawPerformance) {
            const performanceFiltered = rawPerformance.filter(row => { 
                if (selectedCountries.length > 0 && !selectedCountries.includes(row.country || 'Unknown')) return false; 
                if (selectedCategories.length > 0 && !selectedCategories.includes(row.sub_category || 'Unknown')) return false; 
                if (selectedParentAsins.length > 0 && !selectedParentAsins.includes(row.parent_asin || 'Unknown')) return false;
                if (selectedProducts.length > 0 && !selectedProducts.includes(row.product_name || 'Unknown')) return false;
                if (dateRange.start && row.date < dateRange.start) return false;
                if (dateRange.end && row.date > dateRange.end) return false;
                return true; 
            });
            
            performanceFiltered.forEach(row => {
                const month = row.date.substring(0, 7);
                if (!salesStats[month]) salesStats[month] = { salesQty: 0, salesAmount: 0, refunds: 0, cost: 0 };
                salesStats[month].salesQty += row.sales_quantity;
                salesStats[month].salesAmount += row.sales_amount;
                salesStats[month].cost += Math.abs(row.refund_cost || 0); 
            });
        }

        filtered.forEach(row => {
            const month = (row.date && row.date.length >= 7) ? row.date.substring(0, 7) : 'Unknown';
            if (salesStats[month]) { salesStats[month].refunds += (row.quantity || 1); } else if (month !== 'Unknown') { salesStats[month] = { salesQty: 0, salesAmount: 0, refunds: (row.quantity || 1), cost: 0 }; }
        });

        const salesVsRefundData = Object.entries(salesStats).map(([month, stats]) => ({ month, sales: stats.salesQty, salesAmount: stats.salesAmount, refunds: stats.refunds, refundCost: stats.cost })).sort((a,b) => b.month.localeCompare(a.month));

        if (filtered.length === 0) return { totalQty: 0, realReasonData: [], trendByReason: {}, trendByProduct: {}, topProducts: [], matrix: { rows: [], cols: [], data: {} }, comments: [], dispositionData: [], officialReasonData: [], countryData: [], salesVsRefundData, orders: [] };

        let totalQty = 0; const realReasonCounts: Record<string, number> = {}; const productMatrix: Record<string, Record<string, number>> = {}; const productCounts: Record<string, number> = {}; const commentsBucket: string[] = []; const dispositionCounts: Record<string, number> = {}; const officialReasonCounts: Record<string, number> = {}; const countryCounts: Record<string, number> = {}; const trendByReason: Record<string, Record<string, number>> = {}; const trendByProduct: Record<string, Record<string, number>> = {}; 

        filtered.forEach(row => {
            const qty = row.quantity || 1; totalQty += qty; const month = (row.date && row.date.length >= 7) ? row.date.substring(0, 7) : 'Unknown';
            const realReason = identifyIssueCluster(row.buyer_comment, row.reason, clusteringRules); const isRealPainPoint = realReason !== '无备注/未分类' && realReason !== '其他/个人偏好';
            const product = row.product_name && row.product_name !== 'Unknown' ? row.product_name : (row.sku.split('-')[0] || 'Unknown'); const isMonthValid = /^\d{4}-\d{2}$/.test(month);
            if (isRealPainPoint) { realReasonCounts[realReason] = (realReasonCounts[realReason] || 0) + qty; if (isMonthValid) { if (!trendByReason[realReason]) trendByReason[realReason] = {}; trendByReason[realReason][month] = (trendByReason[realReason][month] || 0) + qty; } }
            if (isMonthValid) { if (!trendByProduct[product]) trendByProduct[product] = {}; trendByProduct[product][month] = (trendByProduct[product][month] || 0) + qty; }
            if (!productMatrix[product]) productMatrix[product] = {}; if (isRealPainPoint) { productMatrix[product][realReason] = (productMatrix[product][realReason] || 0) + qty; }
            productCounts[product] = (productCounts[product] || 0) + qty;
            const disp = row.disposition || 'Unknown'; dispositionCounts[disp] = (dispositionCounts[disp] || 0) + qty;
            const offReason = row.reason || 'Unknown'; officialReasonCounts[offReason] = (officialReasonCounts[offReason] || 0) + qty;
            const country = row.country || 'Unknown'; countryCounts[country] = (countryCounts[country] || 0) + qty;
            if (row.buyer_comment && row.buyer_comment.length > 5 && isRealPainPoint) { commentsBucket.push(`[${realReason}] ${product}: ${row.buyer_comment}`); }
        });

        const realReasonData = Object.entries(realReasonCounts).map(([label, value]) => ({ label, value, percent: value / totalQty })).sort((a, b) => b.value - a.value).slice(0, 8); 
        const dispositionData = Object.entries(dispositionCounts).map(([label, value]) => { let color = '#94a3b8'; const l = label.toLowerCase(); if (l.includes('sellable')) color = '#22c55e'; else if (l.includes('damage')) color = '#ef4444'; else if (l.includes('defective')) color = '#f97316'; return { label, value, color }; }).sort((a, b) => b.value - a.value);
        const officialReasonData = Object.entries(officialReasonCounts).map(([label, value]) => ({ label, value, percent: value / totalQty })).sort((a, b) => b.value - a.value).slice(0, 8);
        const countryData = Object.entries(countryCounts).map(([label, value], i) => { const colors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981']; return { label, value, color: colors[i % colors.length] }; }).sort((a, b) => b.value - a.value);
        const topProducts = Object.entries(productCounts).map(([label, value]) => ({ label, value, percent: value / totalQty })).sort((a, b) => b.value - a.value).slice(0, 5);
        const topMatrixProducts = Object.entries(productMatrix).map(([p, reasons]) => ({ p, total: Object.values(reasons).reduce((a, b) => a + b, 0) })).sort((a, b) => b.total - a.total).slice(0, 8).map(item => item.p);
        const allActiveReasons = new Set<string>(); topMatrixProducts.forEach(p => Object.keys(productMatrix[p]).forEach(r => allActiveReasons.add(r))); const top8ReasonKeys = new Set(realReasonData.map(r => r.label)); const matrixCols = Array.from(allActiveReasons).filter(r => top8ReasonKeys.has(r));
        const filteredTrendByReason: Record<string, Record<string, number>> = {}; realReasonData.forEach(r => { if (trendByReason[r.label]) filteredTrendByReason[r.label] = trendByReason[r.label]; });
        const filteredTrendByProduct: Record<string, Record<string, number>> = {}; topProducts.forEach(p => { if (trendByProduct[p.label]) filteredTrendByProduct[p.label] = trendByProduct[p.label]; });

        const orders = filtered.sort((a, b) => b.date.localeCompare(a.date));

        return { totalQty, realReasonData, dispositionData, officialReasonData, countryData, trendByReason: filteredTrendByReason, trendByProduct: filteredTrendByProduct, topProducts, matrix: { rows: topMatrixProducts, cols: matrixCols, data: productMatrix }, comments: commentsBucket.slice(0, 80), salesVsRefundData, orders };
    }, [enrichedRefundData, selectedCountries, selectedCategories, selectedParentAsins, selectedProducts, clusteringRules, rawPerformance, dateRange]);

    const handleFileUploadChange = async (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (!file) return; setIsUploading(true); setUploadError(''); try { const { data } = await parseRefundData(file); if (data.length === 0) setUploadError("文件为空或格式错误"); else onDataChange(data); } catch (err) { setUploadError("解析失败"); } finally { setIsUploading(false); } };
    
    const generateExpertDiagnosis = async () => { 
        if (!hasConfiguredAiApi()) { setAiInsight(`错误：未配置 API Key。${AI_API_SETUP_HINT}`); return; } 
        setIsGeneratingAi(true); setAiInsight(''); 
        try { 
            if (!dashboardData || dashboardData.totalQty === 0) { setAiInsight("数据不足，无法生成报告。"); setIsGeneratingAi(false); return; } 
            
            const topPainPoints = dashboardData.realReasonData.map(r => `${r.label} (${(r.percent * 100).toFixed(1)}%)`).join(', '); 
            const topProducts = dashboardData.topProducts.map(p => `${p.label} (${p.value}件)`).join(', '); 
            const topComments = dashboardData.comments.slice(0, 15).join('\n'); 
            
            const dataContext = `
            【分析时间范围】: ${dateRange.start || '最早'} 至 ${dateRange.end || '最晚'}
            【数据概览】
            总退货量: ${dashboardData.totalQty}
            【主要退货原因分布】
            ${topPainPoints}
            【退货高发产品】
            ${topProducts}
            【买家评论/备注样本】
            ${topComments}`; 
            
            const defaultSystem = "你是一个亚马逊FBA退货分析专家。请根据以下数据进行诊断并给出行动建议。"; 
            const defaultTemplate = `请根据以下数据生成退货诊断报告：\n{{DATA}}\n\n请严格输出 **Markdown**，并按以下结构返回：\n\n# 退货诊断报告\n\n## 1. 核心痛点总结\n- 用 3-5 条要点总结最核心问题。\n\n## 2. 重点关注产品\n请输出表格：\n| 产品 | 主要问题 | 影响程度 | 说明 |\n|---|---|---|---|\n\n## 3. 行动建议\n请输出表格：\n| 优先级 | 问题 | 建议动作 | 预期收益 |\n|---|---|---|---|\n\n要求：\n- 不要输出 JSON\n- 必须包含以上两个 Markdown 表格\n- 语言专业、直接、可执行。`; 
            const settings = getActivePromptSettings('refund_analysis_settings', defaultSystem, defaultTemplate); 
            const finalPrompt = (settings.template || defaultTemplate).replace('{{DATA}}', dataContext); 
            const text = await unifiedGenerateContent({
                systemInstruction: settings.system,
                contents: finalPrompt,
                geminiModel: 'gemini-3-flash-preview',
            });
            setAiInsight(text || '无内容'); 
        } catch (e: any) { setAiInsight(`Error: ${e.message}`); } finally { setIsGeneratingAi(false); } 
    };

    // --- Export Markdown Report ---
    const handleExportReport = async () => {
        if (!dashboardData) return;
        setIsExporting(true);
        try {
            const topReasons = dashboardData.realReasonData.slice(0, 10);
            const topProducts = dashboardData.topProducts.slice(0, 8);
            const actionRows = topReasons.slice(0, 3).map((reason, idx) => ({
                priority: idx + 1,
                issue: reason.label,
                action: idx === 0
                    ? '优先修订商品详情页与尺码/规格说明，并在主图增加关键参数标注'
                    : idx === 1
                    ? '对该问题相关批次执行抽检复盘，修订质检点并跟踪7天退货率'
                    : '针对高频差评关键词更新FAQ与售后话术，减少预期偏差',
                benefit: '预计降低对应原因退货占比并提升转化稳定性'
            }));

            const markdown = [
                '# 退货分析报告',
                '',
                `- 生成时间：${new Date().toLocaleString()}`,
                `- 分析时间范围：${dateRange.start || '不限'} 至 ${dateRange.end || '不限'}`,
                `- 筛选国家：${selectedCountries.length > 0 ? selectedCountries.join('、') : '全部'}`,
                `- 总退货数量：${formatNumber(dashboardData.totalQty)}`,
                '',
                '## 核心痛点总结',
                ...topReasons.slice(0, 5).map((r, i) => `- ${i + 1}. ${r.label}：${r.value}（${formatPercent(r.percent)}）`),
                '',
                '## 重点关注产品',
                '| 产品 | 退货数量 | 占比 | 主要问题 |',
                '|---|---:|---:|---|',
                ...topProducts.map((p, i) => `| ${p.label} | ${formatNumber(p.value)} | ${formatPercent(p.percent)} | ${topReasons[i % Math.max(topReasons.length, 1)]?.label || '-'} |`),
                '',
                '## 行动建议',
                '| 优先级 | 问题 | 建议动作 | 预期收益 |',
                '|---:|---|---|---|',
                ...actionRows.map((r) => `| P${r.priority} | ${r.issue} | ${r.action} | ${r.benefit} |`),
                '',
                '## 退货原因明细（Top 10）',
                '| 退货原因 | 数量 | 占比 |',
                '|---|---:|---:|',
                ...topReasons.map((r) => `| ${r.label} | ${formatNumber(r.value)} | ${formatPercent(r.percent)} |`),
                '',
                '## 近期退货订单样本（Top 20）',
                '| 日期 | SKU | 原因 | 买家备注 |',
                '|---|---|---|---|',
                ...dashboardData.orders.slice(0, 20).map((order) => `| ${order.date || '-'} | ${order.sku || '-'} | ${(order.reason || '-').replace(/\|/g, '\\|')} | ${(order.buyer_comment || '-').replace(/\n/g, ' ').replace(/\|/g, '\\|')} |`),
                ''
            ].join('\n');

            const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `退货分析报告_${new Date().toISOString().slice(0, 10)}.md`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error(e);
            alert('导出失败');
        } finally {
            setIsExporting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <>
            <ExpertReportOverlay isOpen={showReportOverlay} onClose={() => setShowReportOverlay(false)} onGenerate={generateExpertDiagnosis} report={aiInsight} isGenerating={isGeneratingAi} onReset={() => setAiInsight('')} />
            <ClusteringSettingsModal isOpen={isClusteringSettingsOpen} onClose={() => setIsClusteringSettingsOpen(false)} onSave={saveClusteringRules} initialRules={clusteringRules} />
            <div className="fixed inset-0 z-[110] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in zoom-in duration-200">
                <div className="bg-slate-50 w-full h-full max-w-[95vw] max-h-[95vh] rounded-xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
                    <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white flex-shrink-0">
                        <div className="flex items-center gap-3">
                            <div className="bg-orange-500 p-2 rounded-lg"><FileText className="w-5 h-5 text-white" /></div>
                            <div><h2 className="text-xl font-bold tracking-tight">退货深度分析 (Returns)</h2><p className="text-xs text-orange-100">FBA Return Reports Analysis</p></div>
                        </div>
                        <div className="flex items-center gap-4">
                            {dashboardData && (
                                <button 
                                    onClick={handleExportReport}
                                    disabled={isExporting}
                                    className="p-1.5 hover:bg-white/20 rounded-full transition-colors text-orange-100 hover:text-white disabled:opacity-50"
                                    title="导出退货分析报告 (PDF)"
                                >
                                    {isExporting ? <Loader2 className="w-5 h-5 animate-spin"/> : <Download className="w-5 h-5" />}
                                </button>
                            )}
                            <button onClick={onClose} className="p-2 hover:bg-slate-700 rounded-full transition-colors"><X className="w-6 h-6 text-slate-300" /></button>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-6 custom-scroll">
                         {!dashboardData ? (
                            <div className="h-full flex flex-col items-center justify-center space-y-8">
                                <div onClick={() => fileInputRef.current?.click()} className="w-full max-w-2xl border-2 border-dashed border-slate-300 hover:border-orange-500 hover:bg-orange-50/50 rounded-3xl p-16 flex flex-col items-center cursor-pointer transition-all group bg-white shadow-sm">
                                    <div className="w-20 h-20 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform shadow-inner"><Upload className="w-10 h-10" /></div>
                                    <h3 className="text-2xl font-bold text-slate-800">导入退货报表 (Returns Report)</h3>
                                    <p className="text-slate-500 mt-3 text-center max-w-md">支持亚马逊 FBA Returns Report (.xlsx/.csv).</p>
                                    <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx,.csv" onChange={handleFileUploadChange} />
                                </div>
                                {isUploading && <div className="text-orange-600 font-medium animate-pulse flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin"/> 正在解析退货数据...</div>}
                                {uploadError && <div className="text-red-500 bg-red-50 px-4 py-2 rounded-lg border border-red-100 flex items-center gap-2"><AlertCircle className="w-4 h-4"/>{uploadError}</div>}
                            </div>
                        ) : (
                            <div className="space-y-6">
                                <div className="flex flex-wrap gap-4 items-center bg-white p-4 rounded-xl border border-slate-200 shadow-sm sticky top-0 z-20">
                                    <div className="flex items-center gap-2 text-slate-500 text-sm font-bold mr-2"><Filter className="w-4 h-4" /> 筛选:</div>
                                    <MultiSelectDropdown label="国家" options={filterOptions.countryOpts} selected={selectedCountries} onChange={setSelectedCountries} />
                                    <MultiSelectDropdown label="父ASIN" options={filterOptions.parentOpts} selected={selectedParentAsins} onChange={setSelectedParentAsins} />
                                    <MultiSelectDropdown label="分类" options={filterOptions.categoryOpts} selected={selectedCategories} onChange={setSelectedCategories} />
                                    <MultiSelectDropdown label="产品" options={filterOptions.productOpts} selected={selectedProducts} onChange={setSelectedProducts} />
                                    
                                    <div className="h-6 w-px bg-slate-200 mx-2"></div>
                                    <div className="flex items-center gap-2 bg-slate-50 px-2 py-1 rounded-lg border border-slate-200">
                                        <Calendar className="w-4 h-4 text-slate-400" />
                                        <input 
                                            type="date" 
                                            className="bg-transparent text-xs text-slate-600 outline-none" 
                                            value={dateRange.start} 
                                            onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))} 
                                        />
                                        <span className="text-slate-400 text-xs">-</span>
                                        <input 
                                            type="date" 
                                            className="bg-transparent text-xs text-slate-600 outline-none" 
                                            value={dateRange.end} 
                                            onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))} 
                                        />
                                    </div>

                                    <div className="ml-auto flex items-center gap-3">
                                        <button onClick={() => setShowReportOverlay(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all shadow-md active:scale-95"><Sparkles className="w-4 h-4" /> AI 诊断报告</button>
                                        <button onClick={() => onDataChange([])} className="text-slate-400 hover:text-red-500 p-2 rounded-full hover:bg-slate-100 transition-colors"><Trash2 className="w-4 h-4" /></button>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                     <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between"><div><div className="text-xs text-slate-500 font-bold uppercase">总退货数</div><div className="text-3xl font-bold text-slate-800 mt-1">{formatNumber(dashboardData.totalQty)}</div></div><div className="bg-orange-100 p-3 rounded-full"><RotateCcw className="w-6 h-6 text-orange-600" /></div></div>
                                </div>
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col h-[380px]"><h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2"><Activity className="w-4 h-4 text-purple-500" /> 痛点趋势 (Reason Trend)</h3><div className="flex-1 w-full relative min-h-0"><RobustTrendChart data={dashboardData.trendByReason} /></div></div>
                                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col h-[380px]"><h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2"><Grid className="w-4 h-4 text-indigo-500" /> 单品缺陷热力图 (Product Heatmap)</h3><div className="flex-1 relative min-h-0"><HeatmapTable rows={dashboardData.matrix.rows} cols={dashboardData.matrix.cols} data={dashboardData.matrix.data} /></div></div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                                     <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col h-[340px]"><div className="flex items-center justify-between mb-4"><h3 className="text-sm font-bold text-slate-700 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-red-500" /> 核心痛点 (Top Reasons)</h3><button onClick={() => setIsClusteringSettingsOpen(true)} className="text-slate-400 hover:text-indigo-600 p-1 hover:bg-slate-100 rounded transition-colors" title="配置痛点聚类规则"><Settings className="w-3.5 h-3.5" /></button></div><div className="flex-1 overflow-hidden min-h-0"><PainPointBarChart data={dashboardData.realReasonData} colorClass="bg-red-500" /></div></div>
                                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col h-[340px]"><h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2"><PieChart className="w-4 h-4 text-blue-500" /> 产品库存属性 (Disposition)</h3><div className="flex-1 overflow-hidden min-h-0"><DonutChart data={dashboardData.dispositionData} title="Disposition" /></div></div>
                                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col h-[340px]"><h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2"><Layers className="w-4 h-4 text-green-500" /> 亚马逊官方原因 (Official)</h3><div className="flex-1 overflow-hidden min-h-0"><HorizontalBarChart data={dashboardData.officialReasonData} colorClass="bg-green-500" /></div></div>
                                </div>

                                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                                    <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
                                        <Table className="w-4 h-4 text-slate-500" />
                                        退货数据明细 (Monthly Detail)
                                    </h3>
                                    <RefundTrendTable data={dashboardData.salesVsRefundData} />
                                </div>

                                <RefundOrdersTable orders={dashboardData.orders} />
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Hidden Report Template */}
            <div className="absolute top-0 left-0 -z-50 opacity-0 pointer-events-none">
                <div ref={reportRef} className="w-[800px] bg-white p-10 font-sans text-slate-800">
                    <div className="flex justify-between items-center border-b-2 border-slate-800 pb-4 mb-6">
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight">退货分析报告</h1>
                            <div className="text-sm text-slate-500 mt-1">Returns Analysis Report</div>
                        </div>
                        <div className="text-right text-xs text-slate-400">
                            <div>生成时间: {new Date().toLocaleDateString()}</div>
                        </div>
                    </div>

                    <div className="bg-slate-50 p-4 rounded-lg mb-8 grid grid-cols-2 gap-4">
                        <div>
                            <div className="text-xs text-slate-400">分析时间范围</div>
                            <div className="font-bold text-sm">{dateRange.start || '不限'} 至 {dateRange.end || '不限'}</div>
                        </div>
                        <div>
                            <div className="text-xs text-slate-400">筛选国家</div>
                            <div className="font-bold text-sm">{selectedCountries.length > 0 ? selectedCountries.join(', ') : '全部'}</div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-6 mb-8">
                        <div className="p-4 border rounded-lg">
                            <div className="text-xs text-slate-500 mb-2">总退货数量</div>
                            <div className="text-2xl font-bold font-mono">{formatNumber(dashboardData?.totalQty)}</div>
                        </div>
                        <div className="p-4 border rounded-lg">
                            <div className="text-xs text-slate-500 mb-2">Top 1 痛点占比</div>
                            <div className="text-2xl font-bold font-mono text-red-500">
                                {dashboardData?.realReasonData[0] ? formatPercent(dashboardData.realReasonData[0].percent) : '0%'}
                            </div>
                        </div>
                    </div>

                    <div className="mb-8">
                        <h3 className="font-bold text-slate-700 mb-4 border-l-4 border-red-500 pl-2">核心痛点排行 (Top Pain Points)</h3>
                        <table className="w-full text-xs text-left">
                            <thead className="bg-slate-100 text-slate-600">
                                <tr>
                                    <th className="p-2 border-b">退货原因</th>
                                    <th className="p-2 border-b text-right">数量</th>
                                    <th className="p-2 border-b text-right">占比</th>
                                </tr>
                            </thead>
                            <tbody>
                                {dashboardData?.realReasonData.slice(0, 10).map((r, i) => (
                                    <tr key={i}>
                                        <td className="p-2 font-medium">{r.label}</td>
                                        <td className="p-2 text-right font-mono">{r.value}</td>
                                        <td className="p-2 text-right font-mono">{formatPercent(r.percent)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {aiInsight && (
                        <div className="bg-slate-50 p-6 rounded-lg border border-slate-200 mb-8">
                            <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-purple-500" />
                                AI 专家诊断建议
                            </h3>
                            <div className="prose prose-sm max-w-none text-xs leading-relaxed whitespace-pre-wrap">
                                {aiInsight}
                            </div>
                        </div>
                    )}

                    <div>
                        <h3 className="font-bold text-slate-700 mb-4 border-l-4 border-orange-500 pl-2">退货订单样本 (Top 20 Recent)</h3>
                        <table className="w-full text-xs text-left">
                            <thead className="bg-slate-100 text-slate-600">
                                <tr>
                                    <th className="p-2 border-b">日期</th>
                                    <th className="p-2 border-b">SKU</th>
                                    <th className="p-2 border-b">原因</th>
                                    <th className="p-2 border-b">备注</th>
                                </tr>
                            </thead>
                            <tbody>
                                {dashboardData?.orders.slice(0, 20).map((order, i) => (
                                    <tr key={i}>
                                        <td className="p-2 font-mono whitespace-nowrap">{order.date}</td>
                                        <td className="p-2 font-mono truncate max-w-[100px]">{order.sku}</td>
                                        <td className="p-2 truncate max-w-[100px]">{order.reason}</td>
                                        <td className="p-2 truncate max-w-[200px] text-slate-500">{order.buyer_comment || '-'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </>
    );
};


import React, { useState, useEffect, useRef, useMemo } from 'react';
import { FilterState, DataRow, InventoryRow, TargetRow } from '../types';
import { Filter, User, Tag, Layers, Box, Hash, Globe, ChevronDown, Check, Search, XCircle, Store, ShoppingBag, CalendarRange, AlertCircle, CalendarClock, Calendar, BookOpen, X, CalendarDays, History, Square } from 'lucide-react';
import { getISOWeekDateRange, formatDate, formatBusinessWeekFromDateStr, getBusinessWeekRangeFromYearWeek } from '../utils';

interface SidebarProps {
  data: DataRow[];
  inventoryData?: InventoryRow[]; 
  targetData?: TargetRow[]; 
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  warnings?: string[]; 
  isWeeklyMode?: boolean; 
}

// --- User Guide Modal (Unchanged) ---
const UserGuideModal = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
    if (!isOpen) return null;
    const steps = [
        { title: "1. 数据接入", icon: <Layers className="w-5 h-5 text-blue-500" />, content: "点击右上角的 '导入数据源'。支持业绩报告、库存报告、退货及评论报告。" },
        { title: "2. 全局筛选", icon: <Filter className="w-5 h-5 text-indigo-500" />, content: "侧边栏筛选器采用 Excel 逻辑：默认全选（包含未分类数据）。取消勾选特定项可排除数据。" },
        { title: "3. 核心看板", icon: <CalendarRange className="w-5 h-5 text-purple-500" />, content: "P&L、流量、库存三大核心报表。自动计算同环比。" },
        { title: "4. 深度透视", icon: <Search className="w-5 h-5 text-green-500" />, content: "点击表格标题的 '详细数据' 按钮，进入多维透视与 AI 诊断模式。" },
        { title: "5. AI 顾问", icon: <BookOpen className="w-5 h-5 text-yellow-500" />, content: "利用右下角 AI 助手进行自由问答与数据挖掘。" }
    ];
    return (
        <div className="fixed inset-0 z-[200] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in zoom-in duration-200" onClick={onClose}>
            <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="bg-slate-900 px-6 py-5 flex items-center justify-between text-white">
                    <h2 className="text-xl font-bold tracking-wide">平台使用指南</h2>
                    <button onClick={onClose}><X className="w-5 h-5" /></button>
                </div>
                <div className="p-8 space-y-6">
                    {steps.map((step, idx) => (
                        <div key={idx} className="flex gap-4"><div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center border">{step.icon}</div><div><h3 className="font-bold text-slate-800">{step.title}</h3><p className="text-sm text-slate-600">{step.content}</p></div></div>
                    ))}
                </div>
            </div>
        </div>
    );
};

// --- Enhanced Dropdown with Excel-like Logic ---
const EnhancedDropdown = ({ title, icon, options, selected, onToggle, onBulkSet }: { 
    title: string, 
    icon: React.ReactNode, 
    options: string[], 
    selected: string[], // Empty array means ALL selected. ['__NONE__'] means NONE selected.
    onToggle: (val: string, allOptions: string[]) => void,
    onBulkSet: (vals: string[]) => void
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);

    // Filter displayed options based on search
    const displayedOptions = useMemo(() => {
        if (!searchTerm) return options;
        return options.filter(opt => opt.toLowerCase().includes(searchTerm.toLowerCase()));
    }, [options, searchTerm]);

    // Check if an option is effectively selected
    // Note: If selected is ['__NONE__'], then nothing is selected.
    const isSelected = (opt: string) => {
        if (selected.includes('__NONE__')) return false;
        return selected.length === 0 || selected.includes(opt);
    };

    const handleSelectAllVisible = () => {
        onBulkSet([]); // Reset to ALL (Empty)
    };

    const handleDeselectAll = () => {
        onBulkSet(['__NONE__']); // Special token for "Select None"
    };

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Visual label
    const isAllSelected = selected.length === 0;
    const isNoneSelected = selected.includes('__NONE__');
    
    let label = title;
    if (isNoneSelected) label = `${title} (0)`;
    else if (!isAllSelected) label = `${title} (${selected.length})`;
    
    return (
        <div className="mb-2 relative" ref={containerRef}>
            <button 
                onClick={() => setIsOpen(!isOpen)}
                className={`w-full flex items-center justify-between rounded-2xl border px-3.5 py-3 text-xs font-medium transition-all duration-200
                    ${isOpen
                        ? 'border-sky-400/70 bg-slate-800 text-white shadow-[0_12px_30px_-18px_rgba(56,189,248,0.7)]'
                        : 'border-slate-700/80 bg-slate-800/60 text-slate-200 hover:border-slate-500 hover:bg-slate-800'}
                    ${!isAllSelected && !isNoneSelected ? 'border-sky-500/40 bg-sky-500/10 text-sky-100' : ''}
                `}
            >
                <div className="flex items-center gap-2.5 overflow-hidden">
                    <div className={`flex h-7 w-7 items-center justify-center rounded-xl border ${!isAllSelected && !isNoneSelected ? 'border-sky-400/30 bg-sky-500/15 text-sky-200' : 'border-slate-700 bg-slate-900/60 text-slate-400'}`}>
                        {icon}
                    </div>
                    <span className="truncate text-left">{label}</span>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-2xl border border-slate-600/80 bg-slate-850 shadow-2xl shadow-slate-950/40 flex flex-col backdrop-blur-xl">
                    <div className="border-b border-slate-700/80 bg-slate-800/95 p-2.5 sticky top-0">
                        <div className="relative mb-2">
                            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                            <input 
                                type="text"
                                placeholder="搜索..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full rounded-xl border border-slate-600 bg-slate-900 py-2 pl-8 pr-2.5 text-xs text-white outline-none transition-colors focus:border-sky-400"
                                autoFocus
                            />
                        </div>
                        <div className="flex justify-between items-center px-1">
                             <button 
                                onClick={handleSelectAllVisible}
                                className="text-[10px] text-sky-300 hover:text-white transition-colors"
                             >
                                全选
                             </button>
                             <button 
                                onClick={handleDeselectAll}
                                className="text-[10px] text-slate-400 hover:text-rose-300 transition-colors flex items-center gap-1"
                             >
                                <Square className="w-3 h-3" />
                                取消全选
                             </button>
                        </div>
                    </div>

                    <div className="max-h-60 overflow-y-auto custom-scroll p-1.5">
                        {displayedOptions.length > 0 ? (
                            displayedOptions.map(opt => {
                                const checked = isSelected(opt);
                                return (
                                    <div 
                                        key={opt} 
                                        onClick={() => onToggle(opt, options)}
                                        className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-xs cursor-pointer text-slate-200 transition-colors hover:bg-slate-700/80"
                                    >
                                        <div className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center transition-colors
                                            ${checked ? 'bg-sky-500 border-sky-400' : 'border-slate-500 bg-slate-900'}
                                        `}>
                                            {checked && <Check className="w-2.5 h-2.5 text-white" />}
                                        </div>
                                        <span className="truncate" title={opt}>{opt}</span>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="px-3 py-5 text-center text-xs text-slate-500">
                                无匹配结果
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export const SidebarFilters: React.FC<SidebarProps> = ({ data, inventoryData = [], targetData = [], filters, setFilters, warnings = [], isWeeklyMode = false }) => {
    
    const [startVal, setStartVal] = useState('');
    const [endVal, setEndVal] = useState('');
    const [isGuideOpen, setIsGuideOpen] = useState(false);

    const getWeekStringFromDate = (dateStr: string) => formatBusinessWeekFromDateStr(dateStr);

    // Date Sync Effects - Unchanged
    useEffect(() => {
        if (isWeeklyMode) {
            const s = getWeekStringFromDate(filters.startDate);
            const e = getWeekStringFromDate(filters.endDate);
            if (s && s !== startVal) setStartVal(s);
            if (e && e !== endVal) setEndVal(e);
        } else {
            const s = filters.startDate ? filters.startDate.substring(0, 7) : '';
            const e = filters.endDate ? filters.endDate.substring(0, 7) : '';
            if (s && s !== startVal) setStartVal(s);
            if (e && e !== endVal) setEndVal(e);
        }
    }, [filters.startDate, filters.endDate, isWeeklyMode]);

    const handleDateChange = (type: 'start' | 'end', val: string) => {
        if (type === 'start') setStartVal(val);
        else setEndVal(val);
    };

    useEffect(() => {
        if (!startVal || !endVal) return;
        const timer = setTimeout(() => {
            if (isWeeklyMode) {
                const [sy, sw] = startVal.split('-W').map(Number);
                const [ey, ew] = endVal.split('-W').map(Number);
                if (sy && sw && ey && ew) {
                    const { start: rangeStart } = getBusinessWeekRangeFromYearWeek(sy, sw);
                    const { end: rangeEnd } = getBusinessWeekRangeFromYearWeek(ey, ew);
                    const startDate = formatDate(rangeStart);
                    const endDate = formatDate(rangeEnd);
                    if (startDate !== filters.startDate || endDate !== filters.endDate) {
                        setFilters(prev => ({ ...prev, startDate, endDate }));
                    }
                }
            } else {
                const [sy, sm] = startVal.split('-').map(Number);
                const [ey, em] = endVal.split('-').map(Number);
                if (sy && sm && ey && em) {
                    const firstDay = new Date(sy, sm - 1, 1);
                    const lastDay = new Date(ey, em, 0); 
                    const toISO = (d: Date) => `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`;
                    const newStart = toISO(firstDay);
                    const newEnd = toISO(lastDay);
                    if (newStart !== filters.startDate || newEnd !== filters.endDate) {
                        setFilters(prev => ({ ...prev, startDate: newStart, endDate: newEnd }));
                    }
                }
            }
        }, 500); 
        return () => clearTimeout(timer);
    }, [startVal, endVal, isWeeklyMode, filters.startDate, filters.endDate, setFilters]);

    // --- Option Collection Logic ---
    const availableOptions = useMemo(() => {
        const passesFilters = (row: any, targetFilterKey: keyof FilterState) => {
             const check = (key: keyof FilterState, val: string) => {
                 if (key === targetFilterKey) return true; 
                 // Handle __NONE__ case in options collection too? 
                 // If a filter is set to __NONE__, nothing matches, so exclude rows.
                 if (filters[key].includes('__NONE__')) return false;
                 if (filters[key].length === 0) return true; 
                 return filters[key].includes(val);
             };
             
             if (!check('countries', row.country)) return false;
             if (!check('brands', row.brand)) return false;
             if (!check('managers', row.manager)) return false;
             if (!check('shops', row.shop_name)) return false;
             
             const subCat = row.sub_category || row.category_2;
             if (!check('subCategories', subCat)) return false;
             
             if (!check('parentAsins', row.parent_asin)) return false;
             
             const child = row.child_asin || row.asin;
             if (!check('childAsins', child)) return false;
             
             if (!check('productNames', row.product_name)) return false;

             return true;
        };

        const collectOptions = (
            targetFilterKey: keyof FilterState, 
            dataField: keyof DataRow, 
            invField: keyof InventoryRow,
            targetField: keyof TargetRow
        ) => {
            const uniqueValues = new Set<string>();
            
            const processValue = (val: any) => {
                if (val === undefined || val === null) return;
                const strVal = String(val);
                const parts = strVal.split(/[,，/]/);
                parts.forEach(p => {
                    const clean = p.trim();
                    if (!clean) return; 
                    const lower = clean.toLowerCase();
                    if (lower === 'all') return;
                    if (lower === 'kidpolis') return; 
                    uniqueValues.add(clean);
                });
            };

            // 1. Performance Data
            data.forEach(row => {
                if (filters.startDate && row.date < filters.startDate) return;
                if (filters.endDate && row.date > filters.endDate) return;
                if (!passesFilters(row, targetFilterKey)) return;
                processValue(row[dataField]);
            });

            // 2. Inventory Data
            if (!isWeeklyMode) {
                inventoryData.forEach(row => {
                    if (!passesFilters(row, targetFilterKey)) return;
                    processValue(row[invField]);
                });
            }

            // 3. Target Data
            targetData.forEach(row => {
                if (filters.startDate) {
                    const rowMonth = row.month; 
                    const filterStartMonth = filters.startDate.substring(0, 7);
                    const filterEndMonth = filters.endDate.substring(0, 7);
                    if (rowMonth < filterStartMonth || rowMonth > filterEndMonth) return;
                }
                if (!passesFilters(row, targetFilterKey)) return;
                processValue(row[targetField]);
            });

            const sorted = Array.from(uniqueValues).sort((a, b) => {
                // 1. Check for specific "Unplanned" items
                const unplannedPrefixes = ["25年孙逸雄新品-未规划", "25年江立新品-未规划"];
                const isUnplannedA = unplannedPrefixes.some(p => a.includes(p));
                const isUnplannedB = unplannedPrefixes.some(p => b.includes(p));

                if (isUnplannedA && !isUnplannedB) return 1; // A to bottom
                if (!isUnplannedA && isUnplannedB) return -1; // B to bottom

                // 2. Check for Unknown
                const isUnknownA = a === 'Unknown';
                const isUnknownB = b === 'Unknown';
                if (isUnknownA && !isUnknownB) return 1; // Unknown to bottom
                if (!isUnknownA && isUnknownB) return -1;

                return a.localeCompare(b, 'zh-CN');
            });

            return sorted;
        };

        return {
            countries: collectOptions('countries', 'country', 'country', 'country'),
            brands: collectOptions('brands', 'brand', 'brand', 'brand'),
            managers: collectOptions('managers', 'manager', 'manager', 'manager'),
            shops: collectOptions('shops', 'shop_name', 'shop_name', 'shop_name'),
            subCategories: collectOptions('subCategories', 'sub_category', 'category_2', 'sub_category'), 
            parentAsins: collectOptions('parentAsins', 'parent_asin', 'parent_asin', 'parent_asin'),
            childAsins: collectOptions('childAsins', 'child_asin', 'asin', 'child_asin'), 
            productNames: collectOptions('productNames', 'product_name', 'product_name', 'product_name'),
        };
    }, [data, inventoryData, targetData, filters, isWeeklyMode]);

    // --- Toggle Logic with Excel Behavior ---
    type FilterArrayKey = 'countries' | 'brands' | 'managers' | 'shops' | 'subCategories' | 'parentAsins' | 'childAsins' | 'productNames';

    const toggleFilter = (key: FilterArrayKey, value: string, allOptions: string[]) => {
        setFilters(prev => {
            const currentList = prev[key];
            
            // 1. Handle __NONE__ State (If currently None, any click starts a selection)
            if (currentList.includes('__NONE__')) {
                return { ...prev, [key]: [value] };
            }

            // 2. Handle All State (Empty List)
            if (currentList.length === 0) {
                // If currently "All", switch to "All EXCEPT this one"
                return { ...prev, [key]: allOptions.filter(o => o !== value) };
            }

            // 3. Standard Toggle
            if (currentList.includes(value)) {
                // Unchecking
                const newList = currentList.filter(item => item !== value);
                // If we uncheck the last item, what should happen?
                // In Excel, unchecking the last visible item makes filter empty (None selected).
                // Here, let's set it to __NONE__ to avoid accidental "Select All".
                if (newList.length === 0) {
                    return { ...prev, [key]: ['__NONE__'] };
                }
                return { ...prev, [key]: newList }; 
            } else {
                // Checking
                const newList = [...currentList, value];
                // If we've now selected everything possible, revert to "All" (empty list) for efficiency
                // Note: comparing against allOptions length is approximate but usually sufficient
                if (newList.length >= allOptions.length) {
                    return { ...prev, [key]: [] };
                }
                return { ...prev, [key]: newList };
            }
        });
    };

    const setBulkFilter = (key: FilterArrayKey, values: string[]) => {
        setFilters(prev => ({ ...prev, [key]: values }));
    };

    const clearAllFilters = () => {
        setFilters(prev => ({
            ...prev,
            countries: [], brands: [], managers: [], shops: [],
            subCategories: [], parentAsins: [], childAsins: [], productNames: []
        }));
    };

    const toLocalISO = (d: Date) => {
        const y = d.getFullYear();
        const m = (d.getMonth() + 1).toString().padStart(2, '0');
        const day = d.getDate().toString().padStart(2, '0');
        return `${y}-${m}-${day}`;
    };

    const handleLastMonth = () => {
        const now = new Date();
        const currentMonthFirst = new Date(now.getFullYear(), now.getMonth(), 1);
        const prevMonthLast = new Date(currentMonthFirst.getTime() - 86400000);
        const prevMonthFirst = new Date(prevMonthLast.getFullYear(), prevMonthLast.getMonth(), 1);
        setFilters(prev => ({...prev, startDate: toLocalISO(prevMonthFirst), endDate: toLocalISO(prevMonthLast) }));
    };

    const handleThisMonth = () => {
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        setFilters(prev => ({...prev, startDate: toLocalISO(firstDay), endDate: toLocalISO(lastDay) }));
    };

    const handleThisWeek = () => {
        const now = new Date();
        const { start, end } = getISOWeekDateRange(now);
        setFilters(prev => ({...prev, startDate: formatDate(start), endDate: formatDate(end) }));
    };

    const handleLastWeek = () => {
        const now = new Date();
        const lastWeekDay = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const { start, end } = getISOWeekDateRange(lastWeekDay);
        setFilters(prev => ({...prev, startDate: formatDate(start), endDate: formatDate(end) }));
    };

    const hasActiveFilters = filters.countries.length > 0 || filters.brands.length > 0 || 
                             filters.managers.length > 0 || filters.shops.length > 0 ||
                             filters.subCategories.length > 0 ||
                             filters.parentAsins.length > 0 || filters.childAsins.length > 0 || 
                             filters.productNames.length > 0;

    return (
        <div className="w-72 bg-[linear-gradient(180deg,#020617_0%,#0f172a_18%,#111827_100%)] text-slate-200 h-screen overflow-visible flex-shrink-0 sticky top-0 border-r border-slate-800/80 flex flex-col z-20 shadow-[16px_0_50px_-28px_rgba(15,23,42,0.85)]">
            <UserGuideModal isOpen={isGuideOpen} onClose={() => setIsGuideOpen(false)} />
            
            <div className="border-b border-slate-800/80 px-5 pb-4 pt-5">
                <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2 text-sky-300 font-bold text-lg font-mono tracking-tight">
                            <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-sky-400/20 bg-sky-400/10 text-sky-200">
                                <Filter className="w-4 h-4" />
                            </div>
                            <span>{isWeeklyMode ? '周度分析' : '业绩报告'}</span>
                        </div>
                    </div>
                    <button onClick={() => setIsGuideOpen(true)} className="rounded-xl border border-slate-700 bg-slate-800/70 p-2 text-slate-400 transition-colors hover:text-white hover:border-slate-500">
                        <BookOpen className="w-4 h-4" />
                    </button>
                </div>

                <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[0.2em] uppercase ${isWeeklyMode ? 'border-violet-400/20 bg-violet-400/10 text-violet-200' : 'border-sky-400/20 bg-sky-400/10 text-sky-200'}`}>
                        {isWeeklyMode ? 'Weekly' : 'Monthly'}
                    </span>
                    {hasActiveFilters && (
                        <button onClick={clearAllFilters} className="text-xs text-slate-400 hover:text-rose-300 flex items-center gap-1 transition-colors">
                            <XCircle className="w-3.5 h-3.5" />重置筛选
                        </button>
                    )}
                </div>
            </div>

            <div className="px-5 pt-4">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/50 px-3.5 py-3">
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                        <CalendarRange className="w-3.5 h-3.5" />
                        当前周期
                    </div>
                    <div className="text-sm font-semibold text-slate-100 font-mono tracking-tight">
                        {filters.startDate || '--'} <span className="text-slate-500">→</span> {filters.endDate || '--'}
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scroll px-5 pb-5 pt-4">
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">筛选维度</div>
                <div className="space-y-1">
                    <EnhancedDropdown title="国家" icon={<Globe className="w-3 h-3"/>} options={availableOptions.countries} selected={filters.countries} onToggle={(v, all) => toggleFilter('countries', v, all)} onBulkSet={(vs) => setBulkFilter('countries', vs)} />
                    <EnhancedDropdown title="品牌" icon={<Tag className="w-3 h-3"/>} options={availableOptions.brands} selected={filters.brands} onToggle={(v, all) => toggleFilter('brands', v, all)} onBulkSet={(vs) => setBulkFilter('brands', vs)} />
                    <EnhancedDropdown title="负责人" icon={<User className="w-3 h-3"/>} options={availableOptions.managers} selected={filters.managers} onToggle={(v, all) => toggleFilter('managers', v, all)} onBulkSet={(vs) => setBulkFilter('managers', vs)} />
                    <EnhancedDropdown title="店铺" icon={<Store className="w-3 h-3"/>} options={availableOptions.shops} selected={filters.shops} onToggle={(v, all) => toggleFilter('shops', v, all)} onBulkSet={(vs) => setBulkFilter('shops', vs)} />
                    <EnhancedDropdown title="二级分类" icon={<Layers className="w-3 h-3"/>} options={availableOptions.subCategories} selected={filters.subCategories} onToggle={(v, all) => toggleFilter('subCategories', v, all)} onBulkSet={(vs) => setBulkFilter('subCategories', vs)} />
                    <EnhancedDropdown title="父ASIN" icon={<Box className="w-3 h-3"/>} options={availableOptions.parentAsins} selected={filters.parentAsins} onToggle={(v, all) => toggleFilter('parentAsins', v, all)} onBulkSet={(vs) => setBulkFilter('parentAsins', vs)} />
                    <EnhancedDropdown title="子ASIN" icon={<Hash className="w-3 h-3"/>} options={availableOptions.childAsins} selected={filters.childAsins} onToggle={(v, all) => toggleFilter('childAsins', v, all)} onBulkSet={(vs) => setBulkFilter('childAsins', vs)} />
                    <EnhancedDropdown title="品名" icon={<ShoppingBag className="w-3 h-3"/>} options={availableOptions.productNames} selected={filters.productNames} onToggle={(v, all) => toggleFilter('productNames', v, all)} onBulkSet={(vs) => setBulkFilter('productNames', vs)} />
                </div>
            </div>

            <div className="mt-auto border-t border-slate-800/80 bg-slate-950/45 px-5 py-4 backdrop-blur-sm">
                <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    <CalendarRange className="w-3.5 h-3.5" />
                    分析周期
                </div>
                <div className="grid grid-cols-2 gap-2 mb-3">
                    {!isWeeklyMode ? (
                        <>
                        <button onClick={handleLastMonth} className="flex items-center justify-center gap-1.5 rounded-2xl border border-slate-700 bg-slate-800/80 px-2 py-2 text-xs text-slate-300 transition-all hover:border-sky-500/60 hover:bg-sky-500/10 hover:text-white active:scale-95"><CalendarClock className="w-3 h-3" />上月</button>
                        <button onClick={handleThisMonth} className="flex items-center justify-center gap-1.5 rounded-2xl border border-slate-700 bg-slate-800/80 px-2 py-2 text-xs text-slate-300 transition-all hover:border-sky-500/60 hover:bg-sky-500/10 hover:text-white active:scale-95"><Calendar className="w-3 h-3" />本月</button>
                        </>
                    ) : (
                        <>
                        <button onClick={handleLastWeek} className="flex items-center justify-center gap-1.5 rounded-2xl border border-slate-700 bg-slate-800/80 px-2 py-2 text-xs text-slate-300 transition-all hover:border-sky-500/60 hover:bg-sky-500/10 hover:text-white active:scale-95"><History className="w-3 h-3" />上周</button>
                        <button onClick={handleThisWeek} className="flex items-center justify-center gap-1.5 rounded-2xl border border-slate-700 bg-slate-800/80 px-2 py-2 text-xs text-slate-300 transition-all hover:border-sky-500/60 hover:bg-sky-500/10 hover:text-white active:scale-95"><CalendarDays className="w-3 h-3" />本周</button>
                        </>
                    )}
                </div>
                <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                    <div className="flex items-center gap-2"><span className="text-[10px] text-slate-500 w-6 font-mono font-bold text-right">起</span><input type={isWeeklyMode ? 'text' : 'month'} value={startVal} onChange={(e) => handleDateChange('start', e.target.value)} placeholder={isWeeklyMode ? '2026-W15' : ''} title={isWeeklyMode ? '自然周：年-W周序号（周日为一周起点，第1周含1月1日）' : ''} className="bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-slate-200 flex-1 focus:border-sky-400 focus:ring-1 focus:ring-sky-400 outline-none transition-colors font-mono tracking-tight" /></div>
                    <div className="flex items-center gap-2"><span className="text-[10px] text-slate-500 w-6 font-mono font-bold text-right">止</span><input type={isWeeklyMode ? 'text' : 'month'} value={endVal} onChange={(e) => handleDateChange('end', e.target.value)} placeholder={isWeeklyMode ? '2026-W16' : ''} title={isWeeklyMode ? '自然周：年-W周序号' : ''} className="bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-slate-200 flex-1 focus:border-sky-400 focus:ring-1 focus:ring-sky-400 outline-none transition-colors font-mono tracking-tight" /></div>
                </div>
                {warnings.length > 0 && (
                    <div className="mt-3 rounded-2xl border border-amber-500/20 bg-amber-500/8 p-3 text-[10px]">
                        <div className="flex items-center gap-1 text-amber-300 mb-1 font-bold"><AlertCircle className="w-3 h-3" /><span>异常提醒</span></div>
                        <div className="text-amber-100/80 leading-tight pl-1">{warnings[0]} {warnings.length > 1 && `(+${warnings.length - 1})`}</div>
                    </div>
                )}
            </div>
            <div className="border-t border-slate-800/80 bg-slate-950/50 py-2 text-center font-mono text-[10px] tracking-[0.25em] text-slate-600">v1.3.18 - Ray</div>
        </div>
    );
};

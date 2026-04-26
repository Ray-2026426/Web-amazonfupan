import React, { useState, useEffect, useMemo, useRef } from 'react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { X, Calculator, Search, AlertCircle, ChevronDown, Check, ArrowRight, Layers, Box, ChevronRight, PieChart, Plus, Trash2, PackagePlus, Download, Loader2, Globe } from 'lucide-react';
import { DataRow, FilterState } from '../types';
// Fixed: Add missing formatPrice import
import { formatMoney, formatPercent, formatNumber, formatMoneyNoDecimals, getCurrencySymbol, formatPrice } from '../utils';

interface ProfitSimulatorModalProps {
    isOpen: boolean;
    onClose: () => void;
    rawData: DataRow[]; // Full dataset
    filters: FilterState; // To apply date filtering
    initialProduct?: string; // New
    initialCountry?: string; // New
}

// --- Helper: Searchable Select ---
const SearchableSelect = ({ options, value, onChange, placeholder, icon }: { options: string[], value: string, onChange: (v: string) => void, placeholder: string, icon?: React.ReactNode }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const filtered = options.filter(o => o.toLowerCase().includes(search.toLowerCase()));

    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isOpen]);

    return (
        <div className="relative w-full" ref={containerRef}>
            <div 
                onClick={() => setIsOpen(!isOpen)}
                className={`w-full border rounded-md px-3 py-2 text-sm flex justify-between items-center cursor-pointer transition-colors bg-white
                    ${value ? 'border-blue-300 text-slate-900 shadow-sm' : 'border-slate-300 text-slate-500'}
                `}
            >
                <div className="flex items-center gap-2 overflow-hidden">
                    {icon && <div className="text-slate-400">{icon}</div>}
                    <span className="truncate pr-2 font-medium">{value || placeholder}</span>
                </div>
                <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
            </div>
            
            {isOpen && (
                <div className="absolute left-0 top-full mt-1 z-[100] w-full bg-white border border-slate-200 rounded-md shadow-xl max-h-64 flex flex-col overflow-hidden">
                    <div className="p-2 bg-slate-50 border-b border-slate-100 flex-shrink-0">
                        <div className="relative">
                            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                            <input 
                                ref={inputRef}
                                className="w-full border border-slate-200 rounded pl-8 pr-2 py-1.5 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                placeholder="输入关键词搜索..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                onClick={e => e.stopPropagation()}
                            />
                        </div>
                    </div>
                    <div className="overflow-y-auto custom-scroll p-1 min-h-0 flex-1">
                        {filtered.length > 0 ? filtered.map(opt => (
                            <div 
                                key={opt}
                                className={`px-3 py-2 text-sm rounded cursor-pointer flex items-center justify-between group
                                    ${opt === value ? 'bg-blue-50 text-blue-600 font-medium' : 'text-slate-700 hover:bg-slate-50'}
                                `}
                                onClick={() => {
                                    onChange(opt);
                                    setIsOpen(false);
                                    setSearch('');
                                }}
                            >
                                <span className="truncate">{opt}</span>
                                {opt === value && <Check className="w-3.5 h-3.5" />}
                            </div>
                        )) : (
                            <div className="p-4 text-xs text-slate-400 text-center">无匹配结果</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

const InputGroup = ({ 
    label, 
    value, 
    onChange, 
    highlight = false, 
    isPercent = false, 
    price = 0, 
    tooltip,
    symbol = '$'
}: { 
    label: string, 
    value: string, 
    onChange: (v: string) => void, 
    highlight?: boolean, 
    isPercent?: boolean, 
    price?: number, 
    tooltip?: string,
    symbol?: string
}) => {
    const numVal = parseFloat(value) || 0;
    let subText = null;

    if (price > 0) {
        if (isPercent) {
            // If input is %, show calculated absolute value
            const abs = price * (numVal / 100);
            subText = `${symbol}${abs.toFixed(2)}`;
        } else {
            // If input is absolute, show calculated %
            const pct = (numVal / price) * 100;
            subText = `${pct.toFixed(1)}%`;
        }
    }

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
                <label className="text-[10px] font-medium text-slate-500 flex items-center gap-1 truncate" title={tooltip}>
                    {label}
                </label>
                {subText && <span className="text-[9px] text-slate-400 font-mono">{subText}</span>}
            </div>
            <div className="relative">
                <input 
                    type="number" 
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    className={`w-full border rounded px-2 py-1.5 text-xs outline-none focus:ring-2 transition-all font-mono font-bold
                        ${highlight 
                            ? 'border-blue-300 bg-blue-50 text-blue-700 focus:ring-blue-200' 
                            : 'border-slate-300 text-slate-700 focus:border-blue-500 focus:ring-blue-100'
                        }
                    `}
                />
                {isPercent && <div className="absolute right-2 top-1.5 text-[10px] text-slate-400">%</div>}
            </div>
        </div>
    );
};

// --- TYPES for Simulation ---
interface SimulationState {
    price: string;
    procurementCost: string;
    freightCost: string;
    fbaFee: string;
    commissionRate: string;
    storageRate: string;
    refundRate: string;
    adCvr: string;
    cpc: string;
    adOrderRatio: string;
}

// Default empty state
const defaultSimState: SimulationState = {
    price: '0', procurementCost: '0', freightCost: '0', fbaFee: '0',
    commissionRate: '15', storageRate: '1', refundRate: '5',
    adCvr: '10', cpc: '1.0', adOrderRatio: '30'
};

const calculateMetrics = (state: SimulationState) => {
    const numPrice = parseFloat(state.price) || 0;
    const numProc = parseFloat(state.procurementCost) || 0;
    const numFreight = parseFloat(state.freightCost) || 0;
    const numFba = parseFloat(state.fbaFee) || 0;
    const numComm = parseFloat(state.commissionRate) || 0;
    const numStorage = parseFloat(state.storageRate) || 0;
    const numRefund = parseFloat(state.refundRate) || 0;
    const numAdCvr = parseFloat(state.adCvr) || 0;
    const numCpc = parseFloat(state.cpc) || 0;
    const numAdOrderRatio = parseFloat(state.adOrderRatio) || 0;

    const baseCostRate = numPrice > 0 
        ? ((numProc + numFreight + numFba) / numPrice * 100) + numComm + numStorage + numRefund 
        : 0;

    const acos = (numPrice > 0 && numAdCvr > 0) ? numCpc / (numPrice * (numAdCvr / 100)) : 0;
    const acoas = acos * (numAdOrderRatio / 100);
    const profitMargin = 1 - (baseCostRate / 100) - acoas;

    return { baseCostRate, acos, acoas, profitMargin, numPrice };
};

export const ProfitSimulatorModal: React.FC<ProfitSimulatorModalProps> = ({ isOpen, onClose, rawData, filters, initialProduct, initialCountry }) => {
    
    const [mode, setMode] = useState<'single' | 'parent' | 'new_product'>('single');
    const [selectedCountry, setSelectedCountry] = useState<string>('');
    const [selectedProduct, setSelectedProduct] = useState<string>('');
    const [selectedParentAsin, setSelectedParentAsin] = useState<string>('');
    const [singleState, setSingleState] = useState<SimulationState>(defaultSimState);
    const [childStates, setChildStates] = useState<Record<string, SimulationState>>({});
    const [childMeta, setChildMeta] = useState<Record<string, { qty: number, name: string, sales: number }>>({});
    const [childMix, setChildMix] = useState<Record<string, number>>({}); 
    const [expandedChild, setExpandedChild] = useState<string | null>(null);
    const [isExporting, setIsExporting] = useState(false);
    const reportRef = useRef<HTMLDivElement>(null);

    // Auto-fill from props when opening
    useEffect(() => {
        if (isOpen) {
            if (initialCountry) setSelectedCountry(initialCountry);
            if (initialProduct) setSelectedProduct(initialProduct);
            // Default to single or keep current if valid
            setMode(initialProduct ? 'single' : 'single');
        }
    }, [isOpen, initialProduct, initialCountry]);

    // 1. Filter Raw Data by Time Range
    const periodData = useMemo(() => {
        if (!filters.startDate || !filters.endDate) return rawData;
        return rawData.filter(r => r.date >= filters.startDate && r.date <= filters.endDate);
    }, [rawData, filters.startDate, filters.endDate]);

    // Options Logic
    const options = useMemo(() => {
        const countries = Array.from(new Set(periodData.map(r => r.country).filter(Boolean))).sort();
        
        // Ensure "新品测算" has access to all major markets even if no data uploaded
        const majorMarkets = ['美国', '英国', '德国', '法国', '意大利', '西班牙', '加拿大', '墨西哥', '日本', '澳大利亚'];
        const allCountries = Array.from(new Set([...countries, ...majorMarkets])).sort();

        let filteredByCountry = periodData;
        if (selectedCountry) {
            filteredByCountry = periodData.filter(r => r.country === selectedCountry);
        }
        const products = Array.from(new Set(filteredByCountry.map(r => r.product_name).filter(Boolean))).sort();
        const parents = Array.from(new Set(filteredByCountry.map(r => r.parent_asin).filter(p => p && p !== 'Unknown'))).sort();
        
        return { 
            countries: mode === 'new_product' ? allCountries : countries, 
            products, 
            parents 
        };
    }, [periodData, selectedCountry, mode]);

    const currentSymbol = useMemo(() => getCurrencySymbol(selectedCountry || '美国'), [selectedCountry]);

    // --- Helper: Extract Sim State from Data Rows ---
    const extractStateFromRows = (rows: DataRow[]): SimulationState => {
        if (rows.length === 0) return defaultSimState;

        let totalSales = 0; let totalQty = 0; let totalAdSpend = 0; let totalAdOrders = 0; let totalClicks = 0;
        let totalProc = 0; let totalFirst = 0; let totalFba = 0;
        let totalComm = 0; let totalStor = 0; let totalRef = 0;

        rows.forEach(r => {
            totalSales += r.sales_amount; totalQty += r.sales_quantity;
            totalAdSpend += r.ad_spend; totalAdOrders += r.ad_orders; totalClicks += r.clicks;
            totalProc += r.procurement_cost; totalFirst += r.first_mile_cost; totalFba += r.fba_fee;
            totalComm += r.platform_commission; totalStor += r.storage_fee; totalRef += r.refund_cost;
        });

        const avgPrice = totalQty > 0 ? totalSales / totalQty : 0;
        
        return {
            price: avgPrice.toFixed(2),
            procurementCost: (totalQty > 0 ? totalProc / totalQty : 0).toFixed(2),
            freightCost: (totalQty > 0 ? totalFirst / totalQty : 0).toFixed(2),
            fbaFee: (totalQty > 0 ? totalFba / totalQty : 0).toFixed(2),
            commissionRate: (totalSales > 0 ? (totalComm / totalSales) * 100 : 0).toFixed(2),
            storageRate: (totalSales > 0 ? (totalStor / totalSales) * 100 : 0).toFixed(2),
            refundRate: (totalSales > 0 ? (totalRef / totalSales) * 100 : 0).toFixed(2),
            adCvr: (totalClicks > 0 ? (totalAdOrders / totalClicks) * 100 : 0).toFixed(2),
            cpc: (totalClicks > 0 ? totalAdSpend / totalClicks : 0).toFixed(2),
            adOrderRatio: (totalQty > 0 ? (totalAdOrders / totalQty) * 100 : 0).toFixed(2)
        };
    };

    // --- Effect: Load Single Mode Data ---
    useEffect(() => {
        if (mode !== 'single' || !selectedProduct || !selectedCountry) return;
        const rows = periodData.filter(r => r.product_name === selectedProduct && r.country === selectedCountry);
        setSingleState(extractStateFromRows(rows));
    }, [mode, selectedProduct, selectedCountry, periodData]);

    // --- Effect: Load Parent Mode Data ---
    useEffect(() => {
        if (mode !== 'parent' || !selectedParentAsin || !selectedCountry) return;
        
        const parentRows = periodData.filter(r => r.parent_asin === selectedParentAsin && r.country === selectedCountry);
        const groups: Record<string, DataRow[]> = {};
        const meta: Record<string, { qty: number, name: string, sales: number }> = {};
        const states: Record<string, SimulationState> = {};
        let totalParentQty = 0;

        parentRows.forEach(r => {
            const key = r.product_name || r.child_asin;
            if (!groups[key]) groups[key] = [];
            groups[key].push(r);
        });

        Object.keys(groups).forEach(key => {
            const rows = groups[key];
            const qty = rows.reduce((s, r) => s + r.sales_quantity, 0);
            const sales = rows.reduce((s, r) => s + r.sales_amount, 0);
            
            if (qty > 0) {
                meta[key] = { qty, name: key, sales };
                states[key] = extractStateFromRows(rows);
                totalParentQty += qty;
            }
        });

        const initialMix: Record<string, number> = {};
        Object.keys(meta).forEach(k => {
            const item = meta[k];
            initialMix[k] = totalParentQty > 0 ? (item.qty / totalParentQty) * 100 : 0;
        });

        setChildMeta(meta);
        setChildStates(states);
        setChildMix(initialMix); 
        const keys = Object.keys(states);
        if (keys.length > 0) setExpandedChild(keys[0]);

    }, [mode, selectedParentAsin, selectedCountry, periodData]);

    // --- Switch Mode Handlers ---
    const handleSwitchMode = (newMode: 'single' | 'parent' | 'new_product') => {
        setMode(newMode);
        
        if (newMode === 'new_product') {
            const id = `var-${Date.now()}`;
            setChildStates({ [id]: { ...defaultSimState, price: '19.99' } });
            setChildMeta({ [id]: { qty: 100, name: '新品变体 1', sales: 0 } });
            setChildMix({ [id]: 100 });
            setExpandedChild(id);
        }
    };

    const handleAddVariant = () => {
        const id = `var-${Date.now()}`;
        setChildStates(prev => ({ ...prev, [id]: defaultSimState }));
        setChildMeta(prev => {
            const newMeta = { ...prev, [id]: { qty: 100, name: `新品变体 ${Object.keys(prev).length + 1}`, sales: 0 } };
            updateMix(newMeta);
            return newMeta;
        });
        setExpandedChild(id);
    };

    const handleRemoveVariant = (id: string) => {
        if (Object.keys(childStates).length <= 1) return; 
        const { [id]: _, ...newStates } = childStates;
        const { [id]: __, ...newMeta } = childMeta;
        setChildStates(newStates);
        setChildMeta(newMeta);
        updateMix(newMeta);
    };

    const handleUpdateVariantMeta = (id: string, field: 'name' | 'qty', val: string | number) => {
        setChildMeta(prev => {
            const updated = { ...prev, [id]: { ...prev[id], [field]: val } };
            if (field === 'qty') updateMix(updated);
            return updated;
        });
    };

    const updateMix = (metaMap: Record<string, { qty: number }>) => {
        const totalQty = Object.values(metaMap).reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
        const newMix: Record<string, number> = {};
        Object.keys(metaMap).forEach(k => {
            newMix[k] = totalQty > 0 ? (Number(metaMap[k].qty) / totalQty) * 100 : 0;
        });
        setChildMix(newMix);
    };


    // --- Aggregation Logic for Parent Mode ---
    const parentAggregates = useMemo(() => {
        if (mode === 'single') {
            const m = calculateMetrics(singleState);
            return {
                netMargin: m.profitMargin,
                grossProfit: m.numPrice * m.profitMargin, 
                baseCostRate: m.baseCostRate,
                acoas: m.acoas,
                acos: m.acos,
                totalRevenue: 0,
                isSingle: true
            };
        } else {
            let totalRevenue = 0;
            let totalProfit = 0;
            let totalBaseCost = 0;
            let totalAdSpend = 0;
            let totalAdSales = 0; 
            
            const totalParentQty = (Object.values(childMeta) as { qty: number }[]).reduce((a: number, b) => a + Number(b.qty), 0);

            Object.keys(childStates).forEach(key => {
                const state = childStates[key];
                const m = calculateMetrics(state);
                const mixPct = childMix[key] || 0; 
                
                const simQty = totalParentQty * (mixPct / 100);

                const simRevenue = m.numPrice * simQty;
                const simProfit = simRevenue * m.profitMargin;
                const simBaseCost = simRevenue * (m.baseCostRate / 100);
                const simAdSpend = simRevenue * m.acoas;
                const simAdSales = simRevenue * (parseFloat(state.adOrderRatio) / 100);

                totalRevenue += simRevenue;
                totalProfit += simProfit;
                totalBaseCost += simBaseCost;
                totalAdSpend += simAdSpend;
                totalAdSales += simAdSales;
            });

            const parentMargin = totalRevenue > 0 ? totalProfit / totalRevenue : 0;
            const parentBaseRate = totalRevenue > 0 ? (totalBaseCost / totalRevenue) * 100 : 0;
            const parentAcoas = totalRevenue > 0 ? totalAdSpend / totalRevenue : 0;
            const parentAcos = totalAdSales > 0 ? totalAdSpend / totalAdSales : 0;
            
            return {
                netMargin: parentMargin,
                grossProfit: totalProfit, 
                baseCostRate: parentBaseRate,
                acoas: parentAcoas,
                acos: parentAcos, 
                totalRevenue,
                isSingle: false
            };
        }
    }, [mode, singleState, childStates, childMeta, childMix]);

    // --- Export PDF Report ---
    const handleExportReport = async () => {
        if (!reportRef.current) return;
        setIsExporting(true);
        try {
            const canvas = await html2canvas(reportRef.current, {
                scale: 2, 
                backgroundColor: '#ffffff',
            });
            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4'
            });
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
            pdf.save(`利润模型测算报告_${mode}_${new Date().toISOString().slice(0,10)}.pdf`);
        } catch (e) {
            console.error('Export failed', e);
            alert('导出失败，请重试');
        } finally {
            setIsExporting(false);
        }
    };

    // --- Renderers ---

    const renderInputForm = (state: SimulationState, setter: (s: SimulationState) => void, compact = false) => (
        <div className={`grid grid-cols-1 ${compact ? 'gap-3' : 'lg:grid-cols-2 gap-6'}`}>
            <div className="bg-white rounded-lg border border-slate-100 p-4 space-y-3">
                <h3 className="text-xs font-bold text-slate-700 flex items-center gap-2 border-b border-slate-50 pb-2">
                    <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-[10px] font-bold">1</span>
                    产品与成本 ({selectedCountry || '美国'})
                </h3>
                <InputGroup label={`预计售价 (${currentSymbol})`} value={state.price} onChange={v => setter({...state, price: v})} highlight price={parseFloat(state.price)} symbol={currentSymbol} />
                <div className="grid grid-cols-2 gap-3">
                    <InputGroup label={`采购 (${currentSymbol})`} value={state.procurementCost} onChange={v => setter({...state, procurementCost: v})} price={parseFloat(state.price)} symbol={currentSymbol} />
                    <InputGroup label={`头程 (${currentSymbol})`} value={state.freightCost} onChange={v => setter({...state, freightCost: v})} price={parseFloat(state.price)} symbol={currentSymbol} />
                    <InputGroup label={`FBA (${currentSymbol})`} value={state.fbaFee} onChange={v => setter({...state, fbaFee: v})} price={parseFloat(state.price)} symbol={currentSymbol} />
                    <InputGroup label="佣金 %" value={state.commissionRate} onChange={v => setter({...state, commissionRate: v})} isPercent price={parseFloat(state.price)} symbol={currentSymbol} />
                    <InputGroup label="仓储 %" value={state.storageRate} onChange={v => setter({...state, storageRate: v})} isPercent price={parseFloat(state.price)} symbol={currentSymbol} />
                    <InputGroup label="退款 %" value={state.refundRate} onChange={v => setter({...state, refundRate: v})} isPercent price={parseFloat(state.price)} symbol={currentSymbol} />
                </div>
            </div>
            <div className="bg-white rounded-lg border border-slate-100 p-4 space-y-3">
                <h3 className="text-xs font-bold text-slate-700 flex items-center gap-2 border-b border-slate-50 pb-2">
                    <span className="w-4 h-4 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[10px] font-bold">2</span>
                    广告模型
                </h3>
                <div className="grid grid-cols-2 gap-3">
                    <InputGroup label={`CPC (${currentSymbol})`} value={state.cpc} onChange={v => setter({...state, cpc: v})} symbol={currentSymbol} />
                    <InputGroup label="广告CVR %" value={state.adCvr} onChange={v => setter({...state, adCvr: v})} isPercent />
                    <div className="col-span-2">
                        <InputGroup label="广告订单占比 % (ASOAS)" value={state.adOrderRatio} onChange={v => setter({...state, adOrderRatio: v})} isPercent tooltip="广告订单量 / 总销量" />
                    </div>
                </div>
            </div>
        </div>
    );

    if (!isOpen) return null;

    const summaryData = parentAggregates;
    const totalMix = (Object.values(childMix) as number[]).reduce((a: number, b: number) => a + b, 0);

    return (
        <div className="fixed inset-0 z-[120] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in zoom-in duration-200">
            <div className="bg-white w-full max-w-6xl rounded-xl shadow-2xl overflow-hidden border border-slate-200 flex flex-col max-h-[95vh]">
                
                {/* Header */}
                <div className="bg-gradient-to-r from-blue-600 to-indigo-700 px-6 py-4 flex items-center justify-between text-white flex-shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <div className="bg-white/20 p-2 rounded-lg backdrop-blur-sm">
                                <Calculator className="w-5 h-5 text-white" />
                            </div>
                            <h2 className="text-lg font-bold">利润模型试算</h2>
                        </div>
                        
                        {/* Mode Toggle */}
                        <div className="flex bg-slate-900/30 p-1 rounded-lg">
                            <button 
                                onClick={() => handleSwitchMode('single')}
                                className={`px-3 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1
                                    ${mode === 'single' ? 'bg-white text-blue-700 shadow' : 'text-blue-100 hover:bg-white/10'}
                                `}
                            >
                                <Box className="w-3 h-3" /> 单品测算
                            </button>
                            <button 
                                onClick={() => handleSwitchMode('parent')}
                                className={`px-3 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1
                                    ${mode === 'parent' ? 'bg-white text-blue-700 shadow' : 'text-blue-100 hover:bg-white/10'}
                                `}
                            >
                                <Layers className="w-3 h-3" /> 父体聚合
                            </button>
                            <button 
                                onClick={() => handleSwitchMode('new_product')}
                                className={`px-3 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1
                                    ${mode === 'new_product' ? 'bg-white text-blue-700 shadow' : 'text-blue-100 hover:bg-white/10'}
                                `}
                            >
                                <PackagePlus className="w-3 h-3" /> 新品测算
                            </button>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="text-[10px] bg-white/10 px-2 py-1 rounded text-blue-100 hidden sm:block">
                            数据基准: {filters.startDate} ~ {filters.endDate}
                        </div>
                        <button 
                            onClick={handleExportReport}
                            disabled={isExporting}
                            className="p-1.5 hover:bg-white/20 rounded-full transition-colors text-blue-100 hover:text-white disabled:opacity-50"
                            title="导出测算报告 (PDF)"
                        >
                            {isExporting ? <Loader2 className="w-5 h-5 animate-spin"/> : <Download className="w-5 h-5" />}
                        </button>
                        <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-full transition-colors">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Filters */}
                <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 z-20 flex-shrink-0 grid grid-cols-12 gap-4 items-end">
                    <div className="col-span-3">
                        <label className="block text-xs font-bold text-slate-500 mb-1">选择站点 (Marketplace)</label>
                        <SearchableSelect 
                            options={options.countries}
                            value={selectedCountry}
                            onChange={setSelectedCountry}
                            placeholder="-- 站点 --"
                            icon={<Globe className="w-3.5 h-3.5" />}
                        />
                    </div>
                    {mode !== 'new_product' && (
                        <div className="col-span-6">
                            <label className="block text-xs font-bold text-slate-500 mb-1">
                                {mode === 'single' ? '选择子品名 (Product)' : '选择父ASIN (Parent)'}
                            </label>
                            <SearchableSelect 
                                options={mode === 'single' ? options.products : options.parents}
                                value={mode === 'single' ? selectedProduct : selectedParentAsin}
                                onChange={mode === 'single' ? setSelectedProduct : setSelectedParentAsin}
                                placeholder={mode === 'single' ? "-- 品名 --" : "-- 父ASIN --"}
                            />
                        </div>
                    )}
                    {mode === 'new_product' && (
                        <div className="col-span-6 flex items-center text-xs text-slate-400">
                            * 已自动匹配货币：<span className="font-bold text-blue-600 ml-1">{currentSymbol}</span>。添加变体以模拟新品。
                        </div>
                    )}
                </div>

                {/* Main Content */}
                <div className="flex-1 overflow-hidden flex relative bg-slate-100">
                    
                    {/* Left: Input Area */}
                    <div className="flex-1 overflow-y-auto custom-scroll p-6">
                        {mode !== 'new_product' && (!selectedCountry || (mode === 'single' ? !selectedProduct : !selectedParentAsin)) ? (
                            <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2">
                                <Search className="w-10 h-10 opacity-20" />
                                <p className="text-sm">请先完成上方筛选</p>
                            </div>
                        ) : mode === 'single' ? (
                            renderInputForm(singleState, setSingleState)
                        ) : (
                            <div className="space-y-4">
                                <div className="flex items-center justify-between text-xs text-slate-500 px-1 bg-white p-2 rounded-lg border border-slate-200 shadow-sm">
                                    <div className="flex gap-4 items-center">
                                        <span>共 {Object.keys(childStates).length} 个子变体</span>
                                        <span>总销量基数: {formatNumber((Object.values(childMeta) as { qty: number }[]).reduce((a: number,b)=>a+Number(b.qty),0))}</span>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        {mode === 'new_product' && (
                                            <button 
                                                onClick={handleAddVariant}
                                                className="flex items-center gap-1 bg-blue-600 text-white px-2 py-1 rounded text-xs hover:bg-blue-700 transition-colors shadow-sm"
                                            >
                                                <Plus className="w-3 h-3" /> 添加变体
                                            </button>
                                        )}
                                        <div className={`font-mono font-bold ${Math.abs(totalMix - 100) < 0.1 ? 'text-green-600' : 'text-orange-500'}`}>
                                            权重合计: {totalMix.toFixed(1)}%
                                        </div>
                                    </div>
                                </div>
                                {Object.keys(childStates).map(childId => {
                                    const meta = childMeta[childId];
                                    const state = childStates[childId];
                                    const isExpanded = expandedChild === childId;
                                    const m = calculateMetrics(state);

                                    return (
                                        <div key={childId} className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden transition-all">
                                            <div 
                                                className={`p-3 flex items-center justify-between cursor-pointer hover:bg-slate-50 ${isExpanded ? 'bg-slate-50 border-b border-slate-100' : ''}`}
                                                onClick={() => setExpandedChild(isExpanded ? null : childId)}
                                            >
                                                <div className="flex items-center gap-3 overflow-hidden flex-1">
                                                    <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-2">
                                                            {mode === 'new_product' ? (
                                                                <input 
                                                                    className="text-sm font-bold text-slate-700 border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none bg-transparent max-w-[200px]"
                                                                    value={meta.name}
                                                                    onClick={e => e.stopPropagation()}
                                                                    onChange={e => handleUpdateVariantMeta(childId, 'name', e.target.value)}
                                                                />
                                                            ) : (
                                                                <div className="text-sm font-bold text-slate-700 truncate max-w-[250px]" title={meta.name}>{meta.name}</div>
                                                            )}
                                                        </div>
                                                        <div className="text-[10px] text-slate-400 flex gap-2 items-center mt-1">
                                                            {mode === 'new_product' ? (
                                                                <div className="flex items-center bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded border border-blue-100" onClick={e => e.stopPropagation()}>
                                                                    <span>销量:</span>
                                                                    <input 
                                                                        type="number"
                                                                        className="w-12 bg-transparent text-xs font-bold text-blue-700 outline-none text-right ml-1 border-b border-blue-200 focus:border-blue-500"
                                                                        value={meta.qty}
                                                                        onChange={e => handleUpdateVariantMeta(childId, 'qty', e.target.value)}
                                                                    />
                                                                </div>
                                                            ) : (
                                                                <span className="bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">销量: {meta.qty}</span>
                                                            )}
                                                            
                                                            <div className="flex items-center bg-slate-100 rounded px-1.5 py-0.5 border border-slate-200 hover:border-blue-300 transition-colors" onClick={e => e.stopPropagation()}>
                                                                <PieChart className="w-3 h-3 text-slate-500 mr-1" />
                                                                <input 
                                                                    type="number"
                                                                    className="w-10 bg-transparent text-xs font-bold text-slate-700 outline-none text-right appearance-none"
                                                                    value={childMix[childId]?.toFixed(1) || '0'}
                                                                    disabled={mode === 'new_product'}
                                                                    onChange={(e) => {
                                                                        const v = parseFloat(e.target.value);
                                                                        setChildMix(prev => ({...prev, [childId]: isNaN(v) ? 0 : v}));
                                                                    }}
                                                                    step={0.1}
                                                                />
                                                                <span className="text-[10px] text-slate-500 ml-0.5">%</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                                
                                                <div className="flex items-center gap-4 text-right">
                                                    <div>
                                                        <div className="text-[10px] text-slate-400">预估毛利</div>
                                                        <div className={`text-sm font-mono font-bold ${m.profitMargin < 0 ? 'text-red-500' : 'text-green-600'}`}>
                                                            {formatPercent(m.profitMargin)}
                                                        </div>
                                                    </div>
                                                    <div className="w-px h-6 bg-slate-100"></div>
                                                    <div>
                                                        <div className="text-[10px] text-slate-400">ACOS</div>
                                                        <div className="text-sm font-mono text-slate-600">{formatPercent(m.acos)}</div>
                                                    </div>
                                                    <div className="w-px h-6 bg-slate-100"></div>
                                                    <div>
                                                        <div className="text-[10px] text-slate-400">ACoAS</div>
                                                        <div className="text-sm font-mono text-slate-600">{formatPercent(m.acoas)}</div>
                                                    </div>
                                                    {mode === 'new_product' && (
                                                        <button 
                                                            onClick={(e) => { e.stopPropagation(); handleRemoveVariant(childId); }}
                                                            className="p-1.5 hover:bg-red-50 rounded-full text-slate-400 hover:text-red-500 transition-colors ml-2"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                            
                                            {isExpanded && (
                                                <div className="p-4 bg-slate-50/50 border-t border-slate-100 animate-in slide-in-from-top-2 duration-200">
                                                    {renderInputForm(state, (newState) => {
                                                        setChildStates(prev => ({ ...prev, [childId]: newState }));
                                                    }, true)}
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>

                    {/* Right: Summary Panel (Sticky) */}
                    <div className="w-80 bg-white border-l border-slate-200 shadow-xl flex flex-col z-20">
                        <div className="p-6 space-y-6">
                            <div className="text-center border-b border-slate-100 pb-6">
                                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                                    {mode === 'single' ? '预估毛利率 (Net Margin)' : '父体综合毛利率 (Weighted)'}
                                </h3>
                                <div className={`text-4xl font-bold font-mono tracking-tight
                                    ${summaryData.netMargin >= 0.15 ? 'text-green-500' : (summaryData.netMargin > 0 ? 'text-yellow-500' : 'text-red-500')}
                                `}>
                                    {(summaryData.netMargin * 100).toFixed(2)}%
                                </div>
                                <div className="text-xs text-slate-400 mt-2 font-mono">
                                    {mode === 'single' 
                                        ? `${formatPrice(summaryData.grossProfit, selectedCountry)} / unit`
                                        : `总预估毛利: ${formatMoney(summaryData.grossProfit, selectedCountry)}`
                                    }
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="space-y-1">
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="text-slate-500">综合成本率 (COGS+Fees)</span>
                                        <span className="font-mono font-bold text-slate-700">{summaryData.baseCostRate.toFixed(2)}%</span>
                                    </div>
                                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                        <div className="h-full bg-slate-400" style={{ width: `${Math.min(summaryData.baseCostRate, 100)}%` }} />
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="text-slate-500">综合广告费率 (ACoAS)</span>
                                        <div className="flex gap-2 text-xs">
                                            <span className="text-slate-400" title="ACOS">ACOS: {(summaryData.acos * 100).toFixed(2)}%</span>
                                            <span className="font-mono font-bold text-slate-700">{(summaryData.acoas * 100).toFixed(2)}%</span>
                                        </div>
                                    </div>
                                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                        <div className="h-full bg-indigo-500" style={{ width: `${Math.min(summaryData.acoas * 100, 100)}%` }} />
                                    </div>
                                </div>
                                
                                {mode !== 'single' && (
                                    <div className="pt-4 mt-4 border-t border-slate-100">
                                        <div className="flex justify-between items-center text-xs text-slate-500 mb-1">
                                            <span>总预估营收</span>
                                            <span className="font-mono font-bold text-slate-700">{formatMoney(summaryData.totalRevenue, selectedCountry)}</span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700 leading-relaxed border border-blue-100">
                                <div className="font-bold mb-1 flex items-center gap-1">
                                    <Check className="w-3 h-3" /> 
                                    {mode === 'single' ? '单品诊断' : (mode === 'new_product' ? '新品模型诊断' : '父体诊断')}
                                </div>
                                {summaryData.netMargin < 0 ? (
                                    "模型亏损。建议重点检查" + (mode !== 'single' ? "负毛利子体" : "各项成本") + "。"
                                ) : summaryData.netMargin < 0.15 ? (
                                    "利润微薄，需精细化运营，控制广告占比。"
                                ) : (
                                    "利润模型健康，具备推广潜力。"
                                )}
                            </div>
                        </div>
                    </div>

                </div>
            </div>

            {/* Hidden Report Template for PDF Generation */}
            <div className="absolute top-0 left-0 -z-50 opacity-0 pointer-events-none">
                <div ref={reportRef} className="w-[800px] bg-white p-10 font-sans text-slate-800">
                    <div className="flex justify-between items-center border-b-2 border-slate-800 pb-4 mb-6">
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight">利润模型测算报告</h1>
                            <div className="text-sm text-slate-500 mt-1">Amazon Profit Simulation Report</div>
                        </div>
                        <div className="text-right text-xs text-slate-400">
                            <div>生成时间: {new Date().toLocaleDateString()}</div>
                            <div>Power by Ray Analytics</div>
                        </div>
                    </div>

                    <div className="grid grid-cols-4 gap-4 mb-8 bg-slate-50 p-4 rounded-lg border border-slate-100">
                        <div>
                            <div className="text-xs text-slate-400 mb-1">测算模式</div>
                            <div className="font-bold text-sm text-slate-800">{mode === 'single' ? '单品测算' : (mode === 'parent' ? '父体聚合' : '新品测算')}</div>
                        </div>
                        <div>
                            <div className="text-xs text-slate-400 mb-1">国家/站点</div>
                            <div className="font-bold text-sm text-slate-800">{selectedCountry || '-'}</div>
                        </div>
                        <div className="col-span-2">
                            <div className="text-xs text-slate-400 mb-1">标的对象 (Product/Parent)</div>
                            <div className="font-bold text-sm text-slate-800 truncate">{mode === 'single' ? selectedProduct : (mode === 'parent' ? selectedParentAsin : '自定义新品')}</div>
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-6 mb-8">
                        <div className="p-4 rounded-lg border border-slate-200">
                            <div className="text-xs text-slate-500 mb-2">总预估营收</div>
                            <div className="text-2xl font-bold text-slate-800 font-mono">{formatMoneyNoDecimals(summaryData.totalRevenue, selectedCountry)}</div>
                        </div>
                        <div className="p-4 rounded-lg border border-slate-200">
                            <div className="text-xs text-slate-500 mb-2">总预估毛利</div>
                            <div className={`text-2xl font-bold font-mono ${summaryData.grossProfit >= 0 ? 'text-green-600' : 'text-red-500'}`}>{formatMoneyNoDecimals(summaryData.grossProfit, selectedCountry)}</div>
                        </div>
                        <div className="p-4 rounded-lg border border-slate-200">
                            <div className="text-xs text-slate-500 mb-2">净毛利率 (Net Margin)</div>
                            <div className={`text-2xl font-bold font-mono ${summaryData.netMargin >= 0.15 ? 'text-green-600' : 'text-yellow-600'}`}>{formatPercent(summaryData.netMargin)}</div>
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-6 mb-8 text-sm">
                        <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                            <span className="text-slate-500">基础成本率</span>
                            <span className="font-mono font-bold">{summaryData.baseCostRate.toFixed(2)}%</span>
                        </div>
                        <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                            <span className="text-slate-500">广告费率 (ACoAS)</span>
                            <span className="font-mono font-bold">{formatPercent(summaryData.acoas)}</span>
                        </div>
                        <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                            <span className="text-slate-500">广告投产比 (ACOS)</span>
                            <span className="font-mono font-bold">{formatPercent(summaryData.acos)}</span>
                        </div>
                    </div>

                    <div className="mt-8">
                        <h3 className="text-sm font-bold text-slate-700 mb-4 border-l-4 border-blue-600 pl-2">变体明细数据</h3>
                        <table className="w-full text-xs text-left">
                            <thead className="bg-slate-100 text-slate-600">
                                <tr>
                                    <th className="p-2 border-b">变体名称</th>
                                    <th className="p-2 border-b text-right">预估销量</th>
                                    <th className="p-2 border-b text-right">售价 ({currentSymbol})</th>
                                    <th className="p-2 border-b text-right">毛利率</th>
                                    <th className="p-2 border-b text-right">ACOS</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {Object.keys(childStates).map(key => {
                                    const meta = childMeta[key];
                                    const state = childStates[key];
                                    const m = calculateMetrics(state);
                                    return (
                                        <tr key={key}>
                                            <td className="p-2 truncate max-w-[200px] font-medium">{meta.name}</td>
                                            <td className="p-2 text-right font-mono">{meta.qty}</td>
                                            <td className="p-2 text-right font-mono">{state.price}</td>
                                            <td className={`p-2 text-right font-mono font-bold ${m.profitMargin >= 0 ? 'text-green-600' : 'text-red-500'}`}>{formatPercent(m.profitMargin)}</td>
                                            <td className="p-2 text-right font-mono">{formatPercent(m.acos)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};
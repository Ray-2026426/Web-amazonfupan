
import React, { useState, useMemo } from 'react';
import { DataRow, TargetRow } from '../types';
import { X, CheckCircle, AlertTriangle, Stethoscope, Target, FileText, BarChart3, Search } from 'lucide-react';
import { formatNumber, formatMoney } from '../utils';

interface DataDoctorProps {
    isOpen: boolean;
    onClose: () => void;
    monthlyData: DataRow[];
    weeklyData: DataRow[];
    targetData?: TargetRow[]; // Add targetData
}

export const DataDoctor: React.FC<DataDoctorProps> = ({ isOpen, onClose, monthlyData, weeklyData, targetData = [] }) => {
    const [activeTab, setActiveTab] = useState<'monthly' | 'weekly' | 'target'>('target'); // Default to target as user has issues there

    if (!isOpen) return null;

    // --- Logic for Target Inspection ---
    const targetReport = useMemo(() => {
        if (targetData.length === 0) return null;

        const brandStats: Record<string, { totalTarget: number, count: number, example: any }> = {};
        
        // 1. Aggregate Target Data by Brand
        targetData.forEach(t => {
            const b = t.brand || 'Unknown';
            if (!brandStats[b]) brandStats[b] = { totalTarget: 0, count: 0, example: t };
            brandStats[b].totalTarget += t.sales_amount_target;
            brandStats[b].count++;
        });

        // 2. Cross Check with Performance Data
        const existingBrands = new Set<string>();
        monthlyData.forEach(d => existingBrands.add(d.brand));
        
        const rows = Object.entries(brandStats).map(([brand, stats]) => {
            const existsInPerf = existingBrands.has(brand);
            return {
                brand,
                ...stats,
                status: existsInPerf ? 'Matched' : 'Ghost' // "Ghost" means in Target but not in Performance
            };
        }).sort((a, b) => b.totalTarget - a.totalTarget);

        return { rows, total: targetData.length };
    }, [targetData, monthlyData]);


    const runChecks = (data: DataRow[], type: string) => {
        const issues: string[] = [];
        if (data.length === 0) return { count: 0, issues: ["无数据 (请检查是否已上传文件)"], sample: null };

        let decimalCount = 0;
        data.forEach(r => { if (r.sales_quantity % 1 !== 0) decimalCount++; });
        if (decimalCount > 0) issues.push(`⚠️ 销量字段存在小数 (${decimalCount}行)。`);

        const invalidDates = data.filter(r => !r.date || r.date.length < 10).length;
        if (invalidDates > 0) issues.push(`⚠️ 日期解析失败 (${invalidDates}行)。`);

        const sample = data[0];
        if (type === '周度' && data.length > 0 && !(sample as any).week_str && !sample.date) {
             issues.push(`⚠️ 周维度标识生成失败。`);
        }

        return { count: data.length, issues, sample };
    };

    const monthlyReport = runChecks(monthlyData, '月度');
    const weeklyReport = runChecks(weeklyData, '周度');

    const RenderSample = ({ report }: { report: any }) => (
        <div className="bg-slate-50 p-3 rounded border border-slate-100 mt-2">
            <div className="text-[10px] text-slate-400 mb-1 font-bold uppercase">首行样本</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
                <div className="flex justify-between"><span>日期:</span> <span className="font-mono">{report.sample.date}</span></div>
                <div className="flex justify-between"><span>ASIN:</span> <span className="font-mono truncate max-w-[80px]">{report.sample.child_asin}</span></div>
                <div className="flex justify-between"><span>销量:</span> <span className="font-mono">{report.sample.sales_quantity}</span></div>
                <div className="flex justify-between"><span>销售额:</span> <span className="font-mono">{report.sample.sales_amount}</span></div>
            </div>
        </div>
    );

    return (
        <div className="fixed inset-0 z-[200] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in zoom-in duration-200">
            <div className="bg-white w-full max-w-2xl h-[80vh] rounded-xl shadow-2xl overflow-hidden flex flex-col">
                <div className="bg-slate-800 px-6 py-4 flex items-center justify-between text-white flex-shrink-0">
                    <div className="flex items-center gap-2">
                        <Stethoscope className="w-5 h-5 text-green-400" />
                        <h2 className="text-lg font-bold">数据透视与诊断</h2>
                    </div>
                    <button onClick={onClose} className="hover:text-slate-300"><X className="w-5 h-5" /></button>
                </div>

                <div className="flex bg-slate-100 border-b border-slate-200 p-1">
                    <button onClick={() => setActiveTab('target')} className={`flex-1 py-2 text-xs font-bold rounded-md flex items-center justify-center gap-2 transition-all ${activeTab === 'target' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}>
                        <Target className="w-4 h-4" /> 目标透视 (Target)
                    </button>
                    <button onClick={() => setActiveTab('monthly')} className={`flex-1 py-2 text-xs font-bold rounded-md flex items-center justify-center gap-2 transition-all ${activeTab === 'monthly' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}>
                        <FileText className="w-4 h-4" /> 月度数据
                    </button>
                    <button onClick={() => setActiveTab('weekly')} className={`flex-1 py-2 text-xs font-bold rounded-md flex items-center justify-center gap-2 transition-all ${activeTab === 'weekly' ? 'bg-white text-purple-600 shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}>
                        <BarChart3 className="w-4 h-4" /> 周度数据
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto custom-scroll p-6 bg-white">
                    {activeTab === 'target' && (
                        <div className="space-y-4">
                            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-800 mb-4">
                                <h4 className="font-bold flex items-center gap-2 mb-1"><Target className="w-3.5 h-3.5"/> 为什么目标值对不上?</h4>
                                <p>如果在左侧筛选时发现目标值异常，请检查下表中的 <strong>"Unknown"</strong> 或 <strong>"Ghost" (幽灵)</strong> 品牌。</p>
                                <p className="mt-1 opacity-80">Ghost 品牌 = 存在于目标表，但在业绩表中从未出现过的品牌名称。</p>
                            </div>

                            {targetReport ? (
                                <div className="border border-slate-200 rounded-lg overflow-hidden">
                                    <table className="w-full text-xs text-left">
                                        <thead className="bg-slate-50 font-bold text-slate-600">
                                            <tr>
                                                <th className="p-3 border-b">品牌 (Brand)</th>
                                                <th className="p-3 border-b text-right">目标总额 ($)</th>
                                                <th className="p-3 border-b text-center">匹配状态</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {targetReport.rows.map((row, idx) => (
                                                <tr key={idx} className="hover:bg-slate-50">
                                                    <td className="p-3 font-medium text-slate-700">
                                                        {row.brand} 
                                                        {row.brand === 'Unknown' && <span className="ml-2 bg-red-100 text-red-600 px-1.5 rounded text-[10px]">未分类</span>}
                                                    </td>
                                                    <td className="p-3 text-right font-mono">{formatMoney(row.totalTarget)}</td>
                                                    <td className="p-3 text-center">
                                                        {row.status === 'Matched' 
                                                            ? <span className="text-green-600 font-bold text-[10px] bg-green-50 px-2 py-0.5 rounded-full">正常</span>
                                                            : <span className="text-orange-500 font-bold text-[10px] bg-orange-50 px-2 py-0.5 rounded-full">无业绩关联</span>
                                                        }
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div className="text-center text-slate-400 py-10">未上传目标数据</div>
                            )}
                        </div>
                    )}

                    {activeTab === 'monthly' && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-2 mb-2 font-bold text-slate-700">
                                {monthlyReport.issues.length === 0 ? <CheckCircle className="w-5 h-5 text-green-500"/> : <AlertTriangle className="w-5 h-5 text-orange-500"/>}
                                月度数据检查结果
                            </div>
                            {monthlyReport.issues.length > 0 ? (
                                <div className="bg-red-50 text-red-700 p-3 rounded text-xs space-y-1 border border-red-100">
                                    {monthlyReport.issues.map((issue, i) => <div key={i}>{issue}</div>)}
                                </div>
                            ) : <div className="text-green-600 text-xs bg-green-50 p-3 rounded">数据格式标准，解析正常。</div>}
                            {monthlyReport.sample && <RenderSample report={monthlyReport} />}
                        </div>
                    )}

                    {activeTab === 'weekly' && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-2 mb-2 font-bold text-slate-700">
                                {weeklyReport.issues.length === 0 && weeklyReport.count > 0 ? <CheckCircle className="w-5 h-5 text-green-500"/> : <AlertTriangle className="w-5 h-5 text-orange-500"/>}
                                周度数据检查结果
                            </div>
                            {weeklyReport.count === 0 ? <div className="text-slate-400 text-xs italic">未上传周度数据</div> : (
                                <>
                                    {weeklyReport.issues.length > 0 ? (
                                        <div className="bg-red-50 text-red-700 p-3 rounded text-xs space-y-1 border border-red-100">
                                            {weeklyReport.issues.map((issue, i) => <div key={i}>{issue}</div>)}
                                        </div>
                                    ) : <div className="text-green-600 text-xs bg-green-50 p-3 rounded">数据格式标准，解析正常。</div>}
                                    {weeklyReport.sample && <RenderSample report={weeklyReport} />}
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

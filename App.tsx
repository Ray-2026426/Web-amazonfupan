
import React, { useState, useMemo, useEffect } from 'react';
import { DataRow, TargetRow, FilterState, InventoryRow, RefundRow, ReviewRow, SearchTermRow, ProductImageRow, FilterSnapshot } from './types';
import { 
  calculatePeriodDates, 
  filterData, 
  aggregateData, 
  getTargetForSelection, 
  analyzeDataCompleteness, 
  filterInventoryData, 
  aggregateInventoryData, 
  enrichTargetData, 
  getPacingRatio,
  analyzeTargetCompleteness,
  getISOWeekDateRange,
  formatDate,
  getCurrentWeekInfo,
  buildProductImageLookup,
  type ProductImageLookup,
} from './utils';
import { SidebarFilters } from './components/SidebarFilters';
import { DashboardOverview } from './components/DashboardOverview';
import { PLTable, TrafficTable } from './components/TableRenderers';
import { InventoryTable } from './components/InventoryTable';
import { DataUploadModal, type DataUploadResult } from './components/DataUploadModal';
import { resetTrendChartMetricsSelection } from './components/TrendChartModal';
import { UploadSlots, listMissingOptionalSlots } from './uploadFileClassifier';
import { DetailAnalysisModal } from './components/DetailAnalysisModal';
import { RefundAnalysisModal } from './components/RefundAnalysisModal';
import { ProfitSimulatorModal } from './components/ProfitSimulatorModal';
import { ReviewAnalysisModal } from './components/ReviewAnalysisModal';
import { KeywordAnalysisModal } from './components/KeywordAnalysisModal'; 
import { ChatBot } from './components/ChatBot';
import { AppSettingsButton } from './components/AppSettingsButton';
import { parseMonthlyPerformance, parseWeeklyPerformance, parseTargetData, parseInventoryData, parseRefundData, parseReviewData, parseProductImageData } from './dataLoader';
import { FileSpreadsheet, CalendarDays, Database, LayoutDashboard } from 'lucide-react';
import { saveToDB, loadFromDB, clearDB } from './db';

const initialFilters: FilterState = {
  startDate: '',
  endDate: '',
  countries: [],
  shops: [],
  brands: [],
  managers: [],
  subCategories: [],
  parentAsins: [],
  childAsins: [],
  productNames: []
};

// --- World Clock Component ---
const WorldClock = () => {
    const [times, setTimes] = useState<Record<string, string>>({});
    const [weekLine, setWeekLine] = useState<string>(() => {
        const { week, rangeCompact } = getCurrentWeekInfo();
        return `第 ${week} 周（${rangeCompact}）`;
    });

    useEffect(() => {
        const updateTime = () => {
            const now = new Date();
            const { week, rangeCompact } = getCurrentWeekInfo();
            setWeekLine(`第 ${week} 周（${rangeCompact}）`);

            const format = (date: Date) => {
                const m = date.getMonth() + 1;
                const d = date.getDate();
                const h = date.getHours().toString().padStart(2, '0');
                const min = date.getMinutes().toString().padStart(2, '0');
                return `${m}.${d} ${h}:${min}`;
            };

            const getTzTime = (tz: string) => new Date(now.toLocaleString("en-US", { timeZone: tz }));

            setTimes({
                CN: format(getTzTime("Asia/Shanghai")),
                EU: format(getTzTime("Europe/Berlin")), // Using Germany as central EU time
                US: format(getTzTime("America/Los_Angeles")) // Using PST/PDT (Amazon HQ)
            });
        };

        updateTime();
        const interval = setInterval(updateTime, 60000); // Update every minute
        return () => clearInterval(interval);
    }, []);

    if (!times.CN) return null;

    return (
        <div className="hidden lg:flex items-center gap-4 rounded-2xl border border-slate-200/80 bg-white/70 px-3 py-2 text-[10px] font-mono font-medium text-slate-500 shadow-sm">
            <div className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-600">
                <CalendarDays className="w-3 h-3" />
                <span>{weekLine}</span>
            </div>
            <div className="w-px h-4 bg-slate-200"></div>
            <div className="flex items-center gap-1.5">
                <span className="font-bold text-rose-500">CN</span>
                <span className="text-slate-700">{times.CN}</span>
            </div>
            <div className="w-px h-4 bg-slate-200"></div>
            <div className="flex items-center gap-1.5">
                <span className="font-bold text-sky-600">EU</span>
                <span className="text-slate-700">{times.EU}</span>
            </div>
            <div className="w-px h-4 bg-slate-200"></div>
            <div className="flex items-center gap-1.5">
                <span className="font-bold text-violet-600">US</span>
                <span className="text-slate-700">{times.US}</span>
            </div>
        </div>
    );
};

const App: React.FC = () => {
  // Data States
  const [performanceData, setPerformanceData] = useState<DataRow[]>([]);
  const [weeklyData, setWeeklyData] = useState<DataRow[]>([]);
  const [targetData, setTargetData] = useState<TargetRow[]>([]);
  const [inventoryData, setInventoryData] = useState<InventoryRow[]>([]);
  const [refundData, setRefundData] = useState<RefundRow[]>([]);
  const [reviewData, setReviewData] = useState<ReviewRow[]>([]);
  const [searchTermData, setSearchTermData] = useState<SearchTermRow[]>([]); 
  const [productImageData, setProductImageData] = useState<ProductImageRow[]>([]);

  const productImageLookup = useMemo<ProductImageLookup | null>(() => {
      if (productImageData.length === 0) return null;
      return buildProductImageLookup(productImageData);
  }, [productImageData]);

  // UI States
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [isWeeklyMode, setIsWeeklyMode] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [isRestoringData, setIsRestoringData] = useState(true);
  // Modal States
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailType, setDetailType] = useState<'PL' | 'Traffic' | 'Inventory'>('PL');
  
  const [refundModalOpen, setRefundModalOpen] = useState(false);
  const [refundOverrideFilters, setRefundOverrideFilters] = useState<Partial<FilterState> | null>(null);

  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [keywordModalOpen, setKeywordModalOpen] = useState(false); 
  const [calculatorModalOpen, setCalculatorModalOpen] = useState(false);
  
  const [calculatorParams, setCalculatorParams] = useState<{ product?: string, country?: string }>({});

  // --- 1. Load Data from DB on Startup ---
  useEffect(() => {
      const restoreData = async () => {
          setIsRestoringData(true);
          try {
              const [monthly, weekly, targets, inv, refunds, reviews, productImages, savedFilters] = await Promise.all([
                  loadFromDB('monthly'),
                  loadFromDB('weekly'),
                  loadFromDB('targets'),
                  loadFromDB('inventory'),
                  loadFromDB('refunds'),
                  loadFromDB('reviews'),
                  loadFromDB('product_images'),
                  loadFromDB('meta')
              ]);

              if (monthly) setPerformanceData(monthly);
              if (weekly) setWeeklyData(weekly);
              if (targets) setTargetData(targets);
              if (inv) setInventoryData(inv);
              if (refunds) setRefundData(refunds);
              if (reviews) setReviewData(reviews);
              if (productImages?.length) setProductImageData(productImages);
              
              if (savedFilters && savedFilters.startDate) {
                  setFilters(savedFilters);
              } else if (monthly && monthly.length > 0) {
                  const dates = monthly.map((d: DataRow) => d.date).sort();
                  const lastDate = dates[dates.length - 1];
                  const [y, m] = lastDate.split('-').map(Number);
                  const lastMonthStart = new Date(y, m - 1, 1);
                  const lastMonthEnd = new Date(y, m, 0);
                  
                  const fmt = (d: Date) => `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`;
                  
                  setFilters({
                      ...initialFilters,
                      startDate: fmt(lastMonthStart),
                      endDate: fmt(lastMonthEnd)
                  });
              }

          } catch (e) {
              console.error("Error restoring data from DB", e);
          } finally {
              setIsRestoringData(false);
          }
      };
      restoreData();
  }, []);

  // --- 2. Save Filters when they change ---
  useEffect(() => {
      if (!isRestoringData && performanceData.length > 0 && filters.startDate) {
          saveToDB('meta', filters);
      }
  }, [filters, isRestoringData, performanceData]);

  // --- Handlers ---
  const handleDataUpload = async (slots: UploadSlots): Promise<DataUploadResult | undefined> => {
    if (!slots.monthly) return undefined;
    await clearDB();
    resetTrendChartMetricsSelection();
    setSearchTermData([]);

    const debugs: DataUploadResult['reports'] = [];

    const monthlyRes = await parseMonthlyPerformance(slots.monthly);
    setPerformanceData(monthlyRes.data);
    saveToDB('monthly', monthlyRes.data);
    debugs.push(monthlyRes.debug);

    // 导入后统一先看月度仪表盘，避免「周度」开关仍打开但周表未上传时整页无数据
    setIsWeeklyMode(false);

    if (slots.weekly) {
        const weeklyRes = await parseWeeklyPerformance(slots.weekly);
        setWeeklyData(weeklyRes.data);
        saveToDB('weekly', weeklyRes.data);
        debugs.push(weeklyRes.debug);
    } else {
        setWeeklyData([]);
        saveToDB('weekly', []);
    }

    if (slots.target) {
        const targetRes = await parseTargetData(slots.target);
        const enrichedTargets = enrichTargetData(targetRes.data, monthlyRes.data);
        setTargetData(enrichedTargets);
        saveToDB('targets', enrichedTargets);
        debugs.push(targetRes.debug);
    } else {
        setTargetData([]);
        saveToDB('targets', []);
    }

    if (slots.inventory) {
        const invRes = await parseInventoryData(slots.inventory);
        setInventoryData(invRes.data);
        saveToDB('inventory', invRes.data);
        debugs.push(invRes.debug);
    } else {
        setInventoryData([]);
        saveToDB('inventory', []);
    }

    if (slots.refund) {
        const refRes = await parseRefundData(slots.refund);
        setRefundData(refRes.data);
        saveToDB('refunds', refRes.data);
        debugs.push(refRes.debug);
    } else {
        setRefundData([]);
        saveToDB('refunds', []);
    }

    if (slots.review) {
        const revRes = await parseReviewData(slots.review);
        setReviewData(revRes.data);
        saveToDB('reviews', revRes.data);
        debugs.push(revRes.debug);
    } else {
        setReviewData([]);
        saveToDB('reviews', []);
    }

    if (slots.productImages) {
        const imgRes = await parseProductImageData(slots.productImages);
        setProductImageData(imgRes.data);
        saveToDB('product_images', imgRes.data);
        debugs.push(imgRes.debug);
    } else {
        // 用户这次没上传图片表 → 清空图片，不保留上次
        setProductImageData([]);
        saveToDB('product_images', []);
    }

    if (monthlyRes.data.length > 0) {
        const dates = monthlyRes.data.map(d => d.date).sort();
        const lastDate = dates[dates.length - 1];
        const [y, m] = lastDate.split('-').map(Number);
        const lastMonthStart = new Date(y, m - 1, 1);
        const lastMonthEnd = new Date(y, m, 0);

        const fmt = (d: Date) => `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`;

        const newFilters = {
            ...initialFilters,
            startDate: fmt(lastMonthStart),
            endDate: fmt(lastMonthEnd)
        };
        setFilters(newFilters);
        saveToDB('meta', newFilters);
    }

    // 不在此处关弹窗：先展示解析结果，用户点「开始分析」再关，避免与子表状态更新不同步
    return {
        reports: debugs,
        missingOptional: listMissingOptionalSlots(slots),
        unrecognizedNames: [],
    };
  };

  const handleOpenCalculator = (product?: string, country?: string) => {
      setCalculatorParams({ product, country });
      setCalculatorModalOpen(true);
  };

  const handleOpenRefundAnalysis = (overrides?: Partial<FilterState>) => {
      setRefundOverrideFilters(overrides || null);
      setRefundModalOpen(true);
  };

  const handleLoadSnapshot = (snapshot: FilterSnapshot) => {
      setIsWeeklyMode(snapshot.isWeeklyMode);
      // 用 setTimeout 确保 mode 切换已生效再设 filters
      setFilters(snapshot.filters);
  };

  const handleSetWeeklyMode = (enable: boolean) => {
      setIsWeeklyMode(enable);
      if (enable) {
          // Default to Last Week
          const now = new Date();
          const lastWeekDay = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          const { start, end } = getISOWeekDateRange(lastWeekDay);
          setFilters(prev => ({
              ...prev,
              startDate: formatDate(start),
              endDate: formatDate(end)
          }));
      }
  }

  // --- Processing Logic ---
  
  const processedData = useMemo(() => {
      const activeData = isWeeklyMode ? weeklyData : performanceData;
      if (activeData.length === 0) return null;
      if (!filters.startDate || !filters.endDate) return null;

      const periods = calculatePeriodDates(filters.startDate, filters.endDate);
      
      // Filter Data for periods
      const currentRows = filterData(activeData, periods.current, filters);
      const lastRows = filterData(activeData, periods.last, filters);
      const yearRows = filterData(activeData, periods.year, filters);

      // Aggregate
      const current = aggregateData(currentRows);
      // STRICT: Return null if no data, so comparison logic knows it's missing (not 0)
      // UPDATED per user request to handle empty as zero for comparison calculations?
      // Actually, user previously said "restore comparison lines". 
      // If we return null, TableRenderers.tsx hides the line.
      // If we return 0 object, it calculates diff against 0.
      // The previous instruction was "return null instead of zero-filled".
      // Now I'll keep it as is (using null for missing data to show correct 'No Data' state or dashes)
      // UNLESS the user wants to see -100% when comparing against 0? 
      // Usually "missing data" (null) is cleaner than "0 data".
      // I will assume the previous fix (null) was correct for logic, but maybe they want the UI to allow fullscreen.
      
      const last = lastRows.length > 0 ? aggregateData(lastRows) : null;
      const year = yearRows.length > 0 ? aggregateData(yearRows) : null;

      // Targets
      const pacing = getPacingRatio(periods.current.start, periods.current.end);
      const target = getTargetForSelection(targetData, periods.current.start, periods.current.end, filters, pacing);

      // Inventory (Snapshot logic usually, here simplified filter)
      const invRows = filterInventoryData(inventoryData, filters);
      const inventory = aggregateInventoryData(invRows);

      // Analysis
      const dataCompleteness = analyzeDataCompleteness(currentRows, lastRows, yearRows, periods);
      const targetWarnings = analyzeTargetCompleteness(targetData, periods.current.start, periods.current.end);
      
      const warnings = [...dataCompleteness.warnings, ...targetWarnings];

      return {
          current,
          last,
          year,
          target,
          inventory,
          periods,
          warnings,
          currentRows,
          lastRows,
          yearRows,
          invRows
      };
  }, [performanceData, weeklyData, targetData, inventoryData, filters, isWeeklyMode]);

  return (
    <div className="flex h-screen overflow-hidden bg-[radial-gradient(circle_at_top,#e0f2fe_0%,#eff6ff_22%,#f8fafc_52%,#f8fafc_100%)] font-sans text-slate-900">
      <SidebarFilters 
        data={isWeeklyMode ? weeklyData : performanceData} 
        inventoryData={inventoryData}
        targetData={targetData}
        filters={filters} 
        setFilters={setFilters} 
        warnings={processedData?.warnings}
        isWeeklyMode={isWeeklyMode}
        onLoadSnapshot={handleLoadSnapshot}
      />
      
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Top Bar */}
        <header className="relative z-10 mx-4 mt-4 flex flex-shrink-0 items-center justify-between rounded-[28px] border border-white/70 bg-white/85 px-6 py-4 shadow-[0_24px_70px_-42px_rgba(15,23,42,0.45)] backdrop-blur-xl">
            <div className="flex items-center gap-5">
                <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#0f172a_0%,#2563eb_100%)] text-white shadow-lg shadow-sky-500/20">
                        <LayoutDashboard className="w-5 h-5" />
                    </div>
                </div>
                <div className="hidden xl:flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/90 p-1">
                    <button 
                        onClick={() => handleSetWeeklyMode(false)}
                        className={`px-3.5 py-2 text-xs font-bold rounded-xl transition-all ${!isWeeklyMode ? 'bg-white text-sky-700 shadow-sm ring-1 ring-sky-100' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        月度
                    </button>
                    <button 
                        onClick={() => handleSetWeeklyMode(true)}
                        className={`px-3.5 py-2 text-xs font-bold rounded-xl transition-all ${isWeeklyMode ? 'bg-white text-sky-700 shadow-sm ring-1 ring-sky-100' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        周度
                    </button>
                </div>
            </div>
            
            <div className="flex items-center gap-3">
                <WorldClock />
                <div className="h-8 w-px bg-slate-200 mx-1 hidden lg:block"></div>

                <AppSettingsButton />

                <button 
                    onClick={() => setShowUploadModal(true)}
                    className="flex items-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#0284c7_0%,#2563eb_100%)] px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-sky-500/20 transition-all hover:brightness-110 active:scale-95"
                >
                    <FileSpreadsheet className="w-4 h-4" />
                    {performanceData.length > 0 ? '更新数据源' : '导入数据源'}
                </button>
            </div>
        </header>

        {/* Scrollable Content */}
        <main className="flex-1 overflow-y-auto p-6 custom-scroll">
            {isRestoringData ? (
                <div className="flex flex-col items-center justify-center rounded-[28px] border border-white/80 bg-white/80 py-24 text-slate-400 shadow-[0_24px_60px_-35px_rgba(15,23,42,0.3)] backdrop-blur-xl">
                    <Database className="mb-4 h-12 w-12 text-sky-300 animate-pulse" />
                    <p className="text-lg font-semibold text-slate-700">正在恢复数据...</p>
                    <p className="mt-1 text-sm text-slate-500">从本地缓存读取中</p>
                </div>
            ) : (
                <div className="max-w-[1680px] mx-auto space-y-6 pb-20">
                    
                    {/* 1. Overview Cards */}
                    {processedData && (
                        <DashboardOverview 
                            current={processedData.current} 
                            target={processedData.target} 
                            isWeeklyMode={isWeeklyMode}
                            rawData={isWeeklyMode ? weeklyData : performanceData}
                            filters={filters}
                            targetRows={targetData}
                        />
                    )}

                    {/* 2. PL Table */}
                    {processedData && (
                        <PLTable 
                            current={processedData.current}
                            last={processedData.last}
                            year={processedData.year}
                            target={processedData.target}
                            onOpenDetail={() => { setDetailType('PL'); setDetailModalOpen(true); }}
                            onOpenCalculator={() => handleOpenCalculator()}
                            onOpenRefundAnalysis={() => handleOpenRefundAnalysis()}
                            onOpenReviewAnalysis={() => setReviewModalOpen(true)}
                        />
                    )}

                    {/* 3. Traffic Table */}
                    {processedData && (
                        <TrafficTable 
                            current={processedData.current}
                            last={processedData.last}
                            year={processedData.year}
                            target={processedData.target}
                            onOpenDetail={() => { setDetailType('Traffic'); setDetailModalOpen(true); }}
                            onOpenKeywordAnalysis={() => setKeywordModalOpen(true)}
                        />
                    )}

                    {/* 4. Inventory Table */}
                    {processedData && (
                        <InventoryTable 
                            data={processedData.inventory} 
                            inventoryRows={processedData.invRows}
                            onOpenDetail={() => { setDetailType('Inventory'); setDetailModalOpen(true); }}
                        />
                    )}

                    {!processedData && (
                        <div className="flex flex-col items-center justify-center rounded-[28px] border border-white/80 bg-white/85 py-24 text-slate-400 shadow-[0_24px_60px_-35px_rgba(15,23,42,0.3)] backdrop-blur-xl">
                            <div className="mb-5 rounded-[24px] bg-sky-50 p-6 text-sky-300 ring-1 ring-sky-100">
                                <FileSpreadsheet className="w-12 h-12" />
                            </div>
                            <p className="text-lg font-semibold text-slate-700">暂无数据</p>
                            <p className="mt-1 text-sm text-slate-500">请点击右上角导入 Excel 数据源</p>
                        </div>
                    )}
                </div>
            )}
        </main>

        {/* Modals */}
        <DataUploadModal 
            isOpen={showUploadModal} 
            onClose={() => setShowUploadModal(false)}
            onUpload={handleDataUpload}
        />

        {processedData && (
            <DetailAnalysisModal 
                isOpen={detailModalOpen}
                onClose={() => setDetailModalOpen(false)}
                type={detailType}
                currentRows={processedData.currentRows}
                lastRows={processedData.lastRows}
                yearRows={processedData.yearRows}
                targetRows={targetData}
                inventoryRows={processedData.invRows}
                period={processedData.periods.current}
                onOpenRefundAnalysis={handleOpenRefundAnalysis}
                onOpenCalculator={handleOpenCalculator}
                onOpenReviewAnalysis={() => setReviewModalOpen(true)}
                isWeeklyMode={isWeeklyMode}
                rawPerformance={isWeeklyMode ? weeklyData : performanceData}
                performanceMonthly={performanceData}
                performanceWeekly={weeklyData}
                productImageLookup={productImageLookup}
            />
        )}

        <RefundAnalysisModal 
            isOpen={refundModalOpen}
            onClose={() => { setRefundModalOpen(false); setRefundOverrideFilters(null); }}
            refundData={refundData}
            rawPerformance={performanceData}
            onDataChange={setRefundData}
            initialFilters={refundOverrideFilters ? { ...filters, ...refundOverrideFilters } : filters}
        />

        <ReviewAnalysisModal 
            isOpen={reviewModalOpen}
            onClose={() => setReviewModalOpen(false)}
            reviewData={reviewData}
            rawPerformance={performanceData}
            onDataChange={setReviewData}
            initialFilters={filters}
        />

        <KeywordAnalysisModal 
            isOpen={keywordModalOpen}
            onClose={() => setKeywordModalOpen(false)}
            data={searchTermData}
            onDataChange={setSearchTermData}
        />

        <ProfitSimulatorModal 
            isOpen={calculatorModalOpen}
            onClose={() => setCalculatorModalOpen(false)}
            rawData={performanceData}
            filters={filters}
            initialProduct={calculatorParams.product}
            initialCountry={calculatorParams.country}
        />

        {/* Chat Bot Integration with All Data Sources */}
        <ChatBot 
            data={processedData} 
            inventory={processedData?.inventory || null}
            refunds={refundData}
            filters={filters} 
            rawPerformance={isWeeklyMode ? weeklyData : performanceData}
            rawInventory={inventoryData}
        />
      </div>
    </div>
  );
};

export default App;

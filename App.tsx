
import React, { useState, useMemo, useEffect, Suspense, lazy } from 'react';
import { ActionItem, BusinessIssue, DataRow, TargetRow, FilterState, InventoryRow, RefundRow, ReviewRow, SearchTermRow, ProductImageRow, FilterSnapshot, DataCoverage, AppMeta } from './types';
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
  getWeeklyAllocatedTarget,
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
import { resetTrendChartMetricsSelection } from './components/trendSelection';
import { UploadSlots, listMissingOptionalSlots } from './uploadFileClassifier';
const DetailAnalysisModal = lazy(() => import('./components/DetailAnalysisModal').then(m => ({default: m.DetailAnalysisModal})));
const RefundAnalysisModal = lazy(() => import('./components/RefundAnalysisModal').then(m => ({default: m.RefundAnalysisModal})));
const ProfitSimulatorModal = lazy(() => import('./components/ProfitSimulatorModal').then(m => ({default: m.ProfitSimulatorModal})));
const ReviewAnalysisModal = lazy(() => import('./components/ReviewAnalysisModal').then(m => ({default: m.ReviewAnalysisModal})));
const KeywordAnalysisModal = lazy(() => import('./components/KeywordAnalysisModal').then(m => ({default: m.KeywordAnalysisModal})));
const ChatBot = lazy(() => import('./components/ChatBot').then(m => ({default: m.ChatBot})));
import { AppSettingsButton } from './components/AppSettingsButton';
import { BusinessCommandCenter } from './components/BusinessCommandCenter';
import { parseMonthlyPerformance, parseWeeklyPerformance, parseTargetData, parseInventoryData, parseRefundData, parseReviewData, parseProductImageData } from './dataLoader';
import { FileSpreadsheet, CalendarDays, Database, LayoutDashboard, Menu, X, Sparkles } from 'lucide-react';
import { saveToDB, loadFromDB, replaceImportedData } from './db';
import { DEFAULT_BUSINESS_RULES, generateBusinessIssues, updateActionForIssue } from './utils/businessRules';

const DEFAULT_DATA_START = '2025-01-01';
const SAMPLE_HEADERS = '日期,ASIN,国家,店铺,负责人,销售额,销量,毛利润,广告花费,广告销售额,Sessions';
const downloadImportTemplate = () => {
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const csv = `\uFEFF${SAMPLE_HEADERS}\n${monthStart},B0SAMPLE01,美国,示例店铺,张三,12000,80,2400,1800,6500,4200\n`;
  const url = URL.createObjectURL(new Blob([csv], {type: 'text/csv;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url; link.download = '月度业绩导入模板.csv'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

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
        <div className="hidden 2xl:flex items-center gap-4 rounded-2xl border border-slate-200/80 bg-white/70 px-3 py-2 text-[10px] font-mono font-medium text-slate-500 shadow-sm">
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
  const [businessActions, setBusinessActions] = useState<ActionItem[]>([]);

  const productImageLookup = useMemo<ProductImageLookup | null>(() => {
      if (productImageData.length === 0) return null;
      return buildProductImageLookup(productImageData);
  }, [productImageData]);

  // UI States
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [dataStartDate, setDataStartDate] = useState(DEFAULT_DATA_START);
  const [dataEndDate, setDataEndDate] = useState('');
  const [lastImportedAt, setLastImportedAt] = useState<number | undefined>();
  const [isWeeklyMode, setIsWeeklyMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatLoaded, setChatLoaded] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [isRestoringData, setIsRestoringData] = useState(true);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [persistenceError, setPersistenceError] = useState('');
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
              const [monthly, weekly, targets, inv, refunds, reviews, productImages, savedFilters, savedActions] = await Promise.all([
                  loadFromDB('monthly'),
                  loadFromDB('weekly'),
                  loadFromDB('targets'),
                  loadFromDB('inventory'),
                  loadFromDB('refunds'),
                  loadFromDB('reviews'),
                  loadFromDB('product_images'),
                  loadFromDB('meta'),
                  loadFromDB('business_actions')
              ]);

              if (monthly) setPerformanceData(monthly);
              if (weekly) setWeeklyData(weekly);
              if (targets) setTargetData(targets);
              if (inv) setInventoryData(inv);
              if (refunds) setRefundData(refunds);
              if (reviews) setReviewData(reviews);
              if (productImages?.length) setProductImageData(productImages);
              if (Array.isArray(savedActions)) setBusinessActions(savedActions);
              
              const savedMeta = savedFilters as AppMeta | FilterState | null;
              if (savedMeta) {
                  const isNewMeta = 'filters' in savedMeta && (savedMeta as AppMeta).filters?.startDate;
                  if (isNewMeta) {
                      const meta = savedMeta as AppMeta;
                      setFilters(meta.filters);
                      if (meta.dataStartDate) setDataStartDate(meta.dataStartDate);
                      if (meta.dataEndDate) setDataEndDate(meta.dataEndDate);
                      if (meta.lastImportedAt) setLastImportedAt(meta.lastImportedAt);
                  } else if ((savedMeta as FilterState).startDate) {
                      setFilters(savedMeta as FilterState);
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
              setRestoreFailed(true);
              setPersistenceError(`本地数据读取失败：${String(e)}。请勿重新导入以免覆盖原有数据。`);
          } finally {
              setIsRestoringData(false);
          }
      };
      restoreData();
  }, []);

  // --- 2. Save Filters + data coverage when they change ---
  useEffect(() => {
      if (!isRestoringData && performanceData.length > 0 && filters.startDate) {
          const meta: AppMeta = {
              filters,
              dataStartDate,
              dataEndDate,
              lastImportedAt,
          };
          saveToDB('meta', meta).catch(e => setPersistenceError(`筛选设置保存失败：${String(e)}`));
      }
  }, [filters, dataStartDate, dataEndDate, lastImportedAt, isRestoringData, performanceData]);

  useEffect(() => {
      if (!isRestoringData) {
          saveToDB('business_actions', businessActions).catch(e => setPersistenceError(`行动记录保存失败：${String(e)}`));
      }
  }, [businessActions, isRestoringData]);

  // --- Handlers ---
  const handleDataUpload = async (slots: UploadSlots, coverage: DataCoverage): Promise<DataUploadResult | undefined> => {
    if (!slots.monthly) return undefined;
    const debugs: DataUploadResult['reports'] = [];
    const monthlyRes = await parseMonthlyPerformance(slots.monthly);
    if (!monthlyRes.data.length) throw new Error('月度业绩表没有有效数据，请检查表头和日期。');
    for (const field of ['sales_amount', 'sales_quantity', 'gross_profit', 'child_asin']) {
        if (!monthlyRes.debug.mappedColumns[field]) throw new Error(`月度业绩表缺少必需字段：${field}。请先下载模板核对表头。`);
    }
    debugs.push(monthlyRes.debug);
    const parseOptional = async <T,>(file: File | null, parser: (file: File) => Promise<{data: T[]; debug: DataUploadResult['reports'][number]}>) => {
        if (!file) return [] as T[];
        const result = await parser(file);
        if (!result.data.length) throw new Error(`${file.name} 没有有效数据，请检查表头。`);
        debugs.push(result.debug);
        return result.data;
    };
    const newWeekly = await parseOptional(slots.weekly, parseWeeklyPerformance);
    const parsedTargets = await parseOptional(slots.target, parseTargetData);
    const newTargets = enrichTargetData(parsedTargets, monthlyRes.data);
    const newInventory = await parseOptional(slots.inventory, parseInventoryData);
    const newRefunds = await parseOptional(slots.refund, parseRefundData);
    const newReviews = await parseOptional(slots.review, parseReviewData);
    const newImages = await parseOptional(slots.productImages, parseProductImageData);

    let newFilters = filters;
    {
        const dates = monthlyRes.data.map(d => d.date).sort();
        const lastDate = dates[dates.length - 1];
        const [y, m] = lastDate.split('-').map(Number);
        const lastMonthStart = new Date(y, m - 1, 1);
        const lastMonthEnd = new Date(y, m, 0);

        const fmt = (d: Date) => `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`;

        newFilters = {
            ...initialFilters,
            startDate: fmt(lastMonthStart),
            endDate: fmt(lastMonthEnd)
        };
    }
    const nextMeta: AppMeta = {
        filters: newFilters,
        dataStartDate: coverage.dataStartDate || DEFAULT_DATA_START,
        dataEndDate: coverage.dataEndDate,
        lastImportedAt: Date.now(),
    };
    return {
        reports: debugs,
        missingOptional: listMissingOptionalSlots(slots),
        unrecognizedNames: [],
        commit: async () => {
            const evaluatedActions = businessActions.map(action => {
                const f = action.baselineFilters;
                if (!f?.startDate || !f.endDate || action.baselineGrossProfit === undefined) return action;
                const rows = filterData(monthlyRes.data, calculatePeriodDates(f.startDate, f.endDate).current, f);
                if (!rows.length) return action;
                return { ...action, latestGrossProfit: aggregateData(rows).gross_profit, lastEvaluatedAt: Date.now() };
            });
            await replaceImportedData({ monthly: monthlyRes.data, weekly: newWeekly, targets: newTargets,
                inventory: newInventory, refunds: newRefunds, reviews: newReviews,
                product_images: newImages, meta: nextMeta, business_actions: evaluatedActions });
            setPersistenceError('');
            resetTrendChartMetricsSelection();
            setSearchTermData([]);
            setPerformanceData(monthlyRes.data);
            setWeeklyData(newWeekly);
            setTargetData(newTargets);
            setInventoryData(newInventory);
            setRefundData(newRefunds);
            setReviewData(newReviews);
            setProductImageData(newImages);
            setBusinessActions(evaluatedActions);
            setIsWeeklyMode(false);
            setFilters(newFilters);
            setDataStartDate(nextMeta.dataStartDate);
            setDataEndDate(nextMeta.dataEndDate);
            setLastImportedAt(nextMeta.lastImportedAt);
        },
    };
  };

  const handleLoadSample = async () => {
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const previousMonth = `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}-01`;
      const csv = `\uFEFF${SAMPLE_HEADERS}\n${previousMonth},B0SAMPLE01,美国,示例店铺,张三,10500,70,2100,1600,5700,3800\n${currentMonth},B0SAMPLE01,美国,示例店铺,张三,12000,80,2400,1800,6500,4200\n`;
      const file = new File([csv], '月度业绩脱敏样例.csv', {type: 'text/csv'});
      const slots: UploadSlots = { monthly: file, weekly: null, target: null, inventory: null, refund: null, review: null, productImages: null };
      try {
          const prepared = await handleDataUpload(slots, {dataStartDate: previousMonth, dataEndDate: formatDate(now)});
          await prepared?.commit();
      } catch (e) { setPersistenceError(`样例加载失败：${String(e)}`); }
  };

  const handleOpenCalculator = (product?: string, country?: string) => {
      setCalculatorParams({ product, country });
      setCalculatorModalOpen(true);
  };

  const handleOpenRefundAnalysis = (overrides?: Partial<FilterState>) => {
      setRefundOverrideFilters(overrides || null);
      setRefundModalOpen(true);
  };

  const handleCreateAction = (issue: BusinessIssue) => {
      setBusinessActions(prev => updateActionForIssue(prev, issue).map(action => action.issueId === issue.id && !action.baselineFilters
          ? { ...action, baselineFilters: {...filters}, baselineGrossProfit: processedData?.current.gross_profit }
          : action));
  };

  const handleUpdateAction = (actionId: string, patch: Partial<ActionItem>) => {
      setBusinessActions(prev => prev.map(action => (
          action.id === actionId ? { ...action, ...patch } : action
      )));
  };

  const handleOpenDetailByType = (type: 'PL' | 'Traffic' | 'Inventory') => {
      setDetailType(type);
      setDetailModalOpen(true);
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

      // Targets：月度取全月目标；周度按天拆成「周分摊月目标」。序时仅月度展示用。
      const pacingRatio = isWeeklyMode
          ? 1
          : getPacingRatio(periods.current.start, periods.current.end, dataEndDate);
      const target = isWeeklyMode
          ? getWeeklyAllocatedTarget(targetData, periods.current.start, periods.current.end, filters)
          : getTargetForSelection(targetData, periods.current.start, periods.current.end, filters, 1);

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
          invRows,
          pacingRatio,
      };
  }, [performanceData, weeklyData, targetData, inventoryData, filters, isWeeklyMode, dataEndDate]);

  const businessIssues = useMemo(() => {
      if (!processedData) return [];
      return generateBusinessIssues({
          current: processedData.current,
          last: processedData.last,
          target: processedData.target,
          inventory: processedData.inventory,
          warnings: processedData.warnings,
          pacingRatio: processedData.pacingRatio,
          isWeeklyMode,
      });
  }, [processedData, isWeeklyMode]);

  return (
    <div className="flex h-screen overflow-hidden bg-[radial-gradient(circle_at_top,#e0f2fe_0%,#eff6ff_22%,#f8fafc_52%,#f8fafc_100%)] font-sans text-slate-900">
      {sidebarOpen && <button type="button" aria-label="关闭筛选侧栏" onClick={() => setSidebarOpen(false)} className="fixed inset-0 z-30 bg-slate-950/50 xl:hidden" />}
      <div className={`fixed inset-y-0 left-0 z-40 transition-transform xl:relative xl:z-20 xl:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
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
      </div>
      
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Top Bar */}
        <header className="relative z-10 mx-3 mt-3 flex flex-shrink-0 flex-wrap items-center justify-between gap-3 rounded-3xl border border-white/70 bg-white/85 px-4 py-3 shadow-[0_24px_70px_-42px_rgba(15,23,42,0.45)] backdrop-blur-xl">
            <div className="flex items-center gap-5">
                <button type="button" aria-label={sidebarOpen ? '关闭筛选侧栏' : '打开筛选侧栏'} onClick={() => setSidebarOpen(v => !v)} className="rounded-xl border border-slate-200 p-2 text-slate-700 xl:hidden">{sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
                <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#0f172a_0%,#2563eb_100%)] text-white shadow-lg shadow-sky-500/20">
                        <LayoutDashboard className="w-5 h-5" />
                    </div>
                    <span className="hidden text-sm font-bold text-slate-900 sm:inline">亚马逊业绩复盘</span>
                </div>
                <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/90 p-1">
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
            
            <div className="flex items-center gap-2 sm:gap-3">
                <WorldClock />
                <div className="h-8 w-px bg-slate-200 mx-1 hidden lg:block"></div>

                <AppSettingsButton />

                <button 
                    onClick={() => setShowUploadModal(true)}
                    disabled={restoreFailed}
                    title={restoreFailed ? '本地数据读取失败，刷新并排查后再导入' : undefined}
                    className="flex items-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#0284c7_0%,#2563eb_100%)] px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-sky-500/20 transition-all hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <FileSpreadsheet className="w-4 h-4" />
                    {performanceData.length > 0 ? '更新数据源' : '导入数据源'}
                </button>
            </div>
        </header>

        {/* Scrollable Content */}
        <main className="flex-1 overflow-y-auto p-3 sm:p-6 custom-scroll">
            {persistenceError && <div role="alert" className="mx-auto mb-3 flex max-w-[1680px] items-center justify-between rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800"><span>{persistenceError}</span><button type="button" onClick={() => setPersistenceError('')} className="ml-3 font-bold">关闭</button></div>}
            {isRestoringData ? (
                <div className="flex flex-col items-center justify-center rounded-3xl border border-white/80 bg-white/80 py-24 text-slate-400 shadow-[0_24px_70px_-42px_rgba(15,23,42,0.45)] backdrop-blur-xl">
                    <Database className="mb-4 h-12 w-12 text-sky-300 animate-pulse" />
                    <p className="text-lg font-semibold text-slate-700">正在恢复数据...</p>
                    <p className="mt-1 text-sm text-slate-500">从本地缓存读取中</p>
                </div>
            ) : (
                <div className="max-w-[1680px] mx-auto space-y-6 pb-20">
                    {processedData && <nav aria-label="报表模块" className="flex gap-2 overflow-x-auto whitespace-nowrap text-xs font-semibold text-slate-600">{[['overview','业绩概览'],['issues','优先事项'],['pl','利润表'],['traffic','流量广告'],['inventory','库存']].map(([id,label]) => <a key={id} href={`#${id}`} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 hover:border-sky-300 hover:text-sky-700">{label}</a>)}</nav>}
                    
                    {/* 1. Overview Cards */}
                    {processedData && (
                        <section id="overview"><DashboardOverview 
                            current={processedData.current} 
                            target={processedData.target} 
                            isWeeklyMode={isWeeklyMode}
                            rawData={isWeeklyMode ? weeklyData : performanceData}
                            filters={filters}
                            targetRows={targetData}
                            pacingRatio={processedData.pacingRatio}
                        /></section>
                    )}

                    {processedData && (
                        <section id="issues"><BusinessCommandCenter
                            issues={businessIssues}
                            rules={DEFAULT_BUSINESS_RULES}
                            actions={businessActions}
                            onCreateAction={handleCreateAction}
                            onUpdateAction={handleUpdateAction}
                            onOpenDetail={handleOpenDetailByType}
                            onOpenRefundAnalysis={() => handleOpenRefundAnalysis()}
                            onOpenReviewAnalysis={() => setReviewModalOpen(true)}
                            onOpenKeywordAnalysis={() => setKeywordModalOpen(true)}
                        /></section>
                    )}

                    {/* 2. PL Table */}
                    {processedData && (
                        <section id="pl"><PLTable 
                            current={processedData.current}
                            last={processedData.last}
                            year={processedData.year}
                            target={processedData.target}
                            onOpenDetail={() => { setDetailType('PL'); setDetailModalOpen(true); }}
                            onOpenCalculator={() => handleOpenCalculator()}
                            onOpenRefundAnalysis={() => handleOpenRefundAnalysis()}
                            onOpenReviewAnalysis={() => setReviewModalOpen(true)}
                        /></section>
                    )}

                    {/* 3. Traffic Table */}
                    {processedData && (
                        <section id="traffic"><TrafficTable 
                            current={processedData.current}
                            last={processedData.last}
                            year={processedData.year}
                            target={processedData.target}
                            onOpenDetail={() => { setDetailType('Traffic'); setDetailModalOpen(true); }}
                            onOpenKeywordAnalysis={() => setKeywordModalOpen(true)}
                        /></section>
                    )}

                    {/* 4. Inventory Table */}
                    {processedData && (
                        <section id="inventory"><InventoryTable 
                            data={processedData.inventory} 
                            inventoryRows={processedData.invRows}
                            onOpenDetail={() => { setDetailType('Inventory'); setDetailModalOpen(true); }}
                        /></section>
                    )}

                    {!processedData && (
                        <div className="flex flex-col items-center justify-center rounded-3xl border border-white/80 bg-white/85 py-24 text-slate-400 shadow-[0_24px_70px_-42px_rgba(15,23,42,0.45)] backdrop-blur-xl">
                            <div className="mb-5 rounded-2xl bg-sky-50 p-6 text-sky-300 ring-1 ring-sky-100">
                                <FileSpreadsheet className="w-12 h-12" />
                            </div>
                            <p className="text-lg font-semibold text-slate-700">{restoreFailed ? '本地数据暂时无法读取' : performanceData.length ? '当前选择无数据' : '暂无数据'}</p>
                            <p className="mt-1 text-sm text-slate-500">{restoreFailed ? '请检查浏览器存储权限后刷新页面' : performanceData.length ? '请调整分析周期或切换月度视图' : '可先加载样例，也可导入自己的数据'}</p>
                            {!restoreFailed && !performanceData.length && <div className="mt-5 flex flex-wrap justify-center gap-2">
                                <button type="button" onClick={downloadImportTemplate} className="rounded-xl border border-sky-200 bg-white px-4 py-2 text-sm font-semibold text-sky-700">下载模板</button>
                                <button type="button" onClick={handleLoadSample} className="rounded-xl border border-sky-200 bg-white px-4 py-2 text-sm font-semibold text-sky-700">加载脱敏样例</button>
                                <button type="button" onClick={() => setShowUploadModal(true)} className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white">导入自己的数据</button>
                            </div>}
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
            initialCoverage={{
                dataStartDate: dataStartDate || DEFAULT_DATA_START,
                dataEndDate,
            }}
        />

        {processedData && detailModalOpen && (
            <Suspense fallback={<div role="status" className="fixed inset-0 z-[140] grid place-items-center bg-slate-950/40 text-white">正在加载详细数据…</div>}><DetailAnalysisModal 
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
                dataEndDate={dataEndDate}
            /></Suspense>
        )}

        {refundModalOpen && <Suspense fallback={null}><RefundAnalysisModal 
            isOpen={refundModalOpen}
            onClose={() => { setRefundModalOpen(false); setRefundOverrideFilters(null); }}
            refundData={refundData}
            rawPerformance={performanceData}
            onDataChange={setRefundData}
            initialFilters={refundOverrideFilters ? { ...filters, ...refundOverrideFilters } : filters}
        /></Suspense>}

        {reviewModalOpen && <Suspense fallback={null}><ReviewAnalysisModal 
            isOpen={reviewModalOpen}
            onClose={() => setReviewModalOpen(false)}
            reviewData={reviewData}
            rawPerformance={performanceData}
            onDataChange={setReviewData}
            initialFilters={filters}
        /></Suspense>}

        {keywordModalOpen && <Suspense fallback={null}><KeywordAnalysisModal 
            isOpen={keywordModalOpen}
            onClose={() => setKeywordModalOpen(false)}
            data={searchTermData}
            onDataChange={setSearchTermData}
        /></Suspense>}

        {calculatorModalOpen && <Suspense fallback={null}><ProfitSimulatorModal 
            isOpen={calculatorModalOpen}
            onClose={() => setCalculatorModalOpen(false)}
            rawData={performanceData}
            filters={filters}
            initialProduct={calculatorParams.product}
            initialCountry={calculatorParams.country}
        /></Suspense>}

        {/* Chat Bot Integration with All Data Sources */}
        {!chatLoaded && <button type="button" aria-label="打开 AI 顾问" onClick={() => setChatLoaded(true)} className="fixed bottom-6 right-6 z-50 rounded-full bg-blue-600 p-4 text-white shadow-xl hover:bg-blue-700"><Sparkles className="h-6 w-6" /></button>}
        {chatLoaded && <Suspense fallback={<div role="status" className="fixed bottom-6 right-6 z-50 rounded-full bg-blue-600 p-4 text-white">加载中…</div>}><ChatBot 
            data={processedData} 
            inventory={processedData?.inventory || null}
            refunds={refundData}
            filters={filters} 
            rawPerformance={isWeeklyMode ? weeklyData : performanceData}
            rawInventory={inventoryData}
            initialOpen
        /></Suspense>}
      </div>
    </div>
  );
};

export default App;


import React, { useState, useMemo, useEffect, useRef, useDeferredValue, Suspense } from 'react';
import { ActionItem, BusinessIssue, DataRow, TargetRow, FilterState, InventoryRow, RefundRow, ReviewRow, SearchTermRow, ProductImageRow, FilterSnapshot, DataCoverage, AppMeta, PeriodMode } from './types';
import { 
  calculatePeriodDates, 
  filterData, 
  aggregateData, 
  aggregatedFromCloud,
  getTargetForSelection, 
  analyzeDataCompleteness, 
  filterInventoryData, 
  aggregateInventoryData, 
  enrichTargetData, 
  getPacingRatio,
  getWeeklyAllocatedTarget,
  getDailyAllocatedTarget,
  applyFbaFeeCorrection,
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
import { LoadingBar } from './components/LoadingBar';
import { lazyWithRetry } from './components/lazyWithRetry';
import { CommandPalette, type CommandAction } from './components/CommandPalette';
import { getImageUploadState, resetImageUpload, subscribeImageUpload } from './components/imageUploadTask';
import { LoadingSkeleton } from './components/LoadingSkeleton';
import { buildViewLink, hasViewInUrl, readViewFromUrl, syncViewToUrl } from './components/viewUrl';
import { InventoryTable } from './components/InventoryTable';
import { DataUploadModal, type DataUploadResult } from './components/DataUploadModal';
import { resetTrendChartMetricsSelection } from './components/trendSelection';
import { UploadSlots, listMissingOptionalSlots } from './uploadFileClassifier';
const DetailAnalysisModal = lazyWithRetry(() => import('./components/DetailAnalysisModal').then(m => ({default: m.DetailAnalysisModal})));
const RefundAnalysisModal = lazyWithRetry(() => import('./components/RefundAnalysisModal').then(m => ({default: m.RefundAnalysisModal})));
const ProfitSimulatorModal = lazyWithRetry(() => import('./components/ProfitSimulatorModal').then(m => ({default: m.ProfitSimulatorModal})));
const ReviewAnalysisModal = lazyWithRetry(() => import('./components/ReviewAnalysisModal').then(m => ({default: m.ReviewAnalysisModal})));
const KeywordAnalysisModal = lazyWithRetry(() => import('./components/KeywordAnalysisModal').then(m => ({default: m.KeywordAnalysisModal})));
const ChatBot = lazyWithRetry(() => import('./components/ChatBot').then(m => ({default: m.ChatBot})));
import { AppSettingsButton } from './components/AppSettingsButton';
const CloudAdminPanel = lazyWithRetry(() => import('./components/CloudAdminPanel').then(m => ({ default: m.CloudAdminPanel })));
/** 含 recharts，懒加载避免拖大首屏包体 */
const ProfitWaterfall = lazyWithRetry(() => import('./components/ProfitWaterfall').then(m => ({ default: m.ProfitWaterfall })));
const StockHealth = lazyWithRetry(() => import('./components/StockHealth').then(m => ({ default: m.StockHealth })));
import { BusinessCommandCenter } from './components/BusinessCommandCenter';
import { AnomalyRadar } from './components/AnomalyRadar';
import { MetricMatrix } from './components/MetricMatrix';
import { buildRadarReport } from './utils/diagnosticRadar';
import { parseMonthlyPerformance, parseWeeklyPerformance, parseTargetData, parseInventoryData, parseRefundData, parseReviewData, parseProductImageData } from './dataLoader';
import { FileSpreadsheet, CalendarDays, Database, LayoutDashboard, Menu, X, Sparkles, Search } from 'lucide-react';
import { saveToDB, loadFromDB, replaceImportedData } from './db';
import { DEFAULT_BUSINESS_RULES, generateBusinessIssues, updateActionForIssue } from './utils/businessRules';
import { CLOUD_ENABLED, clearCloudToken, fetchCloudAggregate, fetchCloudFreshness, fetchCloudRows, fetchCloudTargets, getCloudToken, saveCloudToken, type CloudAggregate } from './cloudData';

const DEFAULT_DATA_START = '2025-01-01';
/** 稳定的空数组：避免每次渲染都造新引用，导致下游 useMemo 全部失效重算 */
const EMPTY_ROWS: DataRow[] = [];
/** 记住上次的粒度，刷新后不用重新点一次；第一次进来默认日度（看最新一天） */
const PERIOD_MODE_KEY = 'amazon-dashboard-period-mode';
const readStoredPeriodMode = (): PeriodMode => {
  try {
    const value = localStorage.getItem(PERIOD_MODE_KEY);
    return value === 'day' || value === 'week' || value === 'month' ? value : 'day';
  } catch {
    return 'day';
  }
};
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
  const [cloudTargetData, setCloudTargetData] = useState<TargetRow[]>([]);
  const [cloudTargetActive, setCloudTargetActive] = useState(false);
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
  /**
   * 默认进站视图：日度 + 昨天 + 全选（不带任何维度筛选）。
   * 只有地址栏带了视图参数（分享链接）时才按链接还原——否则一律干净进入。
   */
  const [filters, setFilters] = useState<FilterState>(() => {
      if (hasViewInUrl()) {
          const view = readViewFromUrl();
          return {
              ...initialFilters,
              ...view.filters,
              ...(view.from ? { startDate: view.from } : {}),
              ...(view.to ? { endDate: view.to } : {}),
          };
      }
      const yesterday = formatDate(new Date(Date.now() - 86400000));
      return { ...initialFilters, startDate: yesterday, endDate: yesterday };
  });
  const [dataStartDate, setDataStartDate] = useState(DEFAULT_DATA_START);
  const [dataEndDate, setDataEndDate] = useState('');
  const [lastImportedAt, setLastImportedAt] = useState<number | undefined>();
  /** 时间粒度：日 / 周 / 月。进站默认日度（分享链接带了粒度才用它） */
  const [periodMode, setPeriodMode] = useState<PeriodMode>(() => readViewFromUrl().mode || 'day');
  /** 聚焦路径：点 ASIN / 店铺等实体后，全站按它过滤，顶部面包屑逐级退出 */
  const [focusPath, setFocusPath] = useState<{ field: keyof FilterState; value: string; label: string }[]>([]);
  const isWeeklyMode = periodMode === 'week';
  const isDailyMode = periodMode === 'day';
  /** 毛利修正：FBA 国际运费已含在头程，领星算毛利时又扣了一次，勾选后加回来（默认开启） */
  const [addBackFbaFee, setAddBackFbaFee] = useState(() => {
    try {
      const stored = localStorage.getItem('amazon-dashboard-fba-fee-adjust');
      return stored === null ? true : stored === '1';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try { localStorage.setItem('amazon-dashboard-fba-fee-adjust', addBackFbaFee ? '1' : '0'); } catch { /* 忽略 */ }
  }, [addBackFbaFee]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  /** 桌面端（≥1280px）独立记录是否折叠，和移动端抽屉互不影响 */
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('amazon-dashboard-sidebar-collapsed') === '1'; } catch { return false; }
  });
  const [isDesktop, setIsDesktop] = useState(() => (typeof window === 'undefined' ? true : window.matchMedia('(min-width: 1280px)').matches));
  useEffect(() => {
    try { localStorage.setItem('amazon-dashboard-sidebar-collapsed', sidebarCollapsed ? '1' : '0'); } catch { /* 忽略 */ }
  }, [sidebarCollapsed]);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1280px)');
    const onChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const sidebarVisible = isDesktop ? !sidebarCollapsed : sidebarOpen;
  const toggleSidebar = () => {
    if (isDesktop) setSidebarCollapsed(value => !value);
    else setSidebarOpen(value => !value);
  };
  const [chatLoaded, setChatLoaded] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [isRestoringData, setIsRestoringData] = useState(true);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [persistenceError, setPersistenceError] = useState('');
  const [cloudToken, setCloudToken] = useState(() => CLOUD_ENABLED ? getCloudToken() : '');
  const [cloudTokenInput, setCloudTokenInput] = useState('');
  const [showCloudLogin, setShowCloudLogin] = useState(false);
  const [showCloudAdmin, setShowCloudAdmin] = useState(false);
  const [cloudRows, setCloudRows] = useState<DataRow[]>([]);
  /** 服务端聚合结果（KPI 首屏用）：{ key, current, last, year } */
  const [cloudAgg, setCloudAgg] = useState<{ key: string; current: CloudAggregate; last: CloudAggregate | null; year: CloudAggregate | null } | null>(null);
  const [cloudRowsRange, setCloudRowsRange] = useState('');
  const [cloudConnected, setCloudConnected] = useState(false);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudStatus, setCloudStatus] = useState('');
  /** 云端数据截止日（正常状态不占用版面，显示在设置面板里） */
  const [cloudCutoff, setCloudCutoff] = useState('');
  /** 最近一次成功同步的时间，同样收在设置面板 */
  const [cloudLastSync, setCloudLastSync] = useState('');

  /**
   * 首次进入（日度模式）直接定位到「最新有数据的那一天」：
   * 比如 25 号打开，默认选中 24 号，而不是当月 1 号。
   * 每次页面加载只生效一次，之后用户自己选的区间不会被覆盖。
   */
  const snappedToLatest = useRef(false);
  /** 默认进站日期（昨天），用于判断当前是否还是「干净视图」 */
  const initialDay = useRef(formatDate(new Date(Date.now() - 86400000)));
  useEffect(() => {
    if (snappedToLatest.current || periodMode !== 'day') return;
    // 进站默认已经定位到「昨天」，只有分享链接里的日期才需要跟随云端最新日期
    if (!hasViewInUrl()) return;
    const latest = cloudCutoff || dataEndDate;
    if (!latest) return;
    snappedToLatest.current = true;
    setFilters(prev => (prev.startDate === latest && prev.endDate === latest ? prev : { ...prev, startDate: latest, endDate: latest }));
  }, [cloudCutoff, dataEndDate, periodMode]);

  /**
   * 不再自动把筛选写进地址栏。
   * 原因：写进 URL 后，下次打开同一个地址就会「恢复上次点过的 ASIN」，
   * 让每次进站都变成全选/日度/昨天的干净视图 —— 分享仍然用命令面板的「复制视图链接」。
   */

  /** 浏览器前进/后退 → 还原当时视图 */
  useEffect(() => {
    const onPop = () => {
      const view = readViewFromUrl();
      if (view.mode) setPeriodMode(view.mode);
      setFilters(prev => ({
        ...prev,
        ...view.filters,
        ...(view.from ? { startDate: view.from } : {}),
        ...(view.to ? { endDate: view.to } : {}),
      }));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /** 聚焦某个实体（ASIN / 店铺 / 负责人…）：写入对应筛选 + 记到面包屑 */
  const focusEntity = (field: keyof FilterState, value: string, label?: string) => {
    if (!value || value === '-' || value.startsWith('共 ')) return;
    setFocusPath(prev => [...prev.filter(item => item.field !== field), { field, value, label: label || value }]);
    setFilters(prev => ({ ...prev, [field]: [value] } as FilterState));
  };

  const blurEntity = (field: keyof FilterState) => {
    setFocusPath(prev => prev.filter(item => item.field !== field));
    setFilters(prev => ({ ...prev, [field]: [] } as FilterState));
  };

  const clearAllFocus = () => {
    const fields = focusPath.map(item => item.field);
    setFocusPath([]);
    if (!fields.length) return;
    setFilters(prev => {
      const next = { ...prev } as FilterState;
      for (const field of fields) (next as unknown as Record<string, string[]>)[field as string] = [];
      return next;
    });
  };

  /** 键盘：? 快捷键表 · g d/w/m 切粒度 · Esc 退出聚焦 */
  useEffect(() => {
    let pendingG = false;
    let timer = 0;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === '?') {
        event.preventDefault();
        setShortcutsOpen(value => !value);
        return;
      }
      if (event.key === '/') {
        event.preventDefault();
        setCommandOpen(true);
        return;
      }
      if (event.key === 'Escape') {
        clearAllFocus();
        return;
      }
      if (event.key === 'g') {
        pendingG = true;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => { pendingG = false; }, 1200);
        return;
      }
      if (pendingG && (event.key === 'd' || event.key === 'w' || event.key === 'm')) {
        pendingG = false;
        setPeriodMode(event.key === 'd' ? 'day' : event.key === 'w' ? 'week' : 'month');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusPath]);
  const [cloudRefreshTick, setCloudRefreshTick] = useState(0);
  /** 区间 → 云端结果缓存：5 分钟内切回同一区间直接命中，不再等三次接口 */
  const cloudRangeCache = useRef(new Map<string, { at: number; rows: DataRow[]; targets: any; latestDate: string }>());
  /** 命令面板（⌘K）：键盘完成切粒度、跳区间、开数据管理、下钻等操作 */
  const [commandOpen, setCommandOpen] = useState(false);
  /** 主页视图：总览（雷达+三张表）/ 诊断（瀑布+矩阵+库存健康） */
  const [homeView, setHomeView] = useState<'overview' | 'diagnose'>(() => {
    try { return localStorage.getItem('amazon-dashboard-home-view') === 'diagnose' ? 'diagnose' : 'overview'; } catch { return 'overview'; }
  });
  useEffect(() => {
    try { localStorage.setItem('amazon-dashboard-home-view', homeView); } catch { /* 忽略 */ }
  }, [homeView]);
  /** 云端管理面板打开时定位到哪个 tab（图片上传浮层点进来时用） */
  const [adminInitialTab, setAdminInitialTab] = useState<'images' | undefined>(undefined);
  /** 图片上传是后台任务：面板关掉也要能看到进度 */
  const [uploadTask, setUploadTask] = useState(getImageUploadState());
  useEffect(() => subscribeImageUpload(setUploadTask), []);
  /** 数据源：云端 / 本地导入（记住选择） */
  const [dataSource, setDataSource] = useState<'cloud' | 'local'>(() => {
    try { return localStorage.getItem('amazon-dashboard-data-source') === 'local' ? 'local' : 'cloud'; } catch { return 'cloud'; }
  });
  useEffect(() => {
    try { localStorage.setItem('amazon-dashboard-data-source', dataSource); } catch { /* 忽略 */ }
  }, [dataSource]);

  /** 趋势用的长历史（服务端按月/周聚合）：点开趋势时不再只有当前区间 */
  const [trendHistory, setTrendHistory] = useState<{ month: DataRow[]; week: DataRow[] }>({ month: [], week: [] });
  useEffect(() => {
    if (!CLOUD_ENABLED || !cloudToken || !cloudConnected) return;
    let cancelled = false;
    void (async () => {
      try {
        const headers = { Authorization: `Bearer ${cloudToken}` };
        const [monthResponse, weekResponse] = await Promise.all([
          fetch('/api/trend?mode=month&periods=24', { headers }),
          fetch('/api/trend?mode=week&periods=52', { headers }),
        ]);
        const month = monthResponse.ok ? await monthResponse.json() : null;
        const week = weekResponse.ok ? await weekResponse.json() : null;
        if (cancelled) return;
        setTrendHistory({
          month: Array.isArray(month?.rows) ? month.rows : [],
          week: Array.isArray(week?.rows) ? week.rows : [],
        });
      } catch { /* 失败就退回当前区间数据 */ }
    })();
    return () => { cancelled = true; };
  }, [cloudConnected, cloudToken]);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
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
              /**
               * 只有「分享链接」才还原上次的筛选。
               * 正常情况下进站一律全选 + 日度 + 昨天，避免上次点过的 ASIN 一直粘着。
               */
              const restoreFilters = hasViewInUrl();
              if (savedMeta && !restoreFilters) {
                  const meta = savedMeta as AppMeta;
                  if (meta.dataStartDate) setDataStartDate(meta.dataStartDate);
                  if (meta.dataEndDate) setDataEndDate(meta.dataEndDate);
                  if (meta.lastImportedAt) setLastImportedAt(meta.lastImportedAt);
              } else if (savedMeta) {
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

  useEffect(() => {
      if (!CLOUD_ENABLED) return;
      const timer = window.setInterval(() => setCloudRefreshTick(value => value + 1), 15 * 60 * 1000);
      return () => window.clearInterval(timer);
  }, []);

  // 记住上次的粒度；没有云端密码时回到月度，避免刷新后停在一个没有数据的日度视图
  useEffect(() => {
      try { localStorage.setItem(PERIOD_MODE_KEY, periodMode); } catch { /* 忽略隐私模式下的写入失败 */ }
  }, [periodMode]);

  useEffect(() => {
      if (periodMode === 'day' && !cloudToken) setPeriodMode('month');
  }, [periodMode, cloudToken]);

  useEffect(() => {
      if (!CLOUD_ENABLED || !cloudToken || isRestoringData) return;
      const controller = new AbortController();
      setCloudLoading(true);
      const refresh = async () => {
          try {
              /**
               * 区间缓存：切回刚看过的区间直接命中，不再等三次接口。
               * 5 分钟内有效；切到新区间才真正请求。
               */
              const cacheKey = `${filters.startDate}|${filters.endDate}`;
              const cached = cloudRangeCache.current.get(cacheKey);
              if (cached && Date.now() - cached.at < 5 * 60 * 1000) {
                  setCloudRows(cached.rows);
                  setCloudTargetData(cached.targets?.rows || []);
                  setCloudTargetActive(cached.targets?.active || false);
                  setCloudRowsRange(cacheKey);
                  setCloudConnected(true);
                  setCloudCutoff(cached.latestDate || '');
                  setCloudStatus('');
                  setCloudLoading(false);
                  return;
              }
              const freshness = await fetchCloudFreshness(cloudToken, controller.signal);
              if (!freshness.latest_date) throw new Error('云端尚无数据；同步服务完成首次抓取后会自动显示');
              if (!filters.startDate || !filters.endDate) {
                  const latest = freshness.latest_date;
                  setFilters(prev => ({ ...prev, startDate: `${latest.slice(0, 7)}-01`, endDate: latest }));
                  return;
              }
              /**
               * 先并行发起两路：聚合（几百字节，快）+ 明细（十几万行，慢）。
               * 聚合先回来就先画 KPI，明细到了再补表格/下钻——这就是首屏变快的关键。
               */
              const aggregatePromise = fetchCloudAggregate(filters.startDate, filters.endDate, cloudToken, controller.signal).catch(() => null);
              const [rows, targets] = await (async () => {
                  const rowsPromise = fetchCloudRows(filters.startDate, filters.endDate, cloudToken, controller.signal);
                  const targetsPromise = fetchCloudTargets(filters.startDate, filters.endDate, cloudToken, controller.signal).catch(() => null);
                  const aggregate = await aggregatePromise;
                  if (aggregate && !controller.signal.aborted) setCloudAgg({ key: cacheKey, ...aggregate });
                  return Promise.all([rowsPromise, targetsPromise]);
              })();
              if (controller.signal.aborted) return;
              setCloudRows(rows);
              setCloudTargetData(targets?.rows || []);
              setCloudTargetActive(targets?.active || false);
              setCloudRowsRange(`${filters.startDate}|${filters.endDate}`);
              cloudRangeCache.current.set(cacheKey, { at: Date.now(), rows, targets, latestDate: freshness.latest_date });
              setCloudConnected(true);
              setCloudCutoff(freshness.latest_date || '');
              setCloudLastSync(freshness.latestRun?.finished_at
                  ? new Date(freshness.latestRun.finished_at).toLocaleString('zh-CN', { hour12: false })
                  : '');
              // 状态条只在「需要你处理」时出现：同步失败、覆盖天数太少、目标读取失败。
              // 正常情况不占地方，截止日期挪到设置面板里显示。
              const coverageDays = freshness.first_date && freshness.latest_date
                  ? Math.round((Date.parse(freshness.latest_date) - Date.parse(freshness.first_date)) / 86400000) + 1
                  : 0;
              const issues: string[] = [];
              if (freshness.latestRun?.status === 'failed') {
                  issues.push(`云端最近一次同步失败，数据截至 ${freshness.latest_date}`);
              }
              if (coverageDays > 0 && coverageDays < 7) {
                  issues.push(`云端仅 ${coverageDays} 天数据（${freshness.first_date} ~ ${freshness.latest_date}），可在「数据管理」补数`);
              }
              if (targets === null) issues.push('云端目标读取失败，暂用本地目标');
              setCloudStatus(issues.join(' · '));
              setDataEndDate(freshness.latest_date);
              setLastImportedAt(freshness.latestRun?.finished_at ? Date.parse(freshness.latestRun.finished_at) : undefined);
              /**
               * 商品图片有两个来源，合并使用：
               *   1) 你上传的图片表（人工指定，优先级最高）
               *   2) 每日库存快照里的领星主图 pic_url（自动，无需上传）
               * 两路都是可选的，失败不影响主流程。
               */
              if (productImageData.length === 0) {
                  const headers = { Authorization: `Bearer ${cloudToken}` };
                  Promise.all([
                      fetch('/api/product-images', { headers }).then(response => (response.ok ? response.json() : null)).catch(() => null),
                      fetch('/api/inventory', { headers }).then(response => (response.ok ? response.json() : null)).catch(() => null),
                  ]).then(([imagePayload, inventoryPayload]) => {
                      const uploaded = Array.isArray(imagePayload?.rows) ? imagePayload.rows : [];
                      const fromInventory = (Array.isArray(inventoryPayload?.rows) ? inventoryPayload.rows : [])
                          .filter((row: { pic_url?: string; asin?: string }) => row.pic_url && /^https?:\/\//i.test(String(row.pic_url)))
                          .map((row: { pic_url: string; asin?: string; product_name?: string }) => ({
                              sku: '',
                              product_name: row.product_name || '',
                              image_url: row.pic_url,
                              asin: row.asin || '',
                          }));
                      const merged = [...uploaded, ...fromInventory];
                      if (merged.length) setProductImageData(merged);
                  }).catch(() => { /* 图片源缺失不影响主流程 */ });
              }
          } catch (error) {
              if (controller.signal.aborted) return;
              const message = String(error instanceof Error ? error.message : error);
              if (message.includes('密码不正确')) setCloudConnected(false);
              setCloudStatus(`云端连接失败：${message}。${message.includes('密码不正确') ? '请重新输入只读密码。' : '可稍后重试；当前周期仅显示已成功读取的数据。'}`);
          } finally {
              if (!controller.signal.aborted) setCloudLoading(false);
          }
      };
      refresh();
      return () => controller.abort();
  }, [cloudToken, filters.startDate, filters.endDate, isRestoringData, cloudRefreshTick]);

  const connectCloud = () => {
      const token = cloudTokenInput.trim();
      if (!token) return;
      saveCloudToken(token);
      setCloudToken(token);
      setCloudRefreshTick(value => value + 1);
      setShowCloudLogin(false);
      setCloudTokenInput('');
  };
  const disconnectCloud = () => {
      clearCloudToken();
      setCloudToken('');
      setCloudConnected(false);
      setCloudRows([]);
      setCloudTargetData([]);
      setCloudTargetActive(false);
      setCloudRowsRange('');
      setCloudStatus('');
      setCloudCutoff('');
      loadFromDB('meta').then((meta: AppMeta | null) => {
          setDataEndDate(meta?.dataEndDate || '');
          setLastImportedAt(meta?.lastImportedAt);
      }).catch(error => setPersistenceError(`读取本地状态失败：${String(error)}`));
  };

  const visibleCloudRows = cloudRowsRange === `${filters.startDate}|${filters.endDate}` ? cloudRows : EMPTY_ROWS;
  /** 数据源开关：云端 / 本地导入。云端连上后仍可切回自己上传的数据 */
  const useCloudData = CLOUD_ENABLED && cloudConnected && dataSource === 'cloud';
  const basePerformance = useCloudData ? visibleCloudRows : performanceData;
  const baseWeekly = useCloudData ? visibleCloudRows : weeklyData;
  const baseDaily = useCloudData ? visibleCloudRows : EMPTY_ROWS;
  // 「毛利修正」：勾选后把 FBA 国际运费加回毛利（该费用已含在头程，领星又扣了一次）
  const displayPerformanceData = useMemo(() => applyFbaFeeCorrection(basePerformance, addBackFbaFee), [basePerformance, addBackFbaFee]);
  const displayWeeklyData = useMemo(() => applyFbaFeeCorrection(baseWeekly, addBackFbaFee), [baseWeekly, addBackFbaFee]);
  /** 日粒度只在云端可用：云端 fact_daily 是真正的按天数据，本地导入的月报/周报没有日粒度 */
  const displayDailyData = useMemo(() => applyFbaFeeCorrection(baseDaily, addBackFbaFee), [baseDaily, addBackFbaFee]);
  const displayTargetData = useCloudData && cloudTargetActive ? cloudTargetData : targetData;
  const activeRawData = isDailyMode ? displayDailyData : isWeeklyMode ? displayWeeklyData : displayPerformanceData;

  // --- 2. Save Filters + data coverage when they change ---
  useEffect(() => {
      if (!isRestoringData && !cloudConnected && performanceData.length > 0 && filters.startDate) {
          const meta: AppMeta = {
              filters,
              dataStartDate,
              dataEndDate,
              lastImportedAt,
          };
          saveToDB('meta', meta).catch(e => setPersistenceError(`筛选设置保存失败：${String(e)}`));
      }
  }, [filters, dataStartDate, dataEndDate, lastImportedAt, isRestoringData, performanceData, cloudConnected]);

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
    const newTargets = slots.target ? enrichTargetData(parsedTargets, monthlyRes.data) : targetData;
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
        missingOptional: listMissingOptionalSlots(slots).filter(label => label !== '全年目标表' || (!targetData.length && !cloudTargetActive)),
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
            setPeriodMode('month');
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
      setPeriodMode(snapshot.periodMode || (snapshot.isWeeklyMode ? 'week' : 'month'));
      // 用 setTimeout 确保 mode 切换已生效再设 filters
      setFilters(snapshot.filters);
  };

  /** 切换时间粒度，并把筛选区间落到该粒度的自然边界上 */
  const handleSetPeriodMode = (mode: PeriodMode) => {
      setPeriodMode(mode);
      const now = new Date();
      const fmt = (d: Date) => `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`;
      // 以「数据截止日」为准，避免切到没有数据的空区间
      const anchorStr = dataEndDate && /^\d{4}-\d{2}-\d{2}$/.test(dataEndDate) ? dataEndDate : fmt(now);
      const [ay, am, ad] = anchorStr.split('-').map(Number);
      const anchor = new Date(ay, am - 1, ad);

      if (mode === 'week') {
          // 默认看上一个完整自然周（数据通常截止到昨天/今天）
          const lastWeekDay = new Date(anchor.getTime() - 7 * 24 * 60 * 60 * 1000);
          const { start, end } = getISOWeekDateRange(lastWeekDay);
          setFilters(prev => ({ ...prev, startDate: formatDate(start), endDate: formatDate(end) }));
      } else if (mode === 'day') {
          // 默认最近 7 天（含截止日），只有一个日期时就是单日
          const start = new Date(anchor);
          start.setDate(anchor.getDate() - 6);
          setFilters(prev => ({ ...prev, startDate: fmt(start), endDate: fmt(anchor) }));
      } else {
          // 月度回到截止日所在自然月
          const start = new Date(ay, am - 1, 1);
          const end = new Date(ay, am, 0);
          setFilters(prev => ({ ...prev, startDate: fmt(start), endDate: fmt(end) }));
      }
  };

  // --- Processing Logic ---
  
  const processedData = useMemo(() => {
      const activeData = activeRawData;
      /**
       * 云端聚合（几百字节）：明细还没到也能先把 KPI / 利润表画出来。
       * 明细到了之后 currentRows 才有值，用于瀑布归因、矩阵、下钻。
       */
      const cloudMatch = useCloudData && cloudAgg && cloudAgg.key === `${filters.startDate}|${filters.endDate}` ? cloudAgg : null;
      if (activeData.length === 0 && !cloudMatch) return null;
      if (!filters.startDate || !filters.endDate) return null;

      const periods = calculatePeriodDates(filters.startDate, filters.endDate);
      
      // Filter Data for periods
      const currentRows = filterData(activeData, periods.current, filters);
      const lastRows = filterData(activeData, periods.last, filters);
      const yearRows = filterData(activeData, periods.year, filters);
      // Aggregate：优先用服务端聚合结果（首屏快），没有再回退到明细聚合
      const current = cloudMatch ? aggregatedFromCloud(cloudMatch.current as unknown as Record<string, unknown>) : aggregateData(currentRows);
      const last = cloudMatch
          ? (cloudMatch.last ? aggregatedFromCloud(cloudMatch.last as unknown as Record<string, unknown>) : null)
          : (lastRows.length > 0 ? aggregateData(lastRows) : null);
      const year = cloudMatch
          ? (cloudMatch.year ? aggregatedFromCloud(cloudMatch.year as unknown as Record<string, unknown>) : null)
          : (yearRows.length > 0 ? aggregateData(yearRows) : null);

      // Targets：月度取全月目标；周度/日度按天拆成「区间分摊月目标」。序时仅月度展示用。
      /**
       * 序时进度 = 区间内「已过去的天数」占比。
       * 之前只在月度算，日/周直接返回 1，导致永远显示 100%——这才是「序时一直 100%」的原因。
       */
      const pacingRatio = (() => {
          const start = periods.current.start instanceof Date ? formatDate(periods.current.start) : String(periods.current.start);
          const end = periods.current.end instanceof Date ? formatDate(periods.current.end) : String(periods.current.end);
          const dayMs = 86400000;
          const startMs = Date.parse(`${start}T00:00:00Z`);
          const endMs = Date.parse(`${end}T00:00:00Z`);
          if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return 1;
          const totalDays = Math.round((endMs - startMs) / dayMs) + 1;
          const cutoffMs = dataEndDate ? Date.parse(`${dataEndDate}T00:00:00Z`) : endMs;
          const coveredDays = Math.round((Math.min(endMs, Number.isFinite(cutoffMs) ? cutoffMs : endMs) - startMs) / dayMs) + 1;
          return Math.min(Math.max(coveredDays / totalDays, 0), 1);
      })();
      const target = periodMode === 'month'
          ? getTargetForSelection(displayTargetData, periods.current.start, periods.current.end, filters, 1)
          : periodMode === 'week'
              ? getWeeklyAllocatedTarget(displayTargetData, periods.current.start, periods.current.end, filters)
              : getDailyAllocatedTarget(displayTargetData, periods.current.start, periods.current.end, filters);

      // Inventory (Snapshot logic usually, here simplified filter)
      const invRows = filterInventoryData(inventoryData, filters);
      const inventory = aggregateInventoryData(invRows);

      // Analysis
      // 明细还没到时不要报「数据缺失」——用聚合渲染期间，只保留目标相关提醒
      const dataCompleteness = cloudMatch && currentRows.length === 0
          ? { warnings: [] as string[] }
          : analyzeDataCompleteness(currentRows, lastRows, yearRows, periods);
      const targetWarnings = analyzeTargetCompleteness(displayTargetData, periods.current.start, periods.current.end);
      
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
  }, [activeRawData, displayTargetData, inventoryData, filters, periodMode, dataEndDate, cloudAgg, useCloudData]);

  /** 经营异常雷达：核心指标毛利额 → 三维（销量/客单价/毛利率）→ 根因 → 动作 */
  const radar = useMemo(() => {
      if (!processedData) return null;
      return buildRadarReport({
          current: processedData.current,
          last: processedData.last,
          year: processedData.year,
          target: processedData.target
              ? { gross_profit: processedData.target.gross_profit, sales_amount: processedData.target.sales_amount }
              : null,
          currentRows: processedData.currentRows,
          lastRows: processedData.lastRows,
      });
  }, [processedData]);
  const businessIssues = useMemo(() => {
      if (!processedData) return [];
      return generateBusinessIssues({
          current: processedData.current,
          last: processedData.last,
          target: processedData.target,
          inventory: processedData.inventory,
          warnings: processedData.warnings,
          pacingRatio: processedData.pacingRatio,
          periodMode: periodMode,
      });
  }, [processedData, periodMode]);

  useEffect(() => {
      const onKey = (event: KeyboardEvent) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
              event.preventDefault();
              setCommandOpen(value => !value);
          }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** 命令面板动作：全部复用现有 handler，保证和按钮行为一致 */
  const commandActions: CommandAction[] = (() => {
      const today = new Date();
      const shift = (days: number) => {
          const date = new Date(today);
          date.setDate(date.getDate() + days);
          return formatDate(date);
      };
      const thisMonthStart = formatDate(new Date(today.getFullYear(), today.getMonth(), 1));
      const thisMonthEnd = formatDate(new Date(today.getFullYear(), today.getMonth() + 1, 0));
      const lastMonthStart = formatDate(new Date(today.getFullYear(), today.getMonth() - 1, 1));
      const lastMonthEnd = formatDate(new Date(today.getFullYear(), today.getMonth(), 0));
      return [
          { id: 'mode-day', label: '切到日度视图', group: '视图', keywords: ['day', '每天', '按天'], run: () => setPeriodMode('day') },
          { id: 'mode-week', label: '切到周度视图', group: '视图', keywords: ['week', '按周'], run: () => setPeriodMode('week') },
          { id: 'mode-month', label: '切到月度视图', group: '视图', keywords: ['month', '按月'], run: () => setPeriodMode('month') },
          { id: 'range-this-month', label: '本月', group: '区间', run: () => { setPeriodMode('month'); setFilters(prev => ({ ...prev, startDate: thisMonthStart, endDate: thisMonthEnd })); } },
          { id: 'range-last-month', label: '上月', group: '区间', run: () => { setPeriodMode('month'); setFilters(prev => ({ ...prev, startDate: lastMonthStart, endDate: lastMonthEnd })); } },
          { id: 'range-last-7', label: '近 7 天', group: '区间', run: () => { setPeriodMode('day'); setFilters(prev => ({ ...prev, startDate: shift(-6), endDate: shift(0) })); } },
          { id: 'range-last-30', label: '近 30 天', group: '区间', run: () => { setPeriodMode('day'); setFilters(prev => ({ ...prev, startDate: shift(-29), endDate: shift(0) })); } },
          { id: 'admin', label: '打开数据管理', group: '数据', keywords: ['补数', '质量', '目标表', '图片'], run: () => setShowCloudAdmin(true) },
          { id: 'connect', label: '连接 / 切换云端数据', group: '数据', run: () => setShowCloudLogin(true) },
          { id: 'refresh', label: '重新拉取云端数据', group: '数据', keywords: ['刷新', '同步'], run: () => setCloudRefreshTick(value => value + 1) },
          { id: 'upload', label: '导入 / 更新数据源', group: '数据', keywords: ['上传', 'excel'], run: () => setShowUploadModal(true) },
          { id: 'detail-pl', label: '打开利润表明细', group: '下钻', run: () => handleOpenDetailByType('PL') },
          { id: 'detail-traffic', label: '打开流量广告明细', group: '下钻', run: () => handleOpenDetailByType('Traffic') },
          { id: 'detail-inventory', label: '打开库存明细', group: '下钻', run: () => handleOpenDetailByType('Inventory') },
          { id: 'fee', label: addBackFbaFee ? '关闭毛利修正' : '开启毛利修正', group: '口径', keywords: ['运费', '国际运费'], run: () => setAddBackFbaFee(value => !value) },
          { id: 'sidebar', label: '显示 / 隐藏筛选侧栏', group: '界面', run: toggleSidebar },
          { id: 'copy-link', label: '复制当前视图链接', group: '分享', keywords: ['share', 'url', '发给同事'], run: () => { void navigator.clipboard?.writeText(buildViewLink(periodMode, filters)); } },
          { id: 'source-cloud', label: '数据源：云端', group: '数据', keywords: ['database'], run: () => setDataSource('cloud') },
          { id: 'source-local', label: '数据源：本地导入', group: '数据', keywords: ['excel', '上传'], run: () => setDataSource('local') },
          { id: 'clear-focus', label: '清除聚焦', group: '视图', run: clearAllFocus },
          { id: 'view-overview', label: '视图：总览（雷达 + 三张表）', group: '视图', keywords: ['home'], run: () => setHomeView('overview') },
          { id: 'view-diagnose', label: '视图：诊断（瀑布 / 矩阵 / 库存健康）', group: '视图', keywords: ['diagnose'], run: () => setHomeView('diagnose') },
          { id: 'shortcuts', label: '查看快捷键', group: '帮助', keywords: ['keyboard', '帮助'], run: () => setShortcutsOpen(true) },
      ];
  })();

  return (
    <div className="flex h-screen overflow-hidden bg-[radial-gradient(circle_at_top,#e0f2fe_0%,#eff6ff_22%,#f8fafc_52%,#f8fafc_100%)] font-sans text-slate-900">
      {sidebarOpen && <button type="button" aria-label="关闭筛选侧栏" onClick={() => setSidebarOpen(false)} className="fixed inset-0 z-30 bg-slate-950/50 xl:hidden" />}
      <div className={`fixed inset-y-0 left-0 z-40 transition-transform xl:relative xl:z-20 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} ${sidebarCollapsed ? 'xl:hidden' : 'xl:translate-x-0'}`}>
      <SidebarFilters 
        data={activeRawData}
        inventoryData={inventoryData}
        targetData={displayTargetData}
        filters={filters} 
        setFilters={setFilters} 
        warnings={processedData?.warnings}
        periodMode={periodMode}
        onRangeChange={(startDate, endDate, mode) => {
            setPeriodMode(mode);
            setFilters(prev => ({ ...prev, startDate, endDate }));
        }}
        onLoadSnapshot={handleLoadSnapshot}
      />
      </div>
      
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Top Bar */}
        <header className="relative z-10 mx-3 mt-3 flex flex-shrink-0 flex-wrap items-center justify-between gap-3 rounded-3xl border border-white/70 bg-white/85 px-4 py-3 shadow-[0_24px_70px_-42px_rgba(15,23,42,0.45)] backdrop-blur-xl">
            <div className="flex items-center gap-5">
                <button type="button" aria-label={sidebarVisible ? '隐藏筛选侧栏' : '显示筛选侧栏'} title={sidebarVisible ? '隐藏筛选侧栏' : '显示筛选侧栏'} onClick={toggleSidebar} className="rounded-xl border border-slate-200 p-2 text-slate-700 transition hover:border-sky-300 hover:text-sky-700">{sidebarVisible ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
                <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#0f172a_0%,#2563eb_100%)] text-white shadow-lg shadow-sky-500/20">
                        <LayoutDashboard className="w-5 h-5" />
                    </div>
                    <span className="hidden text-sm font-bold text-slate-900 sm:inline">亚马逊业绩复盘</span>
                </div>
                <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/90 p-1">
                    {([
                        { mode: 'month' as PeriodMode, label: '月度' },
                        { mode: 'week' as PeriodMode, label: '周度' },
                        { mode: 'day' as PeriodMode, label: '日度' },
                    ]).map(({ mode, label }) => {
                        const active = periodMode === mode;
                        const disabled = mode === 'day' && !cloudConnected;
                        return (
                            <button
                                key={mode}
                                type="button"
                                onClick={() => !disabled && handleSetPeriodMode(mode)}
                                disabled={disabled}
                                title={disabled ? '日度视图需要连接云端数据（云端按天同步）；本地导入的月报/周报没有日粒度' : undefined}
                                className={`px-3.5 py-2 text-xs font-bold rounded-xl transition-all disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'bg-white text-sky-700 shadow-sm ring-1 ring-sky-100' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                {label}
                            </button>
                        );
                    })}
                </div>
            </div>
            
            <div className="flex items-center gap-2 sm:gap-3">
                <WorldClock />
                <div className="h-8 w-px bg-slate-200 mx-1 hidden lg:block"></div>

                <AppSettingsButton
                    cloudEnabled={CLOUD_ENABLED}
                    cloudConnected={cloudConnected}
                    cloudLoading={cloudLoading}
                    cloudCutoff={cloudCutoff}
                    cloudLastSync={cloudLastSync}
                    onOpenCloudLogin={() => setShowCloudLogin(true)}
                    onOpenCloudAdmin={() => setShowCloudAdmin(true)}
                    addBackFbaFee={addBackFbaFee}
                    onToggleFbaFee={setAddBackFbaFee}
                    dataSource={dataSource}
                    onChangeDataSource={setDataSource}
                />

                <button
                    type="button"
                    onClick={() => setCommandOpen(true)}
                    title="搜索功能或输入命令（⌘K / Ctrl+K）"
                    className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 transition hover:border-sky-300 hover:text-sky-700 sm:flex"
                >
                    <Search className="h-3.5 w-3.5" />
                    搜索命令
                    <span className="rounded border border-slate-200 px-1 py-0.5 text-[10px] text-slate-400">⌘K</span>
                </button>

                <button 
                    onClick={() => setShowUploadModal(true)}
                    disabled={restoreFailed}
                    title={restoreFailed ? '本地数据读取失败，刷新并排查后再导入' : undefined}
                    className="flex items-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#0284c7_0%,#2563eb_100%)] px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-sky-500/20 transition-all hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <FileSpreadsheet className="w-4 h-4" />
                    {displayPerformanceData.length > 0 ? '更新数据源' : '导入数据源'}
                </button>
            </div>
        </header>
        {showCloudAdmin && <Suspense fallback={null}><CloudAdminPanel initialTab={adminInitialTab} onClose={() => { setShowCloudAdmin(false); setAdminInitialTab(undefined); }} onTargetsUpdated={() => setCloudRefreshTick(value => value + 1)} /></Suspense>}
        <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} actions={commandActions} />

        {shortcutsOpen && (
            <div className="fixed inset-0 z-[220] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm" onClick={() => setShortcutsOpen(false)} role="dialog" aria-modal="true">
                <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl" onClick={event => event.stopPropagation()}>
                    <h3 className="text-sm font-semibold text-slate-800">快捷键</h3>
                    <div className="mt-3 space-y-2 text-xs text-slate-600">
                        {[
                            ['⌘K / Ctrl+K', '打开命令面板'],
                            ['/', '搜索功能或命令'],
                            ['g 然后 d / w / m', '切换日 / 周 / 月'],
                            ['Esc', '退出聚焦 / 关闭弹层'],
                            ['↑ ↓ / Enter', '命令面板里选择与执行'],
                        ].map(([key, desc]) => (
                            <div key={key} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-1.5">
                                <span className="font-mono text-[11px] text-slate-700">{key}</span>
                                <span className="text-slate-500">{desc}</span>
                            </div>
                        ))}
                    </div>
                    <p className="mt-3 text-[11px] text-slate-400">点表格里的 ASIN / 店铺会自动聚焦，顶部出现面包屑，Esc 退出。</p>
                    <button type="button" onClick={() => setShortcutsOpen(false)} className="mt-4 w-full rounded-lg bg-slate-900 py-2 text-xs font-semibold text-white">知道了</button>
                </div>
            </div>
        )}

        {/* 后台上传浮层：关掉数据管理面板也不会中断，随时能点回来 */}
        {uploadTask.status !== 'idle' && (
            <div className="fixed bottom-4 right-4 z-[215] flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/95 px-3 py-2 shadow-xl backdrop-blur">
                <span className={`h-2 w-2 rounded-full ${
                    uploadTask.status === 'error' ? 'bg-rose-500'
                        : uploadTask.status === 'done' ? 'bg-emerald-500'
                            : 'bg-sky-500 animate-pulse'
                }`} />
                <button
                    type="button"
                    onClick={() => { setAdminInitialTab('images'); setShowCloudAdmin(true); }}
                    className="text-left text-[11px] leading-tight text-slate-600 hover:text-sky-700"
                >
                    <span className="block font-semibold">
                        {uploadTask.status === 'parsing' && '图片表解析中…'}
                        {uploadTask.status === 'uploading' && `图片表上传 ${uploadTask.total ? Math.round((uploadTask.done / uploadTask.total) * 100) : 0}%`}
                        {uploadTask.status === 'activating' && '正在启用图片表…'}
                        {uploadTask.status === 'done' && `图片表已保存 ${uploadTask.message.replace('已保存 ', '')}`}
                        {uploadTask.status === 'error' && '图片表上传失败'}
                    </span>
                    <span className="block text-[10px] text-slate-400">
                        {uploadTask.status === 'uploading' ? `${uploadTask.done} / ${uploadTask.total} 行 · 可关闭窗口` : uploadTask.status === 'error' ? uploadTask.message : '后台进行中，可关闭窗口'}
                    </span>
                </button>
                <button
                    type="button"
                    onClick={() => resetImageUpload()}
                    aria-label="关闭提示"
                    className="ml-1 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>
        )}

        {/* Scrollable Content */}
        <main className="flex-1 overflow-y-auto p-3 sm:p-6 custom-scroll">
            {CLOUD_ENABLED && cloudStatus && <div role="status" className="mx-auto mb-3 max-w-[1680px] rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">{cloudStatus}</div>}
            {persistenceError && <div role="alert" className="mx-auto mb-3 flex max-w-[1680px] items-center justify-between rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800"><span>{persistenceError}</span><button type="button" onClick={() => setPersistenceError('')} className="ml-3 font-bold">关闭</button></div>}

            {/* 聚焦面包屑：点表格里的 ASIN / 店铺后出现，逐级退出 */}
            {focusPath.length > 0 && (
                <div className="mx-auto mb-3 flex max-w-[1680px] flex-wrap items-center gap-1.5 rounded-xl border border-sky-100 bg-sky-50/70 px-3 py-1.5 text-[11px] text-sky-900">
                    <span className="font-semibold">聚焦</span>
                    {focusPath.map(item => (
                        <button
                            key={`${item.field}-${item.value}`}
                            type="button"
                            onClick={() => blurEntity(item.field)}
                            className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 ring-1 ring-sky-100 transition hover:ring-sky-300"
                        >
                            {item.label}
                            <X className="h-3 w-3" />
                        </button>
                    ))}
                    <button type="button" onClick={clearAllFocus} className="ml-1 text-sky-600 transition hover:text-sky-800">全部清除</button>
                    <span className="ml-auto hidden text-[10px] text-sky-400 sm:inline">Esc 退出聚焦</span>
                </div>
            )}
            {isRestoringData ? (
                <div className="flex flex-col items-center justify-center rounded-3xl border border-white/80 bg-white/80 py-24 text-slate-400 shadow-[0_24px_70px_-42px_rgba(15,23,42,0.45)] backdrop-blur-xl">
                    <Database className="mb-4 h-12 w-12 text-sky-300 animate-pulse" />
                    <p className="text-lg font-semibold text-slate-700">正在恢复本地缓存…</p>
                    <LoadingBar className="mt-5" />
                </div>
            ) : (
                <div className="max-w-[1680px] mx-auto space-y-6 pb-20">
                    {processedData && (
                        <p className="text-[11px] text-slate-400">
                            毛利口径：{addBackFbaFee ? '已加回 FBA 国际运费（原始值见导出表「订单毛利润」）' : '领星原始值，未加回 FBA 国际运费'}
                        </p>
                    )}
                    
                    {/* 1. Overview Cards */}
                    {processedData && (
                        <section id="overview"><DashboardOverview 
                            current={processedData.current} 
                            target={processedData.target} 
                            periodMode={periodMode}
                            rawData={activeRawData}
                            filters={filters}
                            targetRows={displayTargetData}
                            pacingRatio={processedData.pacingRatio}
                        /></section>
                    )}

                    {/* 视图切换：主页只放「雷达 + 三张表」，深度分析收进「诊断」 */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex w-fit items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
                            {([['overview', '总览'], ['diagnose', '诊断']] as const).map(([value, label]) => (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() => setHomeView(value)}
                                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${homeView === value ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-800'}`}
                                >
                                    {label}
                                    {value === 'diagnose' && radar && radar.findings.length > 0 && (
                                        <span className={`rounded-full px-1.5 text-[10px] ${homeView === value ? 'bg-white/20' : 'bg-rose-50 text-rose-600'}`}>
                                            {radar.findings.length}
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>
                        <span className="text-[11px] text-slate-400">
                            {homeView === 'overview' ? '总览：异常雷达 + 利润 / 流量 / 库存三张表' : '诊断：毛利瀑布 + 对比矩阵 + 库存健康'}
                        </span>
                    </div>

                    {homeView === 'overview' && <>
                    {processedData && radar && (
                        <section id="issues">
                            <AnomalyRadar
                                report={radar}
                                onDrillAsin={asin => {
                                    focusEntity('childAsins', asin);
                                    setDetailType('PL');
                                    setDetailModalOpen(true);
                                }}
                            />
                        </section>
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
                    </>}

                    {homeView === 'diagnose' && <>
                    {/* 2.5 毛利瀑布：销售额一路减到毛利，并拆出变化来自「量」还是「率」 */}
                    {processedData && (
                        <Suspense fallback={null}>
                            <ProfitWaterfall
                                current={processedData.current}
                                last={processedData.last}
                                currentRows={processedData.currentRows}
                                lastRows={processedData.lastRows}
                                onFocusAsin={asin => focusEntity('childAsins', asin)}
                            />
                        </Suspense>
                    )}

                    {/* 2.6 多维对比矩阵：ASIN × 日期热力图，点格子直接聚焦 */}
                    {processedData && (
                        <MetricMatrix
                            rows={activeRawData}
                            onPick={(asin, date) => {
                                focusEntity('childAsins', asin);
                                setPeriodMode('day');
                                setFilters(prev => ({ ...prev, startDate: date, endDate: date }));
                            }}
                        />
                    )}

                    {/* 4.5 库存健康：可售天数 = 可售库存 ÷ 近 28 天日均销量 */}
                    {processedData && <Suspense fallback={null}><StockHealth rows={activeRawData} onFocusAsin={asin => focusEntity('childAsins', asin)} /></Suspense>}
                    </>}

                    {!processedData && (
                        // 云端第一次拉数（或切换区间后还没拿到新数据）时只显示加载态，
                        // 不要甩「暂无数据 + 导入数据」，那会让人以为数据丢了
                        (cloudLoading || (CLOUD_ENABLED && Boolean(cloudToken) && !cloudConnected && !cloudStatus)) && !activeRawData.length ? (
                            <div>
                                <LoadingSkeleton label={`正在加载 ${filters.startDate} ~ ${filters.endDate} 的业绩数据…`} />
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center rounded-3xl border border-white/80 bg-white/85 py-24 text-slate-400 shadow-[0_24px_70px_-42px_rgba(15,23,42,0.45)] backdrop-blur-xl">
                                <div className="mb-5 rounded-2xl bg-sky-50 p-6 text-sky-300 ring-1 ring-sky-100">
                                    <FileSpreadsheet className="w-12 h-12" />
                                </div>
                                <p className="text-lg font-semibold text-slate-700">{restoreFailed ? '本地数据暂时无法读取' : activeRawData.length ? '当前选择无数据' : cloudConnected ? '当前区间云端暂无数据' : '暂无数据'}</p>
                                <p className="mt-1 text-sm text-slate-500">{restoreFailed ? '请检查浏览器存储权限后刷新页面' : activeRawData.length ? '请调整分析周期，或切换到有数据的粒度（月度/周度/日度）' : isDailyMode && !cloudConnected ? '日度视图需要连接云端数据；本地导入的月报/周报没有日粒度' : cloudConnected ? '可调整分析周期，或到「数据管理 → 数据质量」看哪些日期缺数据并补数' : '可先加载样例，也可导入自己的数据'}</p>
                                {!restoreFailed && !activeRawData.length && !cloudConnected && <div className="mt-5 flex flex-wrap justify-center gap-2">
                                    <button type="button" onClick={downloadImportTemplate} className="rounded-xl border border-sky-200 bg-white px-4 py-2 text-sm font-semibold text-sky-700">下载模板</button>
                                    <button type="button" onClick={handleLoadSample} className="rounded-xl border border-sky-200 bg-white px-4 py-2 text-sm font-semibold text-sky-700">加载脱敏样例</button>
                                    <button type="button" onClick={() => setShowUploadModal(true)} className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white">导入自己的数据</button>
                                </div>}
                            </div>
                        )
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
                targetRows={displayTargetData}
                inventoryRows={processedData.invRows}
                period={processedData.periods.current}
                onOpenRefundAnalysis={handleOpenRefundAnalysis}
                onOpenCalculator={handleOpenCalculator}
                onOpenReviewAnalysis={() => setReviewModalOpen(true)}
                periodMode={periodMode}
                rawPerformance={activeRawData}
                performanceMonthly={useCloudData && trendHistory.month.length ? trendHistory.month : displayPerformanceData}
                performanceWeekly={useCloudData && trendHistory.week.length ? trendHistory.week : displayWeeklyData}
                performanceDaily={displayDailyData}
                productImageLookup={productImageLookup}
                dataEndDate={dataEndDate}
            /></Suspense>
        )}

        {refundModalOpen && <Suspense fallback={null}><RefundAnalysisModal 
            isOpen={refundModalOpen}
            onClose={() => { setRefundModalOpen(false); setRefundOverrideFilters(null); }}
            refundData={refundData}
            rawPerformance={displayPerformanceData}
            onDataChange={setRefundData}
            initialFilters={refundOverrideFilters ? { ...filters, ...refundOverrideFilters } : filters}
        /></Suspense>}

        {reviewModalOpen && <Suspense fallback={null}><ReviewAnalysisModal 
            isOpen={reviewModalOpen}
            onClose={() => setReviewModalOpen(false)}
            reviewData={reviewData}
            rawPerformance={displayPerformanceData}
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
            rawData={displayPerformanceData}
            filters={filters}
            initialProduct={calculatorParams.product}
            initialCountry={calculatorParams.country}
        /></Suspense>}

        {showCloudLogin && <div role="dialog" aria-modal="true" aria-label="连接云端数据" className="fixed inset-0 z-[190] flex items-center justify-center bg-slate-950/60 p-4" onClick={() => setShowCloudLogin(false)}>
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={event => event.stopPropagation()}>
                <h2 className="text-lg font-bold text-slate-900">连接云端数据</h2>
                <p className="mt-2 text-sm text-slate-600">首次连接输入看板只读密码。领星 MCP 密钥不会放在这里。</p>
                <form onSubmit={event => { event.preventDefault(); connectCloud(); }}>
                    <label htmlFor="cloud-read-token" className="mt-5 block text-sm font-semibold text-slate-700">看板只读密码</label>
                    <input id="cloud-read-token" type="password" value={cloudTokenInput} onChange={event => setCloudTokenInput(event.target.value)} autoComplete="off" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" autoFocus />
                    <div className="mt-5 flex justify-end gap-2">
                        {cloudToken && <button type="button" onClick={() => { disconnectCloud(); setShowCloudLogin(false); }} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">切换到本地数据</button>}
                        <button type="button" onClick={() => setShowCloudLogin(false)} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">取消</button>
                        <button type="submit" disabled={!cloudTokenInput.trim()} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">连接</button>
                    </div>
                </form>
            </div>
        </div>}

        {/* Chat Bot Integration with All Data Sources */}
        {!chatLoaded && <button type="button" aria-label="打开 AI 顾问" onClick={() => setChatLoaded(true)} className="fixed bottom-6 right-6 z-50 rounded-full bg-blue-600 p-4 text-white shadow-xl hover:bg-blue-700"><Sparkles className="h-6 w-6" /></button>}
        {chatLoaded && <Suspense fallback={<div role="status" className="fixed bottom-6 right-6 z-50 rounded-full bg-blue-600 p-4 text-white">加载中…</div>}><ChatBot 
            data={processedData} 
            inventory={processedData?.inventory || null}
            refunds={refundData}
            filters={filters} 
            rawPerformance={activeRawData}
            rawInventory={inventoryData}
            initialOpen
        /></Suspense>}
      </div>
    </div>
  );
};

export default App;

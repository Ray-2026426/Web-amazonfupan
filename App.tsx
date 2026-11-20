
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
  cloudInventoryToRows,
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
import { buildViewLink, hasViewInUrl, readViewFromUrl, syncViewToUrl, type WorkspaceTab } from './components/viewUrl';
import { KairoLogo } from './components/ui/KairoLogo';
import { RightDrawer } from './components/ui/RightDrawer';
import { StatusPill } from './components/ui/StatusPill';
import { TopFilterBar, stepDateRange } from './components/TopFilterBar';
import { OverviewQuickRanks } from './components/OverviewQuickRanks';
import { EntityQuickDrawer, type QuickDrawerTarget } from './components/EntityQuickDrawer';
import { TopicsHub } from './components/TopicsHub';
import { applyAppSettings, loadAppSettings, saveAppSettings } from './components/appSettings';
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
import { InventoryDecision } from './components/InventoryDecision';
import { buildRadarReport } from './utils/diagnosticRadar';
import { parseMonthlyPerformance, parseWeeklyPerformance, parseTargetData, parseInventoryData, parseRefundData, parseReviewData, parseProductImageData } from './dataLoader';
import { FileSpreadsheet, CalendarDays, Database, LayoutDashboard, Menu, X, Sparkles, Search, Sun, Moon, RefreshCw } from 'lucide-react';
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
  /** 云端库存快照原始行（fact_inventory） */
  const [cloudInventoryRaw, setCloudInventoryRaw] = useState<Record<string, unknown>[]>([]);
  /** 库存快照的业务日期（用于表格 3 的「数据时刻」提示） */
  const [cloudInventoryDate, setCloudInventoryDate] = useState('');
  const [refundData, setRefundData] = useState<RefundRow[]>([]);
  const [reviewData, setReviewData] = useState<ReviewRow[]>([]);
  const [searchTermData, setSearchTermData] = useState<SearchTermRow[]>([]); 
  const [productImageData, setProductImageData] = useState<ProductImageRow[]>([]);
  const [businessActions, setBusinessActions] = useState<ActionItem[]>([]);

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
  /** 维度筛选签名：用于判断「缓存/聚合结果」是否还对应当前筛选 */
  const dimensionSignature = useMemo(() => (
      ['countries', 'shops', 'brands', 'managers', 'subCategories', 'parentAsins', 'childAsins', 'productNames'] as (keyof FilterState)[]
  ).map(key => ((filters[key] as string[]) || []).join(',')).join('|'), [filters]);
  const hasActiveFilters = dimensionSignature.replace(/\|/g, '').length > 0;
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

  /**
   * 图片对照表。父体本身没有图，所以额外传入业绩明细，
   * 让「父 ASIN」能沿用其销量最高子体的图片。
   */
  const productImageLookup = useMemo<ProductImageLookup | null>(() => {
      if (productImageData.length === 0) return null;
      const salesRows = cloudRows.length > 0 ? cloudRows : performanceData;
      return buildProductImageLookup(productImageData, salesRows);
  }, [productImageData, cloudRows, performanceData]);
  const [cloudConnected, setCloudConnected] = useState(false);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudStatus, setCloudStatus] = useState('');
  /** 云端数据截止日（正常状态不占用版面，显示在设置面板里） */
  const [cloudCutoff, setCloudCutoff] = useState('');
  /** 最近一次成功同步的时间，同样收在设置面板 */
  const [cloudLastSync, setCloudLastSync] = useState('');

  /**
   * 「跟随云端最新数据日」只对**没有指定日期**的分享链接生效。
   * 之前写成「有 URL 就覆盖」，会把链接里指定的历史日期冲掉——这是个真 bug。
   */
  const snappedToLatest = useRef(false);
  useEffect(() => {
    if (snappedToLatest.current || periodMode !== 'day') return;
    const view = readViewFromUrl();
    if (!view.mode && !view.from && !view.to) return; // 不是分享链接
    if (view.from || view.to) return;                 // 链接已指定日期，保持不动
    const latest = cloudCutoff || dataEndDate;
    if (!latest) return;
    snappedToLatest.current = true;
    setFilters(prev => (prev.startDate === latest && prev.endDate === latest ? prev : { ...prev, startDate: latest, endDate: latest }));
  }, [cloudCutoff, dataEndDate, periodMode]);

  /**
   * 默认进站落在「昨天」，但云端同步有延迟（每天首批数据约 13:30 才到），
   * 这时昨天往往还没有数据 —— 页面会空着，而趋势图用的是长历史、照样有点，
   * 看起来就像「时间选择和趋势图对不上」。落地后在这里把区间校正到最新可用日。
   * 只校正一次，且只在「所选区间整体晚于数据截止日」时生效，不覆盖用户主动选的历史日期。
   */
  const snappedToDataEnd = useRef(false);
  useEffect(() => {
    if (snappedToDataEnd.current || periodMode !== 'day') return;
    const view = readViewFromUrl();
    if (view.from || view.to) return; // 分享链接指定了日期，保持不动
    const latest = cloudCutoff || dataEndDate;
    if (!latest || !/^\d{4}-\d{2}-\d{2}$/.test(latest)) return;
    snappedToDataEnd.current = true;
    setFilters(prev => (prev.endDate && prev.endDate <= latest
      ? prev
      : { ...prev, startDate: latest, endDate: latest }));
  }, [cloudCutoff, dataEndDate, periodMode]);

  /**
   * 本地数据兜底：没连云端（或数据源选了本地）时，默认区间要落在「有数据的那几个月」，
   * 否则默认的「昨天」在月报里根本不存在，页面会是空的。
   */
  useEffect(() => {
    if (CLOUD_ENABLED && cloudToken) return;
    if (!performanceData.length) return;
    setFilters(prev => {
      const inRange = prev.startDate && prev.endDate
          && performanceData.some(row => row.date >= prev.startDate && row.date <= prev.endDate);
      if (inRange) return prev;
      const dates = performanceData.map(row => row.date).sort();
      const lastDate = dates[dates.length - 1];
      const [year, month] = lastDate.split('-').map(Number);
      return {
        ...prev,
        startDate: `${year}-${String(month).padStart(2, '0')}-01`,
        endDate: lastDate,
      };
    });
  }, [performanceData, cloudToken]);

  /**
   * 视图 → 地址栏：不再自动把筛选写进地址栏。
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
  /** 顶部 5 标签页导航（总览 / 利润 / 广告与流量 / 库存 / 专题），同步进 URL */
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(() => {
    const fromUrl = readViewFromUrl().tab;
    if (fromUrl) return fromUrl;
    try {
      const stored = localStorage.getItem('telos-active-tab') as WorkspaceTab | null;
      if (stored && ['overview', 'profit', 'traffic', 'inventory', 'topics'].includes(stored)) return stored;
    } catch { /* 忽略 */ }
    return 'overview';
  });
  useEffect(() => {
    try { localStorage.setItem('telos-active-tab', activeTab); } catch { /* 忽略 */ }
    syncViewToUrl(periodMode, filters, activeTab);
  }, [activeTab, periodMode, filters]);

  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [quickDrawerTarget, setQuickDrawerTarget] = useState<QuickDrawerTarget | null>(null);
  const [isDarkTheme, setIsDarkTheme] = useState(() => loadAppSettings().theme === 'dark');
  const toggleQuickTheme = () => {
    const cur = loadAppSettings();
    const nextTheme = cur.theme === 'dark' ? 'light' : 'dark';
    const next = { ...cur, theme: nextTheme as 'light' | 'dark' };
    saveAppSettings(next);
    applyAppSettings(next);
    setIsDarkTheme(nextTheme === 'dark');
  };

  /** 主页视图（保留兼容） */
  const [homeView, setHomeView] = useState<'overview' | 'diagnose'>('overview');
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

  /** 趋势用的长历史（服务端按日/周/月聚合，支持维度筛选下推）：点开或默认展示趋势时始终跟随筛选自动更新 */
  const [trendHistory, setTrendHistory] = useState<{ day: DataRow[]; month: DataRow[]; week: DataRow[] }>({ day: [], month: [], week: [] });
  useEffect(() => {
    if (!CLOUD_ENABLED || !cloudToken || !cloudConnected) return;
    let cancelled = false;
    const controller = new AbortController();
    const filterParams = new URLSearchParams();
    const DIM_KEYS: Array<[keyof FilterState, string]> = [
      ['countries', 'country'],
      ['shops', 'shop'],
      ['brands', 'brand'],
      ['managers', 'manager'],
      ['subCategories', 'sub'],
      ['parentAsins', 'pasin'],
      ['childAsins', 'casin'],
      ['productNames', 'pname'],
    ];
    for (const [field, param] of DIM_KEYS) {
      const vals = filters[field];
      if (Array.isArray(vals) && vals.length > 0 && !vals.includes('__NONE__')) {
        filterParams.set(param, vals.join(','));
      }
    }
    const qs = filterParams.toString();
    const suffix = qs ? `&${qs}` : '';
    void (async () => {
      try {
        const headers = { Authorization: `Bearer ${cloudToken}` };
        const [dayResponse, monthResponse, weekResponse] = await Promise.all([
          fetch(`/api/trend?mode=day&periods=35${suffix}`, { headers, signal: controller.signal }),
          fetch(`/api/trend?mode=month&periods=24${suffix}`, { headers, signal: controller.signal }),
          fetch(`/api/trend?mode=week&periods=52${suffix}`, { headers, signal: controller.signal }),
        ]);
        const day = dayResponse.ok ? await dayResponse.json() : null;
        const month = monthResponse.ok ? await monthResponse.json() : null;
        const week = weekResponse.ok ? await weekResponse.json() : null;
        if (cancelled) return;
        setTrendHistory({
          day: Array.isArray(day?.rows) ? day.rows : [],
          month: Array.isArray(month?.rows) ? month.rows : [],
          week: Array.isArray(week?.rows) ? week.rows : [],
        });
      } catch { /* 失败就退回当前区间数据 */ }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [cloudConnected, cloudToken, dimensionSignature, cloudRefreshTick]);

  /**
   * 趋势长历史同样是领星原值（不含前端「毛利修正」开关），
   * 统一在这里补一次修正，保证趋势线、KPI、明细表是同一个毛利口径。
   */
  const trendHistoryCorrected = useMemo(() => ({
    day: applyFbaFeeCorrection(trendHistory.day, addBackFbaFee),
    month: applyFbaFeeCorrection(trendHistory.month, addBackFbaFee),
    week: applyFbaFeeCorrection(trendHistory.week, addBackFbaFee),
  }), [trendHistory, addBackFbaFee]);
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
              const [monthly, weekly, targets, inv, savedFilters, savedActions] = await Promise.all([
                  loadFromDB('monthly'),
                  loadFromDB('weekly'),
                  loadFromDB('targets'),
                  loadFromDB('inventory'),
                  loadFromDB('meta'),
                  loadFromDB('business_actions')
              ]);

              if (monthly) setPerformanceData(monthly);
              if (weekly) setWeeklyData(weekly);
              if (targets) setTargetData(targets);
              if (inv) setInventoryData(inv);
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

  /**
   * 退款 / 评价 / 商品图片三张表只服务弹窗和缩略图，体积却最大。
   * 放到首屏之后再读，避免它们把「云端数据请求」和第一屏一起拖住。
   */
  useEffect(() => {
      let cancelled = false;
      const loadAuxiliary = async () => {
          const [refunds, reviews, productImages] = await Promise.all([
              loadFromDB('refunds').catch(() => null),
              loadFromDB('reviews').catch(() => null),
              loadFromDB('product_images').catch(() => null),
          ]);
          if (cancelled) return;
          if (refunds) setRefundData(refunds);
          if (reviews) setReviewData(reviews);
          if (productImages?.length) setProductImageData(productImages);
      };
      const timer = window.setTimeout(loadAuxiliary, 0);
      return () => { cancelled = true; window.clearTimeout(timer); };
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
               * 区间缓存：只按「起止日期」缓存全量明细，切维度筛选时直接本地秒过滤，不再重拉接口。
               * 5 分钟内有效；切到新区间才真正请求。
               */
              const cacheKey = `${filters.startDate}|${filters.endDate}`;
              const cached = cloudRangeCache.current.get(cacheKey);
              if (cached && Date.now() - cached.at < 5 * 60 * 1000) {
                  setCloudRows(cached.rows);
                  setCloudTargetData(cached.targets?.rows || []);
                  setCloudTargetActive(cached.targets?.active || false);
                  // 必须是「start|end」：visibleCloudRows 用这个格式比对，写成带筛选签名的 key 会让明细被当成空
                  setCloudRowsRange(`${filters.startDate}|${filters.endDate}`);
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
               * 维度筛选已下推到 SQL（aggregate_range_f），筛选时同样走快路径。
               */
              const aggregatePromise = fetchCloudAggregate(
                  filters.startDate,
                  filters.endDate,
                  cloudToken,
                  controller.signal,
                  {
                      countries: filters.countries,
                      shops: filters.shops,
                      brands: filters.brands,
                      managers: filters.managers,
                      subCategories: filters.subCategories,
                      parentAsins: filters.parentAsins,
                      productNames: filters.productNames,
                  },
              ).catch(() => null);
              const [rows, targets] = await (async () => {
                  const rowsPromise = fetchCloudRows(
                      filters.startDate,
                      filters.endDate,
                      cloudToken,
                      controller.signal,
                      // 当前期明细一到就先把表格/下钻画出来，对比区间稍后补
                      (partial) => {
                          if (controller.signal.aborted) return;
                          setCloudRows(partial);
                          setCloudRowsRange(`${filters.startDate}|${filters.endDate}`);
                      },
                  );
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
              if (productImageData.length === 0) loadProductImages();
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

  /**
   * 商品图片：合并两个来源（上传的图片表优先，库存快照里的领星主图兜底）。
   * 库存快照可能比业绩数据晚到几分钟，所以这里做成可重试的独立函数。
   */
  const loadProductImages = () => {
      if (!cloudToken) return;
      const headers = { Authorization: `Bearer ${cloudToken}` };
      void Promise.all([
          fetch('/api/product-images', { headers }).then(response => (response.ok ? response.json() : null)).catch(() => null),
          fetch('/api/inventory', { headers }).then(response => (response.ok ? response.json() : null)).catch(() => null),
      ]).then(([imagePayload, inventoryPayload]) => {
          // 库存快照顺带拿到：表格 3 与商品图片都靠它
          if (Array.isArray(inventoryPayload?.rows)) {
              setCloudInventoryRaw(inventoryPayload.rows);
              if (inventoryPayload.date) setCloudInventoryDate(String(inventoryPayload.date));
          }
          const uploaded = Array.isArray(imagePayload?.rows) ? imagePayload.rows : [];
          const fromInventory = (Array.isArray(inventoryPayload?.rows) ? inventoryPayload.rows : [])
              .filter((row: { pic_url?: string }) => row.pic_url && /^https?:\/\//i.test(String(row.pic_url)))
              .map((row: { pic_url: string; asin?: string; product_name?: string }) => ({
                  sku: '',
                  product_name: row.product_name || '',
                  image_url: row.pic_url,
                  asin: row.asin || '',
              }));
          const merged = [...uploaded, ...fromInventory];
          if (merged.length) setProductImageData(merged);
      }).catch(() => { /* 图片源缺失不影响主流程 */ });
  };

  /** 图片兜底重试：云端刷新（每 15 分钟）或库存快照晚到时再拉一次 */
  useEffect(() => {
      if (!CLOUD_ENABLED || !cloudToken || !cloudConnected) return;
      if (productImageData.length > 0) return;
      loadProductImages();
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudConnected, cloudToken, cloudRefreshTick, productImageData.length]);

  /** 库存快照：连上云端就拉最新一天，云端刷新时再拉（表格 3 的数据来源） */
  useEffect(() => {
      if (!CLOUD_ENABLED || !cloudToken || !cloudConnected) return;
      let cancelled = false;
      fetch('/api/inventory', { headers: { Authorization: `Bearer ${cloudToken}` } })
          .then(response => (response.ok ? response.json() : null))
          .then(payload => {
              if (cancelled) return;
              if (Array.isArray(payload?.rows) && payload.rows.length) {
                  setCloudInventoryRaw(payload.rows);
                  if (payload.date) setCloudInventoryDate(String(payload.date));
              }
          })
          .catch(() => { /* 库存失败不影响主流程 */ });
      return () => { cancelled = true; };
  }, [cloudConnected, cloudToken, cloudRefreshTick]);

  const visibleCloudRows = cloudRowsRange === `${filters.startDate}|${filters.endDate}` ? cloudRows : EMPTY_ROWS;
  /** 数据源开关：云端 / 本地导入。云端连上后仍可切回自己上传的数据 */
  const useCloudData = CLOUD_ENABLED && cloudConnected && dataSource === 'cloud';
  /** 云端库存快照（每日）→ 库存行；为 0 时回退到本地导入的库龄报表 */
  const cloudInventoryRows = useMemo(() => cloudInventoryToRows(cloudInventoryRaw), [cloudInventoryRaw]);
  const effectiveInventory = useCloudData && cloudInventoryRows.length > 0 ? cloudInventoryRows : inventoryData;
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

  /** 库存行的负责人/品牌从业绩数据补全（库存快照本身不带这两个维度） */
  const inventoryWithMeta = useMemo(() => {
      if (!effectiveInventory.length) return effectiveInventory;
      const meta = new Map<string, { manager: string; brand: string; country: string }>();
      for (const row of displayPerformanceData) {
          if (row.child_asin && !meta.has(row.child_asin)) meta.set(row.child_asin, { manager: row.manager || '', brand: row.brand || '', country: row.country || '' });
          if (row.parent_asin && !meta.has(row.parent_asin)) meta.set(row.parent_asin, { manager: row.manager || '', brand: row.brand || '', country: row.country || '' });
      }
      if (meta.size === 0) {
          return effectiveInventory.map(item => ({
              ...item,
              manager: (item.manager || '').trim() || '未归属',
              brand: (item.brand || '').trim() || '未归属',
              country: (item.country || '').trim() || '未归属',
          }));
      }
      return effectiveInventory.map(item => {
          const hit = meta.get(item.asin) || meta.get(item.parent_asin);
          return {
              ...item,
              manager: (hit?.manager || item.manager || '').trim() || '未归属',
              brand: (hit?.brand || item.brand || '').trim() || '未归属',
              country: (hit?.country || item.country || '').trim() || '未归属',
          };
      });
  }, [effectiveInventory, displayPerformanceData]);

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
      const latest = cloudCutoff || dataEndDate;

      setFilters(prev => {
          // 以当前选中区间的结束日（不超过数据截止日）为锚点，切粒度时自动对齐该粒度的自然边界
          const rawAnchor = prev.endDate && /^\d{4}-\d{2}-\d{2}$/.test(prev.endDate)
              ? (latest && prev.endDate > latest ? latest : prev.endDate)
              : anchorStr;
          const [ry, rm, rd] = rawAnchor.split('-').map(Number);
          const refDate = new Date(ry, rm - 1, rd);

          if (mode === 'week') {
              const { start, end } = getISOWeekDateRange(refDate);
              return { ...prev, startDate: formatDate(start), endDate: formatDate(end) };
          }
          if (mode === 'day') {
              // 切到日度：默认落到最新可用单日
              const dayStr = latest && /^\d{4}-\d{2}-\d{2}$/.test(latest) ? latest : fmt(refDate);
              return { ...prev, startDate: dayStr, endDate: dayStr };
          }
          // 切到月度：落到参考日所在完整自然月
          const start = new Date(ry, rm - 1, 1);
          const end = new Date(ry, rm, 0);
          return { ...prev, startDate: fmt(start), endDate: fmt(end) };
      });
  };

  // --- Processing Logic ---
  
  const processedData = useMemo(() => {
      const activeData = activeRawData;
      /**
       * 云端聚合（几百字节）：明细还没到也能先把 KPI / 利润表画出来。
       * 明细到了之后 currentRows 才有值，用于瀑布归因、矩阵、下钻。
       */
      /**
       * 服务端聚合已支持维度筛选（aggregate_range_f），所以有筛选时也能走快路径。
       * 但聚合结果必须和「当前筛选」绑定：key 里带上筛选签名，变了就重新算。
       */
      const cloudMatch = useCloudData && !hasActiveFilters && cloudAgg && cloudAgg.key === `${filters.startDate}|${filters.endDate}` ? cloudAgg : null;
      if (activeData.length === 0 && !cloudMatch) return null;
      if (!filters.startDate || !filters.endDate) return null;

      const periods = calculatePeriodDates(filters.startDate, filters.endDate);
      
      // Filter Data for periods
      const currentRows = filterData(activeData, periods.current, filters);
      const lastRows = filterData(activeData, periods.last, filters);
      const yearRows = filterData(activeData, periods.year, filters);

      // 明细已到达时一律用明细实时聚合（保证筛选立刻生效、且同比/环比从月表/周表正常算出）；
      // 仅在首屏明细尚未返回前，用 cloudMatch（且 rows > 0）先行渲染 KPI
      const cloudCurrentValid = cloudMatch && Number(cloudMatch.current?.rows || 0) > 0;
      const cloudLastValid = cloudMatch && Number(cloudMatch.last?.rows || 0) > 0;
      const cloudYearValid = cloudMatch && Number(cloudMatch.year?.rows || 0) > 0;

      const current = currentRows.length > 0
          ? aggregateData(currentRows)
          : cloudCurrentValid
              ? aggregatedFromCloud(cloudMatch.current as unknown as Record<string, unknown>, addBackFbaFee)
              : aggregateData(currentRows);
      const last = lastRows.length > 0
          ? aggregateData(lastRows)
          : cloudLastValid
              ? aggregatedFromCloud(cloudMatch.last as unknown as Record<string, unknown>, addBackFbaFee)
              : null;
      const year = yearRows.length > 0
          ? aggregateData(yearRows)
          : cloudYearValid
              ? aggregatedFromCloud(cloudMatch.year as unknown as Record<string, unknown>, addBackFbaFee)
              : null;

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
      const invRows = filterInventoryData(inventoryWithMeta, filters);
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
  }, [activeRawData, displayTargetData, inventoryWithMeta, filters, periodMode, dataEndDate, cloudAgg, useCloudData, dimensionSignature, addBackFbaFee]);

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

  const handleStepPeriod = (delta: -1 | 1) => {
      setFilters(prev => {
          const next = stepDateRange(prev.startDate, prev.endDate, periodMode, delta);
          return { ...prev, startDate: next.startDate, endDate: next.endDate };
      });
  };

  useEffect(() => {
      const TABS: WorkspaceTab[] = ['overview', 'profit', 'traffic', 'inventory', 'topics'];
      const onKey = (event: KeyboardEvent) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
              event.preventDefault();
              setCommandOpen(value => !value);
              return;
          }
          const tag = (event.target as HTMLElement | null)?.tagName;
          if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (event.target as HTMLElement | null)?.isContentEditable) return;
          if (event.metaKey || event.ctrlKey || event.altKey) return;
          if (event.key >= '1' && event.key <= '5') {
              setActiveTab(TABS[Number(event.key) - 1]);
          } else if (event.key === 'ArrowLeft') {
              handleStepPeriod(-1);
          } else if (event.key === 'ArrowRight') {
              handleStepPeriod(1);
          }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
  }, [periodMode]);

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
          { id: 'sidebar', label: '打开更多筛选抽屉', group: '界面', run: () => setMoreFiltersOpen(true) },
          { id: 'copy-link', label: '复制当前视图链接', group: '分享', keywords: ['share', 'url', '发给同事'], run: () => { void navigator.clipboard?.writeText(buildViewLink(periodMode, filters, activeTab)); } },
          { id: 'source-cloud', label: '数据源：云端', group: '数据', keywords: ['database'], run: () => setDataSource('cloud') },
          { id: 'source-local', label: '数据源：本地导入', group: '数据', keywords: ['excel', '上传'], run: () => setDataSource('local') },
          { id: 'clear-focus', label: '清除聚焦', group: '视图', run: clearAllFocus },
          { id: 'tab-overview', label: '切到：总览 (快捷键 1)', group: '视图', keywords: ['home', 'overview'], run: () => setActiveTab('overview') },
          { id: 'tab-profit', label: '切到：利润 (快捷键 2)', group: '视图', keywords: ['pl', 'profit'], run: () => setActiveTab('profit') },
          { id: 'tab-traffic', label: '切到：广告与流量 (快捷键 3)', group: '视图', keywords: ['traffic', 'ads'], run: () => setActiveTab('traffic') },
          { id: 'tab-inventory', label: '切到：库存 (快捷键 4)', group: '视图', keywords: ['inventory', 'stock'], run: () => setActiveTab('inventory') },
          { id: 'tab-topics', label: '切到：专题 (快捷键 5)', group: '视图', keywords: ['topics', 'refund', 'review'], run: () => setActiveTab('topics') },
          { id: 'shortcuts', label: '查看快捷键', group: '帮助', keywords: ['keyboard', '帮助'], run: () => setShortcutsOpen(true) },
      ];
  })();

  const TAB_ITEMS: Array<{ id: WorkspaceTab; label: string; title: string }> = [
    { id: 'overview', label: '总览', title: '经营总览' },
    { id: 'profit', label: '利润', title: '利润分析' },
    { id: 'traffic', label: '广告与流量', title: '广告与流量' },
    { id: 'inventory', label: '库存', title: '库存管理' },
    { id: 'topics', label: '专题', title: '深度专题' },
  ];
  const currentTabMeta = TAB_ITEMS.find(t => t.id === activeTab) || TAB_ITEMS[0];

  const partialPeriodInfo = (() => {
    if (!filters.startDate || !filters.endDate || !processedData) return null;
    if (processedData.pacingRatio >= 0.999) return null;
    const totalDays = Math.max(
      1,
      Math.round((Date.parse(`${filters.endDate}T00:00:00Z`) - Date.parse(`${filters.startDate}T00:00:00Z`)) / 86400000) + 1
    );
    const elapsedDays = Math.max(1, Math.min(totalDays, Math.round(totalDays * processedData.pacingRatio)));
    return { elapsedDays, totalDays };
  })();

  return (
    <div className="flex min-h-screen flex-col bg-[#f5f5f7] font-sans text-[#1d1d1f] dark:bg-[#111318] dark:text-[#f5f5f7]">
      {/* Apple × Kairo 56px 吸顶导航栏 */}
      <header className="sticky top-0 z-30 flex h-14 flex-shrink-0 items-center justify-between gap-4 border-b border-black/[0.06] bg-[#f5f5f7]/85 px-4 backdrop-blur-xl sm:px-8 dark:border-white/[0.08] dark:bg-[#111318]/85">
        <div className="flex items-center gap-6 lg:gap-8">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className="flex items-center gap-2.5 text-left"
          >
            <KairoLogo size={26} />
            <span className="text-[17px] font-bold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">Telos</span>
            <span className="hidden text-[13px] font-medium text-[#86868b] sm:inline dark:text-[#a7abb8]">业绩</span>
          </button>

          <nav aria-label="主导航" className="hidden items-center gap-6 md:flex">
            {TAB_ITEMS.map(tab => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative flex h-14 items-center gap-1.5 text-[14px] transition-colors ${
                    active
                      ? 'font-semibold text-[#4f46e5] dark:text-indigo-400'
                      : 'text-[#86868b] hover:text-[#1d1d1f] dark:text-[#a7abb8] dark:hover:text-[#f5f5f7]'
                  }`}
                >
                  {tab.label}
                  {tab.id === 'overview' && radar && radar.findings.length > 0 && (
                    <span className="rounded-full bg-[#eef2ff] px-1.5 py-0.5 text-[10px] font-semibold text-[#4f46e5] dark:bg-indigo-500/20 dark:text-indigo-300">
                      {radar.findings.length}
                    </span>
                  )}
                  {active && (
                    <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-[#4f46e5] dark:bg-indigo-400" />
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            title="搜索功能或输入命令（⌘K / Ctrl+K）"
            className="hidden h-8 items-center gap-2 rounded-xl border border-black/[0.06] bg-white px-3 text-xs text-[#86868b] transition hover:border-indigo-500/30 hover:text-[#1d1d1f] sm:flex dark:border-white/[0.08] dark:bg-[#191c24] dark:text-[#a7abb8] dark:hover:text-[#f5f5f7]"
          >
            <Search className="h-3.5 w-3.5" />
            <span>搜索或命令</span>
            <span className="rounded border border-black/[0.08] px-1 py-0.5 text-[10px] text-[#86868b] dark:border-white/[0.12]">⌘K</span>
          </button>

          <button
            type="button"
            onClick={toggleQuickTheme}
            title={isDarkTheme ? '切换浅色模式' : '切换深色模式'}
            aria-label={isDarkTheme ? '切换浅色模式' : '切换深色模式'}
            className="theme-toggle-btn flex h-8 w-8 items-center justify-center rounded-xl border border-black/[0.06] bg-white text-[#424245] transition hover:border-indigo-500/30 hover:text-[#4f46e5] dark:border-white/[0.08] dark:bg-[#191c24] dark:text-[#c7c9d1]"
          >
            {isDarkTheme ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

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
        </div>
      </header>

      {/* 移动端标签条 */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-black/[0.06] bg-white px-3 py-1.5 md:hidden dark:border-white/[0.08] dark:bg-[#191c24]">
        {TAB_ITEMS.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              activeTab === tab.id
                ? 'bg-[#eef2ff] font-semibold text-[#4f46e5] dark:bg-indigo-500/20 dark:text-indigo-300'
                : 'text-[#86868b] dark:text-[#a7abb8]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 更多筛选右侧抽屉 */}
      <RightDrawer
        open={moreFiltersOpen}
        onClose={() => setMoreFiltersOpen(false)}
        title="全部筛选与自定义日期"
        subtitle="选择国家、店铺、品牌、负责人、类目、ASIN 或自定义区间"
        widthClass="w-[420px]"
      >
        <div className="-mx-6 -my-5">
          <SidebarFilters
            data={activeRawData}
            inventoryData={inventoryWithMeta}
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
      </RightDrawer>

      {/* 右侧快速下钻抽屉 */}
      <EntityQuickDrawer
        target={quickDrawerTarget}
        periodLabel={`${filters.startDate} ~ ${filters.endDate}`}
        rows={processedData?.currentRows || activeRawData}
        onClose={() => setQuickDrawerTarget(null)}
        onFocusFilter={(kind, key) => {
          focusEntity(kind === 'shop' ? 'shops' : 'childAsins', key);
        }}
        onOpenFullDetail={() => {
          setDetailType('PL');
          setDetailModalOpen(true);
        }}
      />
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

      {/* 主内容区（Apple 宽留白居中画布） */}
      <main className="flex-1">
        <div className="mx-auto max-w-[1280px] space-y-6 px-4 py-7 pb-24 sm:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-[28px] font-bold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
                {currentTabMeta.title}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-[#86868b] dark:text-[#a7abb8]">
                <span className="num-tabular">{filters.startDate} – {filters.endDate}</span>
                {partialPeriodInfo && (
                  <StatusPill tone="partial">
                    ● 进行中 · 已有 {partialPeriodInfo.elapsedDays}/{partialPeriodInfo.totalDays} 天
                  </StatusPill>
                )}
                <span>· USD</span>
                {(cloudCutoff || dataEndDate) && <span>· 数据截至 {cloudCutoff || dataEndDate}</span>}
                {processedData && (
                  <span className="hidden lg:inline">
                    · {addBackFbaFee ? '毛利已加回国际运费' : '毛利为领星原始口径'}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              {cloudConnected && (
                <button
                  type="button"
                  onClick={() => setCloudRefreshTick(v => v + 1)}
                  disabled={cloudLoading}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-black/[0.08] bg-white px-3.5 text-[13px] font-medium text-[#1d1d1f] transition hover:bg-black/[0.03] disabled:opacity-50 dark:border-white/[0.1] dark:bg-[#191c24] dark:text-[#f5f5f7]"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${cloudLoading ? 'animate-spin' : ''}`} />
                  刷新
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowUploadModal(true)}
                disabled={restoreFailed}
                title={restoreFailed ? '本地数据读取失败，刷新并排查后再导入' : undefined}
                className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#4f46e5] px-4 text-[13px] font-semibold text-white shadow-[0_6px_16px_-6px_rgba(79,70,229,0.65)] transition hover:bg-[#4338ca] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FileSpreadsheet className="h-4 w-4" />
                {displayPerformanceData.length > 0 ? '更新数据' : '导入数据'}
              </button>
            </div>
          </div>

          <TopFilterBar
            data={activeRawData}
            filters={filters}
            setFilters={setFilters}
            periodMode={periodMode}
            cloudConnected={cloudConnected}
            onChangePeriodMode={handleSetPeriodMode}
            onStepPeriod={handleStepPeriod}
            onOpenMoreFilters={() => setMoreFiltersOpen(true)}
          />

          {CLOUD_ENABLED && cloudStatus && (
            <div role="status" className="rounded-2xl border border-amber-200/80 bg-amber-50/90 px-4 py-2.5 text-xs font-medium text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
              {cloudStatus}
            </div>
          )}
          {persistenceError && (
            <div role="alert" className="flex items-center justify-between rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
              <span>{persistenceError}</span>
              <button type="button" onClick={() => setPersistenceError('')} className="ml-3 font-semibold">关闭</button>
            </div>
          )}

          {focusPath.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-indigo-500/20 bg-[#eef2ff] px-3.5 py-2 text-xs text-[#4f46e5] dark:bg-indigo-500/15 dark:text-indigo-200">
              <span className="font-semibold">当前聚焦</span>
              {focusPath.map(item => (
                <button
                  key={`${item.field}-${item.value}`}
                  type="button"
                  onClick={() => blurEntity(item.field)}
                  className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-0.5 text-[#1d1d1f] shadow-sm transition hover:text-[#4f46e5] dark:bg-[#191c24] dark:text-[#f5f5f7]"
                >
                  {item.label}
                  <X className="h-3 w-3" />
                </button>
              ))}
              <button type="button" onClick={clearAllFocus} className="ml-1 font-medium hover:underline">全部清除</button>
              <span className="ml-auto hidden text-[11px] opacity-70 sm:inline">Esc 退出聚焦</span>
            </div>
          )}

          {isRestoringData ? (
            <div className="flex flex-col items-center justify-center rounded-[24px] border border-black/[0.06] bg-white py-24 text-[#86868b] dark:border-white/[0.08] dark:bg-[#191c24]">
              <Database className="mb-4 h-11 w-11 animate-pulse text-indigo-400" />
              <p className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">正在恢复本地缓存…</p>
              <LoadingBar className="mt-5" />
            </div>
          ) : !processedData ? (
            (cloudLoading || (CLOUD_ENABLED && Boolean(cloudToken) && !cloudConnected && !cloudStatus)) && !activeRawData.length ? (
              <LoadingSkeleton label={`正在加载 ${filters.startDate} ~ ${filters.endDate} 的业绩数据…`} />
            ) : (
              <div className="flex flex-col items-center justify-center rounded-[24px] border border-black/[0.06] bg-white py-24 text-[#86868b] dark:border-white/[0.08] dark:bg-[#191c24]">
                <div className="mb-5 rounded-2xl bg-[#eef2ff] p-5 text-[#4f46e5] dark:bg-indigo-500/15 dark:text-indigo-300">
                  <FileSpreadsheet className="h-10 w-10" />
                </div>
                <p className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                  {restoreFailed ? '本地数据暂时无法读取' : activeRawData.length ? '当前周期暂无数据' : cloudConnected ? '当前区间云端暂无数据' : '暂无业绩数据'}
                </p>
                <p className="mt-1.5 max-w-md text-center text-sm text-[#86868b]">
                  {restoreFailed
                    ? '请检查浏览器存储权限后刷新页面'
                    : activeRawData.length
                    ? '请使用上方周期切换器调整日期，或切换月 / 周 / 日粒度'
                    : isDailyMode && !cloudConnected
                    ? '日度视图需要连接云端数据；本地导入的月报/周报没有日粒度'
                    : cloudConnected
                    ? '可切换其他月份/周，或在设置 → 数据管理里查看同步进度'
                    : '可以先加载脱敏样例体验界面，或直接导入自己的报表'}
                </p>
                {!restoreFailed && !activeRawData.length && !cloudConnected && (
                  <div className="mt-6 flex flex-wrap justify-center gap-2.5">
                    <button type="button" onClick={downloadImportTemplate} className="rounded-xl border border-black/[0.08] bg-white px-4 py-2 text-sm font-medium text-[#1d1d1f] hover:bg-black/[0.03] dark:border-white/[0.1] dark:bg-[#191c24] dark:text-[#f5f5f7]">下载模板</button>
                    <button type="button" onClick={handleLoadSample} className="rounded-xl border border-indigo-500/20 bg-[#eef2ff] px-4 py-2 text-sm font-semibold text-[#4f46e5]">加载脱敏样例</button>
                    <button type="button" onClick={() => setShowUploadModal(true)} className="rounded-xl bg-[#4f46e5] px-4 py-2 text-sm font-semibold text-white">导入数据</button>
                  </div>
                )}
              </div>
            )
          ) : (
            <div className="space-y-6">
              {activeTab === 'overview' && (
                <>
                  <section id="overview">
                    <DashboardOverview
                      current={processedData.current}
                      target={processedData.target}
                      periodMode={periodMode}
                      rawData={activeRawData}
                      filters={filters}
                      targetRows={displayTargetData}
                      pacingRatio={processedData.pacingRatio}
                      historyData={
                        useCloudData
                          ? (periodMode === 'month'
                              ? trendHistoryCorrected.month
                              : periodMode === 'week'
                              ? trendHistoryCorrected.week
                              : trendHistoryCorrected.day
                            ).length > 0
                            ? (periodMode === 'month'
                                ? trendHistoryCorrected.month
                                : periodMode === 'week'
                                ? trendHistoryCorrected.week
                                : trendHistoryCorrected.day)
                            : activeRawData
                          : performanceData
                      }
                    />
                  </section>

                  {radar && (
                    <section id="issues">
                      <AnomalyRadar
                        report={radar}
                        periodLabel={`${filters.startDate} ~ ${filters.endDate}`}
                        onDrillAsin={asin => setQuickDrawerTarget({ kind: 'asin', key: asin })}
                      />
                    </section>
                  )}

                  <OverviewQuickRanks
                    rows={processedData.currentRows}
                    inventoryRows={processedData.invRows}
                    onSelectEntity={(kind, key) => setQuickDrawerTarget({ kind, key })}
                    onGoToTab={tab => setActiveTab(tab)}
                  />
                </>
              )}

              {activeTab === 'profit' && (
                <>
                  <section id="pl">
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
                  </section>

                  <Suspense fallback={null}>
                    <ProfitWaterfall
                      current={processedData.current}
                      last={processedData.last}
                      currentRows={processedData.currentRows}
                      lastRows={processedData.lastRows}
                      onFocusAsin={asin => setQuickDrawerTarget({ kind: 'asin', key: asin })}
                    />
                  </Suspense>

                  <MetricMatrix
                    rows={activeRawData}
                    onPick={(asin, date) => {
                      focusEntity('childAsins', asin);
                      setPeriodMode('day');
                      setFilters(prev => ({ ...prev, startDate: date, endDate: date }));
                    }}
                  />
                </>
              )}

              {activeTab === 'traffic' && (
                <section id="traffic">
                  <TrafficTable
                    current={processedData.current}
                    last={processedData.last}
                    year={processedData.year}
                    target={processedData.target}
                    onOpenDetail={() => { setDetailType('Traffic'); setDetailModalOpen(true); }}
                    onOpenKeywordAnalysis={() => setKeywordModalOpen(true)}
                  />
                </section>
              )}

              {activeTab === 'inventory' && (
                <>
                  <section id="inventory">
                    <InventoryTable
                      data={processedData.inventory}
                      inventoryRows={processedData.invRows}
                      snapshotDate={cloudInventoryDate}
                      onOpenDetail={() => { setDetailType('Inventory'); setDetailModalOpen(true); }}
                    />
                  </section>

                  <InventoryDecision
                    rows={processedData.invRows}
                    salesRows={activeRawData}
                    imageLookup={productImageLookup}
                    onFocusParent={asin => setQuickDrawerTarget({ kind: 'asin', key: asin })}
                  />

                  <Suspense fallback={null}>
                    <StockHealth
                      rows={activeRawData}
                      onFocusAsin={asin => setQuickDrawerTarget({ kind: 'asin', key: asin })}
                    />
                  </Suspense>
                </>
              )}

              {activeTab === 'topics' && (
                <TopicsHub
                  refundCount={refundData.length}
                  reviewCount={reviewData.length}
                  keywordCount={searchTermData.length}
                  onOpenRefund={() => handleOpenRefundAnalysis()}
                  onOpenReview={() => setReviewModalOpen(true)}
                  onOpenKeyword={() => setKeywordModalOpen(true)}
                  onOpenSimulator={() => handleOpenCalculator()}
                  onOpenDetail={() => { setDetailType('PL'); setDetailModalOpen(true); }}
                  onOpenDoctor={() => setShowCloudAdmin(true)}
                />
              )}
            </div>
          )}
        </div>
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
                performanceMonthly={useCloudData && trendHistoryCorrected.month.length ? trendHistoryCorrected.month : displayPerformanceData}
                performanceWeekly={useCloudData && trendHistoryCorrected.week.length ? trendHistoryCorrected.week : displayWeeklyData}
                performanceDaily={useCloudData && trendHistoryCorrected.day.length ? trendHistoryCorrected.day : displayDailyData}
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
        {!chatLoaded && <button type="button" aria-label="打开 AI 顾问" onClick={() => setChatLoaded(true)} className="fixed bottom-6 right-6 z-50 rounded-full bg-[linear-gradient(135deg,#3b82f6_0%,#6366f1_55%,#7c3aed_100%)] p-3.5 text-white shadow-[0_12px_28px_-6px_rgba(79,70,229,0.55)] transition hover:scale-105 active:scale-95"><Sparkles className="h-5 w-5" /></button>}
        {chatLoaded && <Suspense fallback={<div role="status" className="fixed bottom-6 right-6 z-50 rounded-full bg-[#4f46e5] p-3.5 text-xs text-white shadow-lg">加载中…</div>}><ChatBot 
            data={processedData} 
            inventory={processedData?.inventory || null}
            refunds={refundData}
            filters={filters} 
            rawPerformance={activeRawData}
            rawInventory={inventoryData}
            initialOpen
        /></Suspense>}
    </div>
  );
};

export default App;

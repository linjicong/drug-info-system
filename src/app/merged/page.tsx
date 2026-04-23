'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Toaster } from 'sonner';
import { toast } from 'sonner';
import { SearchCard, type FilterFieldConfig, type FilterValues } from '@/components/drug/SearchCard';
import { MergedDrugTable } from '@/components/drug/MergedDrugTable';
import { ActionBar } from '@/components/drug/ActionBar';
import { UsageGuide } from '@/components/drug/UsageGuide';
import { MergeProgressCard } from '@/components/drug/MergeProgressCard';
import { StatsCard } from '@/components/drug/StatsCard';
import { Badge } from '@/components/ui/badge';
import { Layers } from 'lucide-react';
import type { MergedDrugInfo, PaginationInfo, SchedulerConfig } from '@/components/drug/types';
import type { MergeProgress } from '@/lib/merged-progress-manager';

/** 汇总表筛选字段配置 */
  const MERGED_FILTER_FIELDS: FilterFieldConfig[] = [
    {
      key: 'productName',
      label: '产品名称',
      type: 'input',
      placeholder: '输入产品名称',
    },
    {
      key: 'nationalDrugCode',
      label: '医保编码',
      type: 'input',
      placeholder: '输入医保编码',
    },
    {
      key: 'companyName',
      label: '生产企业',
      type: 'input',
      placeholder: '输入生产企业名称',
    },
    {
      key: 'minPacQuantity',
      label: '最小包装数量',
      type: 'input',
      placeholder: '输入最小包装数量',
    },
    {
      key: 'minMeasureUnit',
      label: '最小计量单位',
      type: 'input',
      placeholder: '输入最小计量单位',
    },
  ];

/** 使用说明 */
const MERGED_INSTRUCTIONS = [
  '**重要操作**：由于系统采用了独立新表（merged_drug_info）保存合并结果，点击上方「手动合并」按钮，会并发抓取两表数据并重写新表。',
  '**药品汇总**：本页面汇总广东省医保局与广州药品采购平台数据，通过「产品名称+医保编码+生产企业+最小包装数量+最小包装单位」五字段去重',
  '**价格对比**：「省平台挂网价格」来自广东医保局，「GPO挂网价格」和「GPO最小规格价格」来自广州采购平台',
  '**展开详情**：点击行首展开按钮查看完整字段信息',
  '**多条件筛选**：支持关键字、生产企业、数据来源、医保类别、医保编码等多条件组合查询',
  '**导出数据**：点击「导出 Excel」按钮将当前搜索结果导出为 Excel 文件，支持十万级数据',
];

const DEFAULT_MERGE_PROGRESS: MergeProgress = {
  status: 'idle',
  phase: '',
  gdLoaded: 0,
  gzLoaded: 0,
  mergedTotal: 0,
  savedCount: 0,
  startTime: null,
  endTime: null,
  error: null,
};

const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  enabled: false,
  intervalMinutes: 60,
  isRunning: false,
  runningStatus: 'idle',
  nextRunAt: null,
  lastRunAt: null,
  lastRunStatus: null,
};

const MERGED_QUERY_STORAGE_KEY = 'merged-query-state';
const MERGED_PROGRESS_STORAGE_KEY = 'merged-progress-state';

type MergedQueryState = {
  searchKeyword: string;
  filterValues: FilterValues;
};

const readMergedQueryState = (): MergedQueryState | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(MERGED_QUERY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MergedQueryState>;
    return {
      searchKeyword: typeof parsed.searchKeyword === 'string' ? parsed.searchKeyword : '',
      filterValues: parsed.filterValues && typeof parsed.filterValues === 'object' ? parsed.filterValues : {},
    };
  } catch {
    return null;
  }
};

const readMergedProgressState = (): MergeProgress | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(MERGED_PROGRESS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MergeProgress>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!['idle', 'running', 'completed', 'error'].includes(String(parsed.status))) return null;
    return {
      status: parsed.status as MergeProgress['status'],
      phase: typeof parsed.phase === 'string' ? parsed.phase : '',
      gdLoaded: Number(parsed.gdLoaded ?? 0),
      gzLoaded: Number(parsed.gzLoaded ?? 0),
      mergedTotal: Number(parsed.mergedTotal ?? 0),
      savedCount: Number(parsed.savedCount ?? 0),
      startTime: parsed.startTime ?? null,
      endTime: parsed.endTime ?? null,
      error: typeof parsed.error === 'string' ? parsed.error : null,
    };
  } catch {
    return null;
  }
};

/**
 * 药品汇总表页面
 */
export default function MergedDrugPage() {
  const persistedQueryState = readMergedQueryState();
  const persistedMergeProgressRef = useRef<MergeProgress | null>(readMergedProgressState());

  // 数据状态
  const [drugs, setDrugs] = useState<MergedDrugInfo[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
  });
  const [searchKeyword, setSearchKeyword] = useState(persistedQueryState?.searchKeyword ?? '');
  const [filterValues, setFilterValues] = useState<FilterValues>(persistedQueryState?.filterValues ?? {});
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // 进度状态
  const [mergeProgress, setMergeProgress] = useState<MergeProgress>(
    persistedMergeProgressRef.current ?? DEFAULT_MERGE_PROGRESS
  );
  const [now, setNow] = useState(Date.now());

  // 调度器状态
  const [schedulerConfig, setSchedulerConfig] = useState<SchedulerConfig>(DEFAULT_SCHEDULER_CONFIG);
  const [configLoading, setConfigLoading] = useState(true);

  // 定时器引用，分别用于进度条轮询和调度器状态轮询
  const pollingRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const schedulerPollingRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const autoSearchInitializedRef = useRef(false);
  const lastMergeStatusRef = useRef<MergeProgress['status']>(
    persistedMergeProgressRef.current?.status ?? 'idle'
  );
  // 进度卡片自动隐藏定时器（完成/出错后延迟收起）
  const progressHideTimerRef = useRef<NodeJS.Timeout | null>(null);
  // 跟踪客户端当前的合并进度状态，供 setInterval 回调读取最新值
  const mergeStatusRef = useRef<MergeProgress['status']>(
    persistedMergeProgressRef.current?.status ?? 'idle'
  );

  const clearProgressHideTimer = useCallback(() => {
    if (progressHideTimerRef.current) {
      clearTimeout(progressHideTimerRef.current);
      progressHideTimerRef.current = null;
    }
  }, []);

  // 记录搜索关键词引用
  const searchKeywordRef = useRef(searchKeyword);
  useEffect(() => {
    searchKeywordRef.current = searchKeyword;
  }, [searchKeyword]);

  // 记录筛选值引用
  const filterValuesRef = useRef(filterValues);
  useEffect(() => {
    filterValuesRef.current = filterValues;
  }, [filterValues]);

  /** 加载整合药品数据 */
  const loadDrugs = useCallback(async (page = pagination.page) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pagination.pageSize.toString(),
      });
      if (searchKeyword) params.append('search', searchKeyword);

      // 附加额外筛选参数
      for (const [key, value] of Object.entries(filterValues)) {
        if (value) params.append(key, value);
      }

      const response = await fetch(`/api/merged/drugs?${params}`);
      const result = await response.json();

      if (response.ok && result.data) {
        setDrugs(result.data);
        if (result.pagination) {
          setPagination(result.pagination);
        }
      } else {
        toast.error('加载失败', { description: result.message || '查询接口返回异常' });
      }
    } catch {
      toast.error('加载失败', { description: '网络错误，请尝试刷新页面' });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, pagination.pageSize, searchKeyword, filterValues]);

  /** 读取调度器配置 */
  const loadSchedulerConfig = useCallback(async (isInitial = false) => {
    if (isInitial) setConfigLoading(true);
    try {
      const response = await fetch(`/api/merged/drugs/scheduler?_t=${Date.now()}`, { cache: 'no-store' });
      const result = await response.json();

      if (result.success && result.data) {
        setSchedulerConfig(result.data);
      }
    } catch (e) {
      console.error('获取同步调度器配置失败:', e);
    } finally {
      if (isInitial) setConfigLoading(false);
    }
  }, []);

  /** 更新调度器配置 */
  const updateSchedulerConfig = async (updates: { enabled?: boolean; intervalMinutes?: number }) => {
    try {
      const response = await fetch('/api/merged/drugs/scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      const result = await response.json();

      if (result.success) {
        toast.success(result.message);
        loadSchedulerConfig();
      } else {
        toast.error('更新定步失败', { description: result.message });
      }
    } catch {
      toast.error('更新配置失败', { description: '网络错误，请重试' });
    }
  };

  const applyMergeProgress = useCallback((next: MergeProgress) => {
    setMergeProgress(next);
    lastMergeStatusRef.current = next.status;
    mergeStatusRef.current = next.status;
    if (typeof window === 'undefined') return;
    if (next.status === 'idle') {
      window.sessionStorage.removeItem(MERGED_PROGRESS_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(MERGED_PROGRESS_STORAGE_KEY, JSON.stringify(next));
  }, []);

  /** 延时自动隐藏合并进度卡片，同步重置服务端进度 */
  const scheduleHideMergeProgress = useCallback((delayMs = 3000) => {
    clearProgressHideTimer();
    progressHideTimerRef.current = setTimeout(() => {
      progressHideTimerRef.current = null;
      fetch('/api/merged/drugs/sync/progress', { method: 'DELETE' }).catch(() => {});
      applyMergeProgress(DEFAULT_MERGE_PROGRESS);
    }, delayMs);
  }, [applyMergeProgress, clearProgressHideTimer]);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = undefined;
    }
  }, []);

  /** 轮询合并进度 */
  const startPolling = useCallback(() => {
    if (pollingRef.current) return;

    pollingRef.current = setInterval(async () => {
      try {
        const response = await fetch(`/api/merged/drugs/sync/progress?_t=${Date.now()}`, { cache: 'no-store' });
        if (response.ok) {
          const prevStatus = lastMergeStatusRef.current;
          const data = await response.json() as MergeProgress;

          // 服务端启动有延迟：期间仍是 idle，但客户端点击后已设 running，忽略 idle 避免卡片闪烁
          if (data.status === 'idle' && mergeStatusRef.current === 'running') {
            setNow(Date.now());
            return;
          }

          applyMergeProgress(data);
          setNow(Date.now());

          if (data.status === 'completed' || data.status === 'error') {
            stopPolling();
            // 任务结束后立刻刷新调度状态，推动按钮恢复为可点击
            loadSchedulerConfig();
            if (data.status === 'completed' && prevStatus === 'running') {
              toast.success('合并同步任务已完成', { description: '正在重载数据...' });
              handleSearch(); // 刷新数据
            } else if (data.status === 'error' && prevStatus === 'running') {
              toast.error('合并同步任务失败', { description: data.error });
            }
            // 完成/出错后延迟自动隐藏进度卡片
            scheduleHideMergeProgress(data.status === 'error' ? 6000 : 3000);
          }
        }
      } catch (error) {
        console.error('获取同步进度失败', error);
      }
    }, 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyMergeProgress, loadSchedulerConfig, stopPolling, scheduleHideMergeProgress]);

  /** 自动状态探针（用于响应系统的自动调度触发事件） */
  useEffect(() => {
    const intervalMs = schedulerConfig.runningStatus === 'running' ? 1000 : 5000;
    schedulerPollingRef.current = setInterval(() => {
      // 无论当前状态如何，都先刷新调度器状态，避免 running_status 卡住不更新
      loadSchedulerConfig();

      // 探针如果发现正在 running 但前端没有开启详尽的 progress 轮询，则开启一下
      if (schedulerConfig.runningStatus === 'running' && mergeProgress.status !== 'running') {
        startPolling();
      }
    }, intervalMs);

    return () => {
      if (schedulerPollingRef.current) clearInterval(schedulerPollingRef.current);
    };
  }, [schedulerConfig.runningStatus, mergeProgress.status, loadSchedulerConfig, startPolling]);

  useEffect(() => {
    if (schedulerConfig.runningStatus !== 'idle') return;
    if (mergeProgress.status !== 'running') return;

    fetch(`/api/merged/drugs/sync/progress?_t=${Date.now()}`, { cache: 'no-store' })
      .then(res => res.json())
      .then((data: MergeProgress) => {
        applyMergeProgress(data);
        if (data.status !== 'running') {
          stopPolling();
        }
      })
      .catch(() => {
        applyMergeProgress(DEFAULT_MERGE_PROGRESS);
        stopPolling();
      });
  }, [schedulerConfig.runningStatus, mergeProgress.status, applyMergeProgress, stopPolling]);


  /** 开始手动合并同步操作 */
  const handleMergeAction = async () => {
    try {
      // 新一轮合并开始，清理上一次的自动隐藏定时器
      clearProgressHideTimer();

      // 立即以占位 running 状态呈现进度卡片，避免服务端启动延迟导致卡片不出现
      // 同时写入 sessionStorage，刷新页面也能保留进度态
      applyMergeProgress({
        ...DEFAULT_MERGE_PROGRESS,
        status: 'running',
        phase: '正在启动归档...',
        startTime: Date.now(),
      });
      startPolling();

      const response = await fetch('/api/merged/drugs/sync', { method: 'POST' });
      const result = await response.json();

      if (response.ok) {
        toast.success(result.message);
        loadSchedulerConfig(); // 强刷状态
      } else {
        toast.error('提交执行失败', { description: result.message });
        // 请求被拒绝（如 409 正在运行）或失败，回滚客户端 running 占位态
        stopPolling();
        applyMergeProgress(DEFAULT_MERGE_PROGRESS);
      }
    } catch {
      toast.error('网络错误', { description: '无法请求服务端，请检查连接连接是否正常' });
      stopPolling();
      applyMergeProgress(DEFAULT_MERGE_PROGRESS);
    }
  };

  /** 搜索处理 */
  const handleSearch = () => {
    setPagination(prev => ({ ...prev, page: 1 }));
    loadDrugs(1);
  };

  /** 重置筛选条件 */
  const handleReset = () => {
    setSearchKeyword('');
    setFilterValues({});
    setPagination(prev => ({ ...prev, page: 1 }));
  };

/** 更新单个筛选字段值 */
const handleFilterChange = (key: string, value: string) => {
  setFilterValues(prev => {
    const next = { ...prev };
    if (value === 'all') {
      delete next[key];
    } else {
      next[key] = value;
    }
    return next;
  });
};

  /** 分页处理 */
  const handlePageChange = (newPage: number) => {
    setPagination(prev => ({ ...prev, page: newPage }));
  };

  /** 展开/收起行 */
  const toggleRowExpand = (id: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  /** 导出 Excel */
  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (searchKeywordRef.current) params.append('search', searchKeywordRef.current);
      for (const [key, value] of Object.entries(filterValuesRef.current)) {
        if (value) params.append(key, value);
      }

      const response = await fetch(`/api/merged/drugs/export?${params}`);

      if (!response.ok) {
        const result = await response.json();
        toast.error('导出失败', { description: result.message });
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;

      const contentDisposition = response.headers.get('content-disposition');
      let filename = '药品汇总表.xlsx';
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename\*?=['""]?(?:UTF-\d['"]*)?([^;'"]+)/i);
        if (filenameMatch?.[1]) {
          filename = decodeURIComponent(filenameMatch[1]);
        }
      }
      link.download = filename;
      link.click();
      window.URL.revokeObjectURL(url);

      toast.success('导出成功', { description: 'Excel 文件已下载' });
    } catch {
      toast.error('导出失败', { description: '网络错误，请重试' });
    } finally {
      setExporting(false);
    }
  };

  /** 格式化价格 */
  const formatPrice = (price?: number) => {
    if (price === undefined || price === null) return '-';
    return `¥${price.toFixed(2)}`;
  };

  /** 计算任务耗时 */
  const getDuration = () => {
    if (!mergeProgress.startTime) return '0秒';
    const end = mergeProgress.endTime || now;
    const diff = Math.floor((end - mergeProgress.startTime) / 1000);
    const m = Math.floor(diff / 60);
    const s = diff % 60;
    return m > 0 ? `${m}分${s}秒` : `${s}秒`;
  };

  // 初始化
  useEffect(() => {
    loadDrugs(1);
    loadSchedulerConfig(true);

    if (persistedMergeProgressRef.current?.status === 'running') {
      startPolling();
    }

    fetch(`/api/merged/drugs/sync/progress?_t=${Date.now()}`, { cache: 'no-store' })
      .then(res => res.json())
      .then((data: MergeProgress) => {
        applyMergeProgress(data);
        if (data.status === 'running') {
          startPolling();
        } else {
          stopPolling();
          // 刷新页面时若服务端是已完成/出错的残留状态，稍后自动隐藏
          if (data.status === 'completed') {
            scheduleHideMergeProgress(3000);
          } else if (data.status === 'error') {
            scheduleHideMergeProgress(6000);
          }
        }
      })
      .catch();

    return () => {
      stopPolling();
      clearProgressHideTimer();
    };
    // 只在首次进入页面时初始化，避免重复触发请求/轮询导致死循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 分页变化时重新加载
  useEffect(() => {
    loadDrugs(pagination.page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page]);

  // 关键词或筛选条件变化时自动触发查询
  useEffect(() => {
    if (!autoSearchInitializedRef.current) {
      autoSearchInitializedRef.current = true;
      return;
    }

    if (pagination.page !== 1) {
      setPagination(prev => ({ ...prev, page: 1 }));
      return;
    }

    loadDrugs(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKeyword, filterValues]);

  // 记忆查询条件（菜单切换后返回时恢复）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(MERGED_QUERY_STORAGE_KEY, JSON.stringify({
      searchKeyword,
      filterValues,
    }));
  }, [searchKeyword, filterValues]);

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <Toaster position="top-right" />

      {/* 页面标题 */}
      <div className="mb-8">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-violet-600 text-white shadow-md">
                <Layers className="w-5 h-5" />
              </div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                药品汇总表 (归档库)
              </h1>
            </div>
            <p className="text-gray-600 dark:text-gray-400 mt-1 ml-13 max-w-3xl">
              基于广东省医保局与广州药品采购平台同步下来的双库数据，进行自动化统一去重、整合，并进行全量重制落盘。
            </p>
          </div>
        </div>
      </div>

      {/* 合并进度卡片 */}
      <MergeProgressCard
        progress={mergeProgress}
        formatDuration={getDuration}
      />

      {/* 搜索筛选区域 */}
      <div className="mb-6">
        <SearchCard
          searchKeyword={searchKeyword}
          onSearchKeywordChange={setSearchKeyword}
          onSearch={handleSearch}
          onReset={handleReset}
          loading={loading}
          placeholder="搜索产品名称或生产企业..."
          filterFields={MERGED_FILTER_FIELDS}
          filterValues={filterValues}
          onFilterChange={handleFilterChange}
        />
      </div>

      {/* 数据统计（可展示来源统计和数据库情况） */}
      <StatsCard
        pagination={pagination}
        schedulerConfig={schedulerConfig}
      />

      {/* 去重规则说明 */}
      <div className="flex flex-wrap gap-2 mb-6 items-center">
        <span className="text-sm border py-1.5 px-3 rounded text-purple-700 bg-purple-50 dark:bg-purple-900/20 dark:text-purple-300 dark:border-purple-800">
          合并规则
        </span>
        <span className="text-sm text-gray-500 ml-2">主键联合去重依据：</span>
        {['产品名称', '医保编码', '生产企业', '最小包装数量', '最小包装单位'].map((field) => (
          <Badge key={field} variant="outline" className="text-xs dark:bg-gray-800">
            {field}
          </Badge>
        ))}
      </div>

      {/* 操作按钮：使用「手动合并」替代默认的「手动抓取」 */}
      <ActionBar
        fetchStatus={schedulerConfig.runningStatus === 'running' ? 'running' : 'idle'}
        exporting={exporting}
        total={pagination.total}
        onFetch={handleMergeAction}
        onExport={handleExport}
        fetchText="执行手动全量合并"
      />

      {/* 数据表格 */}
      <MergedDrugTable
        drugs={drugs}
        pagination={pagination}
        loading={loading}
        expandedRows={expandedRows}
        onToggleRowExpand={toggleRowExpand}
        onPageChange={handlePageChange}
        formatPrice={formatPrice}
      />

      {/* 使用说明 */}
      <UsageGuide
        instructions={MERGED_INSTRUCTIONS}
        sourceUrl="https://igi.hsa.gd.gov.cn"
        sourceName="广东省医保局 & 广州药品采购平台"
      />
    </div>
  );
}

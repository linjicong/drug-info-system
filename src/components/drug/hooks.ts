'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import type {
  PaginationInfo,
  FetchProgress,
  SchedulerConfig,
  DrugModuleApiConfig,
} from './types';
import type { FilterValues } from './SearchCard';

type ModuleQueryState = {
  searchKeyword: string;
  filterValues: FilterValues;
};

const buildModuleQueryStorageKey = (drugsApi: string) => `drug-module-query:${drugsApi}`;
const buildProgressStorageKey = (progressApi: string) => `drug-module-progress:${progressApi}`;

const readModuleQueryState = (storageKey: string): ModuleQueryState | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ModuleQueryState>;
    return {
      searchKeyword: typeof parsed.searchKeyword === 'string' ? parsed.searchKeyword : '',
      filterValues: parsed.filterValues && typeof parsed.filterValues === 'object' ? parsed.filterValues : {},
    };
  } catch {
    return null;
  }
};

const readProgressState = (storageKey: string): FetchProgress | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FetchProgress>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!['idle', 'running', 'completed', 'error'].includes(String(parsed.status))) return null;
    return {
      status: parsed.status as FetchProgress['status'],
      currentPage: Number(parsed.currentPage ?? 0),
      totalPages: Number(parsed.totalPages ?? 0),
      processedCount: Number(parsed.processedCount ?? 0),
      totalCount: Number(parsed.totalCount ?? 0),
      newCount: Number(parsed.newCount ?? 0),
      updateCount: Number(parsed.updateCount ?? 0),
      startTime: parsed.startTime ?? null,
      endTime: parsed.endTime ?? null,
      error: typeof parsed.error === 'string' ? parsed.error : null,
    };
  } catch {
    return null;
  }
};

/**
 * 药品模块通用 Hook
 * 封装药品列表加载、搜索、分页、导出、进度轮询和调度器配置等通用逻辑
 * 通过 apiConfig 参数区分不同模块的 API 路径
 */
export function useDrugModule<T extends { id: string }>(apiConfig: DrugModuleApiConfig) {
  const queryStorageKey = buildModuleQueryStorageKey(apiConfig.drugsApi);
  const progressStorageKey = buildProgressStorageKey(apiConfig.progressApi);
  const persistedQueryState = readModuleQueryState(queryStorageKey);
  const persistedProgressState = readProgressState(progressStorageKey);

  // 药品列表数据
  const [drugs, setDrugs] = useState<T[]>([]);
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

  // 抓取进度状态
  const [progress, setProgress] = useState<FetchProgress>(() => persistedProgressState ?? {
    status: 'idle',
    currentPage: 0,
    totalPages: 0,
    processedCount: 0,
    totalCount: 0,
    newCount: 0,
    updateCount: 0,
    startTime: null,
    endTime: null,
    error: null,
  });

  // 调度器配置
  const [schedulerConfig, setSchedulerConfig] = useState<SchedulerConfig>({
    enabled: false,
    intervalMinutes: 60,
    nextRunAt: null,
    lastRunAt: null,
    lastRunStatus: null,
    isRunning: false,
  });
  const [configLoading, setConfigLoading] = useState(false);

  // 进度轮询定时器
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  /** 加载调度器配置 */
  const loadSchedulerConfig = useCallback(async () => {
    try {
      const response = await fetch(apiConfig.schedulerApi);
      const result = await response.json();
      if (result.success) {
        setSchedulerConfig(result.data);
      }
    } catch (error) {
      console.error('加载调度器配置失败:', error);
    }
  }, [apiConfig.schedulerApi]);

  /** 加载药品列表 */
  const loadDrugs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        pageSize: pagination.pageSize.toString(),
      });
      if (searchKeyword) params.append('search', searchKeyword);

      // 附加额外筛选参数
      for (const [key, value] of Object.entries(filterValues)) {
        if (value) params.append(key, value);
      }

      const response = await fetch(`${apiConfig.drugsApi}?${params}`);
      const result = await response.json();

      if (result.success) {
        setDrugs(result.data);
        setPagination(result.pagination);
      } else {
        toast.error('加载失败', { description: result.message });
      }
    } catch {
      toast.error('加载失败', { description: '网络错误，请重试' });
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, searchKeyword, filterValues, apiConfig.drugsApi]);

  /** 更新调度器配置 */
  const updateSchedulerConfig = async (updates: { enabled?: boolean; intervalMinutes?: number }) => {
    setConfigLoading(true);
    try {
      const response = await fetch(apiConfig.schedulerApi, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const result = await response.json();

      if (result.success) {
        setSchedulerConfig(prev => ({
          ...prev,
          ...result.data,
        }));
        toast.success(result.message);
      } else {
        toast.error('配置更新失败', { description: result.message });
      }
    } catch {
      toast.error('配置更新失败', { description: '网络错误' });
    } finally {
      setConfigLoading(false);
    }
  };

  /** 停止进度轮询 */
  const stopProgressPolling = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  }, []);

  /** 更新并持久化进度 */
  const applyProgress = useCallback((next: FetchProgress) => {
    setProgress(next);
    if (typeof window === 'undefined') return;
    if (next.status === 'idle') {
      window.sessionStorage.removeItem(progressStorageKey);
      return;
    }
    window.sessionStorage.setItem(progressStorageKey, JSON.stringify(next));
  }, [progressStorageKey]);

  /** 开始进度轮询 */
  const startProgressPolling = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
    }

    progressIntervalRef.current = setInterval(async () => {
      try {
        const response = await fetch(apiConfig.progressApi);
        const data: FetchProgress = await response.json();
        applyProgress(data);

        // 同时刷新调度器配置以更新运行状态
        loadSchedulerConfig();

        if (data.status === 'completed') {
          toast.success('抓取完成', {
            description: `新增 ${data.newCount} 条，更新 ${data.updateCount} 条`,
          });
          stopProgressPolling();
          loadDrugs();
        }

        if (data.status === 'error' && data.error) {
          toast.error('抓取失败', { description: data.error });
          stopProgressPolling();
        }
      } catch (e) {
        console.error('获取进度失败:', e);
      }
    }, 1000);
  }, [apiConfig.progressApi, applyProgress, loadDrugs, loadSchedulerConfig, stopProgressPolling]);

  /** 加载当前进度（用于刷新页面后恢复状态） */
  const loadProgress = useCallback(async () => {
    const cached = readProgressState(progressStorageKey);
    if (cached && cached.status === 'running') {
      applyProgress(cached);
      startProgressPolling();
    }

    try {
      const response = await fetch(apiConfig.progressApi);
      const data: FetchProgress = await response.json();
      // 如果接口暂时回 idle，但本地存在 running 快照，则先保留运行态卡片
      if (data.status === 'idle' && cached?.status === 'running') {
        return;
      }
      applyProgress(data);

      // 刷新页面后若任务还在运行，自动恢复轮询
      if (data.status === 'running') {
        startProgressPolling();
      }
    } catch (e) {
      console.error('加载当前进度失败:', e);
    }
  }, [apiConfig.progressApi, applyProgress, progressStorageKey, startProgressPolling]);

  /** 手动抓取 */
  const handleFetch = async () => {
    try {
      startProgressPolling();

      const response = await fetch(apiConfig.fetchApi, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const result = await response.json();

      if (!result.success) {
        toast.error('抓取失败', { description: result.message });
        stopProgressPolling();
      }
    } catch {
      toast.error('抓取失败', { description: '网络错误，请重试' });
      stopProgressPolling();
    }
  };

  /** 导出 Excel */
  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (searchKeyword) params.append('search', searchKeyword);
      for (const [key, value] of Object.entries(filterValues)) {
        if (value) params.append(key, value);
      }

      const response = await fetch(`${apiConfig.exportApi}?${params}`);

      if (!response.ok) {
        const result = await response.json();
        toast.error('导出失败', { description: result.message });
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;

      // 从响应头获取文件名并解码
      const contentDisposition = response.headers.get('content-disposition');
      let filename = apiConfig.defaultExportFilename;
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename\*?=['"]?(?:UTF-\d['"]*)?([^;'"]+)/i);
        if (filenameMatch && filenameMatch[1]) {
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

  /** 搜索处理 */
  const handleSearch = () => {
    setPagination(prev => ({ ...prev, page: 1 }));
    loadDrugs();
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

  /** 计算进度百分比 */
  const progressPercent = progress.totalCount > 0
    ? Math.round((progress.processedCount / progress.totalCount) * 100)
    : 0;

  /** 格式化耗时 */
  const formatDuration = () => {
    if (!progress.startTime) return '-';
    const endTime = progress.endTime || Date.now();
    const seconds = Math.floor((endTime - progress.startTime) / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}分${remainingSeconds}秒`;
  };

  /** 格式化价格 */
  const formatPrice = (price?: number) => {
    if (price === undefined || price === null) return '-';
    return `¥${price.toFixed(2)}`;
  };

  // 初始加载
  useEffect(() => {
    loadDrugs();
    loadSchedulerConfig();
    loadProgress();
  }, [loadDrugs, loadSchedulerConfig, loadProgress]);

  // 记忆查询条件（菜单切换后返回时恢复）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(queryStorageKey, JSON.stringify({
      searchKeyword,
      filterValues,
    }));
  }, [queryStorageKey, searchKeyword, filterValues]);

  // 清理定时器
  useEffect(() => {
    return () => {
      stopProgressPolling();
    };
  }, [stopProgressPolling]);

  return {
    // 数据
    drugs,
    pagination,
    loading,
    exporting,
    expandedRows,
    progress,
    schedulerConfig,
    configLoading,
    searchKeyword,
    filterValues,

    // 操作
    setSearchKeyword,
    handleSearch,
    handleReset,
    handleFilterChange,
    handlePageChange,
    handleFetch,
    handleExport,
    toggleRowExpand,
    updateSchedulerConfig,

    // 计算值
    progressPercent,
    formatDuration,
    formatPrice,
  };
}

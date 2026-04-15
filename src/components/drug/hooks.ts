'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import type {
  PaginationInfo,
  FetchProgress,
  SchedulerConfig,
  DrugModuleApiConfig,
} from './types';

/**
 * 药品模块通用 Hook
 * 封装药品列表加载、搜索、分页、导出、进度轮询和调度器配置等通用逻辑
 * 通过 apiConfig 参数区分不同模块的 API 路径
 */
export function useDrugModule<T extends { id: string }>(apiConfig: DrugModuleApiConfig) {
  // 药品列表数据
  const [drugs, setDrugs] = useState<T[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
  });
  const [searchKeyword, setSearchKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // 抓取进度状态
  const [progress, setProgress] = useState<FetchProgress>({
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
  }, [pagination.page, pagination.pageSize, searchKeyword, apiConfig.drugsApi]);

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

  /** 开始进度轮询 */
  const startProgressPolling = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
    }

    progressIntervalRef.current = setInterval(async () => {
      try {
        const response = await fetch(apiConfig.progressApi);
        const data: FetchProgress = await response.json();
        setProgress(data);

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
  }, [apiConfig.progressApi, loadDrugs, loadSchedulerConfig, stopProgressPolling]);

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
      const response = await fetch(apiConfig.exportApi);

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
  }, [loadDrugs, loadSchedulerConfig]);

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

    // 操作
    setSearchKeyword,
    handleSearch,
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

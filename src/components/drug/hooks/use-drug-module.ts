'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import type { FetchProgress, DrugModuleApiConfig } from '../types';
import { buildProgressStorageKey } from './storage';
import { useDrugQuery } from './use-drug-query';
import { useProgressPolling } from './use-progress-polling';
import { useScheduler } from './use-scheduler';
import { trackEvent } from '@/lib/usage-tracker';

const DEFAULT_FETCH_PROGRESS: FetchProgress = {
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
};

/** 校验并归一化持久化的抓取进度快照 */
const parsePersistedFetchProgress = (raw: unknown): FetchProgress | null => {
  const parsed = raw as Partial<FetchProgress> | null;
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
};

/**
 * 药品模块通用 Hook
 * 组合查询、进度轮询与调度器三个子 Hook，
 * 封装药品列表加载、搜索、分页、导出、进度轮询和调度器配置等通用逻辑
 * 通过 apiConfig 参数区分不同模块的 API 路径
 */
export function useDrugModule<T extends { id: string }>(apiConfig: DrugModuleApiConfig) {
  // 埋点：由 fetchApi 推导数据源标识与页面路径（/api/gz/fetch → gz_drug, /gz）
  const fetchModulePath = `/${apiConfig.fetchApi.replace(/^\/api\/?/, '').split('/')[0] ?? ''}`;
  const fetchSourceMap: Record<string, string> = {
    '/gz': 'gz_drug',
    '/pubonln': 'gd_pubonln',
    '/merged': 'merged_drug',
  };
  const fetchSource = fetchSourceMap[fetchModulePath] ?? 'unknown';
  const isSyncAction = apiConfig.fetchApi.includes('/sync');

  const query = useDrugQuery<T>({
    drugsApi: apiConfig.drugsApi,
    exportApi: apiConfig.exportApi,
    defaultExportFilename: apiConfig.defaultExportFilename,
  });

  const scheduler = useScheduler({
    schedulerApi: apiConfig.schedulerApi,
  });

  const polling = useProgressPolling<FetchProgress>({
    progressApi: apiConfig.progressApi,
    storageKey: buildProgressStorageKey(apiConfig.progressApi),
    defaultProgress: DEFAULT_FETCH_PROGRESS,
    parsePersisted: parsePersistedFetchProgress,
    // 占位 running 期间服务端仍 idle：只刷新调度器状态，不应用进度
    onIdleIgnored: () => scheduler.loadSchedulerConfig(),
    onTick: (data) => {
      // 同时刷新调度器配置以更新运行状态
      scheduler.loadSchedulerConfig();

      if (data.status === 'completed') {
        toast.success('抓取完成', {
          description: `新增 ${data.newCount} 条，更新 ${data.updateCount} 条`,
        });
        query.loadDrugs();
      }

      if (data.status === 'error' && data.error) {
        toast.error('抓取失败', { description: data.error });
      }
    },
  });

  /** 手动抓取 */
  const handleFetch = async () => {
    try {
      // 新一轮抓取开始，清理上一次完成后的自动隐藏定时器
      polling.clearHideTimer();

      // 立即以占位 running 状态呈现进度卡片，避免服务端启动延迟导致卡片不出现
      // 同时写入 sessionStorage，刷新页面也能保留进度态
      polling.applyProgress({
        ...DEFAULT_FETCH_PROGRESS,
        status: 'running',
        startTime: Date.now(),
      });

      polling.startPolling();

      const response = await fetch(apiConfig.fetchApi, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const result = await response.json();

      if (!result.success) {
        toast.error('抓取失败', { description: result.message });
        polling.stopPolling();
        // 请求被拒绝（例如 409 正在运行）或失败，回滚客户端 running 占位态
        polling.resetToIdle();
      } else {
        // 埋点：抓取/合并同步任务成功入队
        trackEvent({
          event_type: 'scrape_trigger',
          event_name: isSyncAction ? 'sync_start' : 'fetch_start',
          page_path: fetchModulePath,
          detail: { source: fetchSource, action: isSyncAction ? 'sync' : 'fetch' },
        });
      }
    } catch {
      toast.error('抓取失败', { description: '网络错误，请重试' });
      polling.stopPolling();
      polling.resetToIdle();
    }
  };

  /** 计算进度百分比 */
  const progressPercent = polling.progress.totalCount > 0
    ? Math.round((polling.progress.processedCount / polling.progress.totalCount) * 100)
    : 0;

  // 初始加载（loadDrugs 随查询条件变化重建，同时驱动列表自动刷新）
  const { loadDrugs } = query;
  const { loadSchedulerConfig } = scheduler;
  const { loadProgress } = polling;
  useEffect(() => {
    loadDrugs();
    loadSchedulerConfig();
    loadProgress();
  }, [loadDrugs, loadSchedulerConfig, loadProgress]);

  return {
    // 数据
    drugs: query.drugs,
    pagination: query.pagination,
    loading: query.loading,
    exporting: query.exporting,
    expandedRows: query.expandedRows,
    progress: polling.progress,
    schedulerConfig: scheduler.schedulerConfig,
    configLoading: scheduler.configLoading,
    searchKeyword: query.searchKeyword,
    filterValues: query.filterValues,

    // 操作
    setSearchKeyword: query.setSearchKeyword,
    handleSearch: query.handleSearch,
    handleReset: query.handleReset,
    handleFilterChange: query.handleFilterChange,
    handlePageChange: query.handlePageChange,
    handleFetch,
    handleExport: query.handleExport,
    toggleRowExpand: query.toggleRowExpand,
    updateSchedulerConfig: scheduler.updateSchedulerConfig,

    // 计算值
    progressPercent,
    formatDuration: polling.formatDuration,
    formatPrice: query.formatPrice,
  };
}

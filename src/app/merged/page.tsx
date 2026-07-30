'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Toaster } from 'sonner';
import { toast } from 'sonner';
import { SearchCard } from '@/components/drug/SearchCard';
import { MergedDrugTable } from '@/components/drug/MergedDrugTable';
import { ActionBar } from '@/components/drug/ActionBar';
import { UsageGuide } from '@/components/drug/UsageGuide';
import { MergeProgressCard } from '@/components/drug/MergeProgressCard';
import { StatsCard } from '@/components/drug/StatsCard';
import { Badge } from '@/components/ui/badge';
import { Layers } from 'lucide-react';
import { useDrugQuery, useProgressPolling, useScheduler } from '@/components/drug/hooks';
import { DRUG_FILTER_FIELDS } from '@/components/drug/filter-fields';
import type { MergedDrugInfo, SchedulerConfig } from '@/components/drug/types';
import type { MergeProgress } from '@/lib/merged-progress-manager';

/** 使用说明 */
const MERGED_INSTRUCTIONS = [
  '**重要操作**：由于系统采用了独立新表（drug_info_merged）保存合并结果，点击上方「手动合并」按钮，会并发抓取两表数据并重写新表。',
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

/** 校验并归一化持久化的合并进度快照 */
const parsePersistedMergeProgress = (raw: unknown): MergeProgress | null => {
  const parsed = raw as Partial<MergeProgress> | null;
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
};

/**
 * 药品汇总表页面
 */
export default function MergedDrugPage() {
  // 每秒轮询时刷新，驱动耗时显示实时更新
  const [now, setNow] = useState(Date.now());
  const autoSearchInitializedRef = useRef(false);

  const query = useDrugQuery<MergedDrugInfo>({
    drugsApi: '/api/merged',
    exportApi: '/api/merged/export',
    defaultExportFilename: '药品汇总表.xlsx',
    queryStorageKey: MERGED_QUERY_STORAGE_KEY,
    loadErrorFallback: '查询接口返回异常',
    networkErrorDescription: '网络错误，请尝试刷新页面',
  });

  const polling = useProgressPolling<MergeProgress>({
    progressApi: '/api/merged/sync/progress',
    storageKey: MERGED_PROGRESS_STORAGE_KEY,
    defaultProgress: DEFAULT_MERGE_PROGRESS,
    parsePersisted: parsePersistedMergeProgress,
    // 占位 running 期间服务端仍 idle：仅刷新耗时显示
    onIdleIgnored: () => setNow(Date.now()),
    onTick: (data, prevStatus) => {
      setNow(Date.now());

      if (data.status === 'completed' || data.status === 'error') {
        // 任务结束后立刻刷新调度状态，推动按钮恢复为可点击
        loadSchedulerConfig();
        if (data.status === 'completed' && prevStatus === 'running') {
          toast.success('合并同步任务已完成', { description: '正在重载数据...' });
          handleSearch(); // 刷新数据
        } else if (data.status === 'error' && prevStatus === 'running') {
          toast.error('合并同步任务失败', { description: data.error });
        }
      }
    },
  });
  const { progress: mergeProgress, startPolling, stopPolling, applyProgress } = polling;

  const scheduler = useScheduler({
    schedulerApi: '/api/merged/scheduler',
    defaultConfig: DEFAULT_SCHEDULER_CONFIG,
    initialLoading: true,
    cacheBust: true,
    updateMode: 'reload',
    trackUpdateLoading: false,
    updateErrorTitle: '更新定步失败',
    updateNetworkErrorTitle: '更新配置失败',
    updateNetworkErrorDescription: '网络错误，请重试',
    // 自动状态探针（用于响应系统的自动调度触发事件）：
    // 运行期 5s 保障进度体验；空闲期 30s 即可（cron 间隔 60 分钟，发现延迟可接受）
    probe: {
      runningIntervalMs: 5000,
      idleIntervalMs: 30000,
      isProgressRunning: mergeProgress.status === 'running',
      onRunningDetected: startPolling,
    },
  });
  const { schedulerConfig, configLoading, loadSchedulerConfig, updateSchedulerConfig } = scheduler;

  // 调度器已空闲但前端仍显示 running 时，主动校准一次进度
  useEffect(() => {
    if (schedulerConfig.runningStatus !== 'idle') return;
    if (mergeProgress.status !== 'running') return;

    fetch(`/api/merged/sync/progress?_t=${Date.now()}`, { cache: 'no-store' })
      .then(res => res.json())
      .then((data: MergeProgress) => {
        applyProgress(data);
        if (data.status !== 'running') {
          stopPolling();
        }
      })
      .catch(() => {
        applyProgress(DEFAULT_MERGE_PROGRESS);
        stopPolling();
      });
  }, [schedulerConfig.runningStatus, mergeProgress.status, applyProgress, stopPolling]);

  /** 开始手动合并同步操作 */
  const handleMergeAction = async () => {
    try {
      // 新一轮合并开始，清理上一次的自动隐藏定时器
      polling.clearHideTimer();

      // 立即以占位 running 状态呈现进度卡片，避免服务端启动延迟导致卡片不出现
      // 同时写入 sessionStorage，刷新页面也能保留进度态
      applyProgress({
        ...DEFAULT_MERGE_PROGRESS,
        status: 'running',
        phase: '正在启动归档...',
        startTime: Date.now(),
      });
      startPolling();

      const response = await fetch('/api/merged/sync', { method: 'POST' });
      const result = await response.json();

      if (response.ok) {
        toast.success(result.message);
        loadSchedulerConfig(); // 强刷状态
      } else {
        toast.error('提交执行失败', { description: result.message });
        // 请求被拒绝（如 409 正在运行）或失败，回滚客户端 running 占位态
        stopPolling();
        applyProgress(DEFAULT_MERGE_PROGRESS);
      }
    } catch {
      toast.error('网络错误', { description: '无法请求服务端，请检查连接连接是否正常' });
      stopPolling();
      applyProgress(DEFAULT_MERGE_PROGRESS);
    }
  };

  /** 搜索处理（重置到第一页并立即查询） */
  const handleSearch = () => {
    query.setPagination(prev => ({ ...prev, page: 1 }));
    query.loadDrugs(1);
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
  const { loadDrugs } = query;
  const { loadProgress } = polling;
  useEffect(() => {
    loadDrugs(1);
    loadSchedulerConfig(true);
    loadProgress();
    // 只在首次进入页面时初始化，避免重复触发请求/轮询导致死循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 分页变化时重新加载
  useEffect(() => {
    loadDrugs(query.pagination.page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.pagination.page]);

  // 关键词或筛选条件变化时自动触发查询
  useEffect(() => {
    if (!autoSearchInitializedRef.current) {
      autoSearchInitializedRef.current = true;
      return;
    }

    if (query.pagination.page !== 1) {
      query.setPagination(prev => ({ ...prev, page: 1 }));
      return;
    }

    loadDrugs(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.searchKeyword, query.filterValues]);

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
          searchKeyword={query.searchKeyword}
          onSearchKeywordChange={query.setSearchKeyword}
          onSearch={handleSearch}
          onReset={query.handleReset}
          loading={query.loading}
          placeholder="搜索产品名称或生产企业..."
          filterFields={DRUG_FILTER_FIELDS}
          filterValues={query.filterValues}
          onFilterChange={query.handleFilterChange}
        />
      </div>

      {/* 数据统计（可展示来源统计和数据库情况） */}
      <StatsCard
        pagination={query.pagination}
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
        exporting={query.exporting}
        total={query.pagination.total}
        onFetch={handleMergeAction}
        onExport={query.handleExport}
        fetchText="执行手动全量合并"
      />

      {/* 数据表格 */}
      <MergedDrugTable
        drugs={query.drugs}
        pagination={query.pagination}
        loading={query.loading}
        expandedRows={query.expandedRows}
        onToggleRowExpand={query.toggleRowExpand}
        onPageChange={query.handlePageChange}
        formatPrice={query.formatPrice}
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

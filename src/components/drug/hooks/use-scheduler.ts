'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import type { SchedulerConfig } from '../types';

const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  enabled: false,
  intervalMinutes: 60,
  nextRunAt: null,
  lastRunAt: null,
  lastRunStatus: null,
  isRunning: false,
};

export interface UseSchedulerOptions {
  /** 调度器配置接口 */
  schedulerApi: string;
  /** 初始配置（merged 页需带 runningStatus: 'idle'） */
  defaultConfig?: SchedulerConfig;
  /** configLoading 初始值（merged 页初始为 true，避免首屏按钮闪烁） */
  initialLoading?: boolean;
  /** GET 时附加时间戳并禁用缓存（merged 页语义） */
  cacheBust?: boolean;
  /** 更新成功后的行为：merge=合并进 state；reload=toast 后重新拉取 */
  updateMode?: 'merge' | 'reload';
  /** 更新期间是否切换 configLoading（gz/pubonln 页语义） */
  trackUpdateLoading?: boolean;
  /** 更新失败 toast 标题 */
  updateErrorTitle?: string;
  /** 更新网络错误 toast 标题（merged 页与业务失败文案不同） */
  updateNetworkErrorTitle?: string;
  /** 更新网络错误 toast 描述 */
  updateNetworkErrorDescription?: string;
  /**
   * 自动状态探针（merged 页专用）：周期刷新调度器状态，
   * 发现服务端 running 但前端未开启进度轮询时补开轮询
   */
  probe?: {
    /** 服务端 running 时的探测间隔 */
    runningIntervalMs: number;
    /** 空闲时的探测间隔 */
    idleIntervalMs: number;
    /** 前端进度是否已处于 running（避免重复开轮询） */
    isProgressRunning: boolean;
    /** 探测到服务端 running 且前端未轮询时的回调 */
    onRunningDetected: () => void;
  };
}

/**
 * 调度器配置 Hook
 * 封装配置加载、更新与（可选的）自动状态探针
 */
export function useScheduler(options: UseSchedulerOptions) {
  const {
    schedulerApi,
    defaultConfig = DEFAULT_SCHEDULER_CONFIG,
    initialLoading = false,
    cacheBust = false,
    updateMode = 'merge',
    trackUpdateLoading = true,
    updateErrorTitle = '配置更新失败',
    updateNetworkErrorTitle = updateErrorTitle,
    updateNetworkErrorDescription = '网络错误',
    probe,
  } = options;

  const [schedulerConfig, setSchedulerConfig] = useState<SchedulerConfig>(defaultConfig);
  const [configLoading, setConfigLoading] = useState(initialLoading);
  const probeTimerRef = useRef<NodeJS.Timeout | undefined>(undefined);

  /** 加载调度器配置 */
  const loadSchedulerConfig = useCallback(async (isInitial = false) => {
    if (isInitial) setConfigLoading(true);
    try {
      const url = cacheBust ? `${schedulerApi}?_t=${Date.now()}` : schedulerApi;
      const response = await fetch(url, cacheBust ? { cache: 'no-store' } : undefined);
      const result = await response.json();
      if (result.success && result.data) {
        setSchedulerConfig(result.data);
      }
    } catch (error) {
      console.error('加载调度器配置失败:', error);
    } finally {
      if (isInitial) setConfigLoading(false);
    }
  }, [schedulerApi, cacheBust]);

  /** 更新调度器配置 */
  const updateSchedulerConfig = async (updates: { enabled?: boolean; intervalMinutes?: number }) => {
    if (trackUpdateLoading) setConfigLoading(true);
    try {
      const response = await fetch(schedulerApi, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const result = await response.json();

      if (result.success) {
        if (updateMode === 'merge') {
          setSchedulerConfig(prev => ({
            ...prev,
            ...result.data,
          }));
          toast.success(result.message);
        } else {
          toast.success(result.message);
          loadSchedulerConfig();
        }
      } else {
        toast.error(updateErrorTitle, { description: result.message });
      }
    } catch {
      toast.error(updateNetworkErrorTitle, { description: updateNetworkErrorDescription });
    } finally {
      if (trackUpdateLoading) setConfigLoading(false);
    }
  };

  // 自动状态探针（用于响应系统的自动调度触发事件）
  const probeRunning = probe ? schedulerConfig.runningStatus === 'running' : false;
  const probeProgressRunning = probe?.isProgressRunning ?? false;
  const probeOnRunningDetectedRef = useRef(probe?.onRunningDetected);
  useEffect(() => {
    probeOnRunningDetectedRef.current = probe?.onRunningDetected;
  });

  useEffect(() => {
    if (!probe) return;
    const intervalMs = probeRunning ? probe.runningIntervalMs : probe.idleIntervalMs;
    probeTimerRef.current = setInterval(() => {
      // 无论当前状态如何，都先刷新调度器状态，避免 running_status 卡住不更新
      loadSchedulerConfig();

      // 探针如果发现正在 running 但前端没有开启详尽的 progress 轮询，则开启一下
      if (probeRunning && !probeProgressRunning) {
        probeOnRunningDetectedRef.current?.();
      }
    }, intervalMs);

    return () => {
      if (probeTimerRef.current) clearInterval(probeTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probeRunning, probeProgressRunning, loadSchedulerConfig]);

  return {
    schedulerConfig,
    configLoading,
    loadSchedulerConfig,
    updateSchedulerConfig,
  };
}

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { readSessionJson } from './storage';

/** 进度状态机的最小公共形状（FetchProgress / MergeProgress 均满足） */
export interface ProgressLike {
  status: 'idle' | 'running' | 'completed' | 'error';
  startTime: number | null;
  endTime: number | null;
  error: string | null;
}

export interface UseProgressPollingOptions<P extends ProgressLike> {
  /** 进度查询接口（GET 查询 / DELETE 重置） */
  progressApi: string;
  /** sessionStorage 持久化键 */
  storageKey: string;
  /** idle 默认进度（重置用） */
  defaultProgress: P;
  /** 校验并归一化持久化快照，非法时返回 null */
  parsePersisted: (raw: unknown) => P | null;
  /** 轮询间隔，默认 5000ms */
  intervalMs?: number;
  /** completed / error 后进度卡自动隐藏延迟，默认 3000/6000ms */
  hideDelayMs?: { completed: number; error: number };
  /**
   * 每次轮询拿到有效数据后的回调（占位 running 期间的 idle 不触发）
   * prevStatus 为本次应用前客户端记录的状态，用于识别 running→completed 等跃迁
   */
  onTick?: (data: P, prevStatus: P['status']) => void;
  /** 占位 running 期间服务端仍返回 idle 时的回调（如刷新调度器状态） */
  onIdleIgnored?: () => void;
}

/**
 * 进度轮询状态机 Hook
 * 统一封装：轮询定时器、sessionStorage 快照、占位 running 防闪烁、
 * completed/error 延迟隐藏（同步 DELETE 重置服务端进度）
 */
export function useProgressPolling<P extends ProgressLike>(options: UseProgressPollingOptions<P>) {
  const {
    progressApi,
    storageKey,
    defaultProgress,
    parsePersisted,
    intervalMs = 5000,
    hideDelayMs = { completed: 3000, error: 6000 },
  } = options;

  const readPersisted = useCallback((): P | null => {
    return options.parsePersisted(readSessionJson(storageKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const [progress, setProgress] = useState<P>(() => readPersisted() ?? defaultProgress);

  // 进度轮询定时器
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  // 进度卡片自动隐藏定时器（完成/出错后延迟收起）
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null);
  // 跟踪客户端当前的进度状态，供 setInterval 回调里读取最新值
  const statusRef = useRef<P['status']>(progress.status);
  // onTick / onIdleIgnored 通过 ref 引用最新回调，避免轮询定时器因回调变化重建
  const onTickRef = useRef(options.onTick);
  const onIdleIgnoredRef = useRef(options.onIdleIgnored);

  useEffect(() => {
    onTickRef.current = options.onTick;
    onIdleIgnoredRef.current = options.onIdleIgnored;
  });

  /** 更新并持久化进度（idle 时清除快照） */
  const applyProgress = useCallback((next: P) => {
    setProgress(next);
    statusRef.current = next.status;
    if (typeof window === 'undefined') return;
    if (next.status === 'idle') {
      window.sessionStorage.removeItem(storageKey);
      return;
    }
    window.sessionStorage.setItem(storageKey, JSON.stringify(next));
  }, [storageKey]);

  /** 重置进度为 idle（用于完成后自动隐藏卡片） */
  const resetToIdle = useCallback(() => {
    applyProgress(defaultProgress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyProgress]);

  /** 清理进度卡片自动隐藏定时器 */
  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  /** 调度进度卡片在完成后自动隐藏，同步重置服务端进度 */
  const scheduleHide = useCallback((delayMs = 3000) => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      // 重置服务端进度，避免刷新页面后再次看到已完成卡片
      fetch(progressApi, { method: 'DELETE' }).catch(() => {});
      resetToIdle();
    }, delayMs);
  }, [progressApi, clearHideTimer, resetToIdle]);

  /** 停止进度轮询 */
  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  /** 开始进度轮询 */
  const startPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }

    pollingRef.current = setInterval(async () => {
      try {
        const response = await fetch(`${progressApi}?_t=${Date.now()}`, { cache: 'no-store' });
        const data: P = await response.json();

        // 服务端启动有延迟：canStartScrape/setRunningStatus/createScrapeLog 等异步步骤
        // 期间服务端仍是 idle，但客户端点击后已设为 running，此时忽略 idle 避免卡片闪烁
        if (data.status === 'idle' && statusRef.current === 'running') {
          onIdleIgnoredRef.current?.();
          return;
        }

        const prevStatus = statusRef.current;
        applyProgress(data);
        onTickRef.current?.(data, prevStatus);

        if (data.status === 'completed') {
          stopPolling();
          // 完成后延迟自动隐藏进度卡片
          scheduleHide(hideDelayMs.completed);
        }

        if (data.status === 'error') {
          stopPolling();
          // 错误状态下给用户一点时间查看错误信息后再隐藏
          scheduleHide(hideDelayMs.error);
        }
      } catch (e) {
        console.error('获取进度失败:', e);
      }
    }, intervalMs);
  }, [progressApi, applyProgress, stopPolling, scheduleHide, intervalMs, hideDelayMs.completed, hideDelayMs.error]);

  /** 加载当前进度（用于刷新页面后恢复状态） */
  const loadProgress = useCallback(async () => {
    const cached = readPersisted();
    if (cached && cached.status === 'running') {
      applyProgress(cached);
      startPolling();
    }

    try {
      const response = await fetch(`${progressApi}?_t=${Date.now()}`, { cache: 'no-store' });
      const data: P = await response.json();
      // 如果接口暂时回 idle，但本地存在 running 快照，则先保留运行态卡片
      if (data.status === 'idle' && cached?.status === 'running') {
        return;
      }
      applyProgress(data);

      // 刷新页面后若任务还在运行，自动恢复轮询
      if (data.status === 'running') {
        startPolling();
      }
      // 刷新页面时若服务端是已完成/出错的残留状态，稍后自动隐藏
      if (data.status === 'completed') {
        scheduleHide(hideDelayMs.completed);
      } else if (data.status === 'error') {
        scheduleHide(hideDelayMs.error);
      }
    } catch (e) {
      console.error('加载当前进度失败:', e);
    }
  }, [progressApi, applyProgress, readPersisted, startPolling, scheduleHide, hideDelayMs.completed, hideDelayMs.error]);

  /** 格式化耗时 */
  const formatDuration = () => {
    if (!progress.startTime) return '-';
    const endTime = progress.endTime || Date.now();
    const seconds = Math.floor((endTime - progress.startTime) / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}分${remainingSeconds}秒`;
  };

  // 清理定时器
  useEffect(() => {
    return () => {
      stopPolling();
      clearHideTimer();
    };
  }, [stopPolling, clearHideTimer]);

  return {
    progress,
    applyProgress,
    resetToIdle,
    startPolling,
    stopPolling,
    loadProgress,
    scheduleHide,
    clearHideTimer,
    formatDuration,
  };
}

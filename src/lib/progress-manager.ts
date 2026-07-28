/**
 * 抓取进度管理模块
 * 进度状态经 createProgressStore 存于 globalThis（键名 __fetchProgressStore__ 保持不变），
 * 避免 Next.js dev 热重载或路由 handler 被独立加载时 POST/GET 读写到不同模块实例导致状态不同步
 */

import { createProgressStore } from './shared/progress-store';

export interface FetchProgress {
  status: 'idle' | 'running' | 'completed' | 'error';
  currentPage: number;
  totalPages: number;
  processedCount: number;
  totalCount: number;
  newCount: number;
  updateCount: number;
  startTime: number | null;
  endTime: number | null;
  error: string | null;
}

export type ProgressSource = 'gz_drug' | 'gd_pubonln';

function createIdleProgress(): FetchProgress {
  return {
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
}

type ProgressStore = Record<ProgressSource, FetchProgress>;

const store = createProgressStore<ProgressStore>('__fetchProgressStore__', () => ({
  gz_drug: createIdleProgress(),
  gd_pubonln: createIdleProgress(),
}));

/**
 * 获取当前进度
 */
export function getProgress(source: ProgressSource): FetchProgress {
  return { ...store.ref()[source] };
}

/**
 * 更新进度
 */
export function updateProgress(source: ProgressSource, updates: Partial<FetchProgress>): void {
  const current = store.ref();
  current[source] = { ...current[source], ...updates };
}

/**
 * 开始抓取
 */
export function startProgress(source: ProgressSource, totalPages: number): void {
  store.ref()[source] = {
    status: 'running',
    currentPage: 0,
    totalPages,
    processedCount: 0,
    totalCount: 0,
    newCount: 0,
    updateCount: 0,
    startTime: Date.now(),
    endTime: null,
    error: null,
  };
}

/**
 * 完成抓取
 */
export function completeProgress(source: ProgressSource): void {
  const current = store.ref();
  current[source].status = 'completed';
  current[source].endTime = Date.now();
}

/**
 * 设置错误
 */
export function setErrorProgress(source: ProgressSource, error: string): void {
  const current = store.ref();
  current[source].status = 'error';
  current[source].error = error;
  current[source].endTime = Date.now();
}

/**
 * 重置进度
 */
export function resetProgress(source: ProgressSource): void {
  store.ref()[source] = createIdleProgress();
}

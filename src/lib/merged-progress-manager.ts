/**
 * 整合药品数据同步进度管理器
 * 独立于 GD/GZ 两个模块的进度状态，避免互相干扰
 * 使用内存存储，支持前端 1 秒轮询获取进度
 */

/** 合并同步进度状态 */
export interface MergeProgress {
  /** 任务状态 */
  status: 'idle' | 'running' | 'completed' | 'error';
  /** 当前处理阶段描述 */
  phase: string;
  /** 广东医保已加载条数 */
  gdLoaded: number;
  /** 广州采购平台已加载条数 */
  gzLoaded: number;
  /** 合并去重后总条数 */
  mergedTotal: number;
  /** 已写入新表条数 */
  savedCount: number;
  /** 任务开始时间（ms 时间戳） */
  startTime: number | null;
  /** 任务结束时间（ms 时间戳） */
  endTime: number | null;
  /** 错误信息 */
  error: string | null;
}

const createIdleMergeProgress = (): MergeProgress => ({
  status: 'idle',
  phase: '',
  gdLoaded: 0,
  gzLoaded: 0,
  mergedTotal: 0,
  savedCount: 0,
  startTime: null,
  endTime: null,
  error: null,
});

declare global {
  // eslint-disable-next-line no-var
  var __mergedProgressState__: MergeProgress | undefined;
}

// 使用 globalThis 保存，避免 Next.js dev 热重载导致模块内变量重置
const globalStore = globalThis as typeof globalThis & {
  __mergedProgressState__?: MergeProgress;
};

function getCurrentMergeProgressRef(): MergeProgress {
  if (!globalStore.__mergedProgressState__) {
    globalStore.__mergedProgressState__ = createIdleMergeProgress();
  }
  return globalStore.__mergedProgressState__;
}

function setCurrentMergeProgress(next: MergeProgress): void {
  globalStore.__mergedProgressState__ = next;
}

// ─── 公共 API ────────────────────────────────────────────────────

/**
 * 获取当前合并同步进度（返回副本，防止外部修改）
 */
export function getMergeProgress(): MergeProgress {
  return { ...getCurrentMergeProgressRef() };
}

/**
 * 更新合并进度（部分字段）
 */
export function updateMergeProgress(updates: Partial<MergeProgress>): void {
  const current = getCurrentMergeProgressRef();
  setCurrentMergeProgress({ ...current, ...updates });
}

/**
 * 开始合并任务，重置所有计数
 */
export function startMergeProgress(): void {
  setCurrentMergeProgress({
    status: 'running',
    phase: '正在准备数据...',
    gdLoaded: 0,
    gzLoaded: 0,
    mergedTotal: 0,
    savedCount: 0,
    startTime: Date.now(),
    endTime: null,
    error: null,
  });
}

/**
 * 标记合并任务完成
 */
export function completeMergeProgress(): void {
  const current = getCurrentMergeProgressRef();
  setCurrentMergeProgress({
    ...current,
    status: 'completed',
    phase: '合并完成',
    endTime: Date.now(),
  });
}

/**
 * 标记合并任务失败
 */
export function setMergeProgressError(error: string): void {
  const current = getCurrentMergeProgressRef();
  setCurrentMergeProgress({
    ...current,
    status: 'error',
    phase: '合并失败',
    error,
    endTime: Date.now(),
  });
}

/**
 * 重置进度为初始 idle 状态
 */
export function resetMergeProgress(): void {
  setCurrentMergeProgress(createIdleMergeProgress());
}

/**
 * 判断当前是否正在运行（防止重复触发）
 */
export function isMergingRunning(): boolean {
  return getCurrentMergeProgressRef().status === 'running';
}

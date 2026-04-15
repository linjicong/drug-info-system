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

// ─── 全局进度状态（单例，进程内共享） ──────────────────────────────

let currentMergeProgress: MergeProgress = {
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

// ─── 公共 API ────────────────────────────────────────────────────

/**
 * 获取当前合并同步进度（返回副本，防止外部修改）
 */
export function getMergeProgress(): MergeProgress {
  return { ...currentMergeProgress };
}

/**
 * 更新合并进度（部分字段）
 */
export function updateMergeProgress(updates: Partial<MergeProgress>): void {
  currentMergeProgress = { ...currentMergeProgress, ...updates };
}

/**
 * 开始合并任务，重置所有计数
 */
export function startMergeProgress(): void {
  currentMergeProgress = {
    status: 'running',
    phase: '正在准备数据...',
    gdLoaded: 0,
    gzLoaded: 0,
    mergedTotal: 0,
    savedCount: 0,
    startTime: Date.now(),
    endTime: null,
    error: null,
  };
}

/**
 * 标记合并任务完成
 */
export function completeMergeProgress(): void {
  currentMergeProgress.status = 'completed';
  currentMergeProgress.phase = '合并完成';
  currentMergeProgress.endTime = Date.now();
}

/**
 * 标记合并任务失败
 */
export function setMergeProgressError(error: string): void {
  currentMergeProgress.status = 'error';
  currentMergeProgress.phase = '合并失败';
  currentMergeProgress.error = error;
  currentMergeProgress.endTime = Date.now();
}

/**
 * 重置进度为初始 idle 状态
 */
export function resetMergeProgress(): void {
  currentMergeProgress = {
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
}

/**
 * 判断当前是否正在运行（防止重复触发）
 */
export function isMergingRunning(): boolean {
  return currentMergeProgress.status === 'running';
}

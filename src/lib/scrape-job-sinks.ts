/**
 * 抓取任务进度汇（DB sink）共享模块
 *
 * 进度补丁先合并进 job 级累加器，节流后整体快照写 task_progress
 * （避免部分补丁覆盖旧字段）。供 GitHub Actions runner（scripts/scrape-runner.ts）
 * 与桌面版进程内 local runner（src/lib/local-runner.ts）共用。
 */
import { upsertTaskProgress, type TaskProgressPatch } from './task-progress-repo';
import type { FetchProgressPatch, MergeProgressPatch, LedgerProgressPatch } from './progress-patch';
import type { DataSource, ScrapeJobSinks } from './unified-scheduler';

/** 进度写库节流：非终态补丁最快 2s 一次，终态（completed/error）立即写 */
const THROTTLE_MS = 2000;

/** 毫秒时间戳 → Date；null 保留（清空语义）；undefined 表示补丁未提供该字段 */
export function toDate(value: unknown): Date | null | undefined {
  if (typeof value === 'number') return new Date(value);
  if (value === null) return null;
  return undefined;
}

/**
 * 创建写 task_progress 的进度汇：
 * 补丁先合并进 job 级累加器，节流后整体快照写库（避免部分补丁覆盖旧字段）。
 * 返回 emit（补丁入口）与 drain（任务结束后等待全部写入落库，避免进程退出截断终态写）
 */
export function createDbSink<TPatch extends object>(
  source: DataSource,
  toTaskPatch: (acc: Record<string, unknown>) => TaskProgressPatch
): { emit: (patch: TPatch) => void; drain: () => Promise<void> } {
  const acc: Record<string, unknown> = {};
  let lastWriteAt = 0;
  let pending: NodeJS.Timeout | null = null;
  let chain: Promise<void> = Promise.resolve();

  const write = () => {
    lastWriteAt = Date.now();
    const snapshot = toTaskPatch({ ...acc });
    chain = chain
      .then(() => upsertTaskProgress(source, snapshot))
      .catch(error => console.error(`[ScrapeSinks] 进度写库失败 (${source}):`, error));
  };

  const emit = (patch: TPatch) => {
    Object.assign(acc, patch);

    const status = (patch as { status?: string }).status;
    const terminal = status === 'completed' || status === 'error';
    if (terminal) {
      if (pending) {
        clearTimeout(pending);
        pending = null;
      }
      write();
      return;
    }

    const elapsed = Date.now() - lastWriteAt;
    if (elapsed >= THROTTLE_MS) {
      write();
    } else if (!pending) {
      pending = setTimeout(() => {
        pending = null;
        write();
      }, THROTTLE_MS - elapsed);
      pending.unref?.();
    }
  };

  /** 刷出未到期节流快照并等待写入链全部落库 */
  const drain = async () => {
    if (pending) {
      clearTimeout(pending);
      pending = null;
      write();
    }
    await chain;
  };

  return { emit, drain };
}

/** FetchProgressPatch → task_progress 补丁（counters 存抓取计数器快照） */
export function fetchToTaskPatch(acc: Record<string, unknown>): TaskProgressPatch {
  return {
    status: acc.status as TaskProgressPatch['status'],
    counters: {
      currentPage: acc.currentPage,
      totalPages: acc.totalPages,
      processedCount: acc.processedCount,
      totalCount: acc.totalCount,
      newCount: acc.newCount,
      updateCount: acc.updateCount,
    },
    startTime: toDate(acc.startTime),
    endTime: toDate(acc.endTime),
    error: 'error' in acc ? (acc.error as string | null) : undefined,
  };
}

/** MergeProgressPatch → task_progress 补丁（phase 存阶段文案） */
export function mergeToTaskPatch(acc: Record<string, unknown>): TaskProgressPatch {
  return {
    status: acc.status as TaskProgressPatch['status'],
    phase: acc.phase as string | undefined,
    counters: {
      gdLoaded: acc.gdLoaded,
      gzLoaded: acc.gzLoaded,
      mergedTotal: acc.mergedTotal,
      savedCount: acc.savedCount,
    },
    startTime: toDate(acc.startTime),
    endTime: toDate(acc.endTime),
    error: 'error' in acc ? (acc.error as string | null) : undefined,
  };
}

/** LedgerProgressPatch → task_progress 补丁 */
export function ledgerToTaskPatch(acc: Record<string, unknown>): TaskProgressPatch {
  return {
    status: acc.status as TaskProgressPatch['status'],
    counters: { tracked: acc.tracked, done: acc.done },
    startTime: toDate(acc.startTime),
    endTime: toDate(acc.endTime),
    error: 'error' in acc ? (acc.error as string | null) : undefined,
  };
}

/** 按源构造对应的 DB 进度汇（同时返回 drain，供任务结束后等待写入落库） */
export function buildSinks(source: DataSource): { sinks: ScrapeJobSinks; drain: () => Promise<void> } {
  if (source === 'gz_drug' || source === 'gd_pubonln') {
    const { emit, drain } = createDbSink<FetchProgressPatch>(source, fetchToTaskPatch);
    return { sinks: { fetch: emit }, drain };
  }
  if (source === 'merged_drug') {
    const { emit, drain } = createDbSink<MergeProgressPatch>(source, mergeToTaskPatch);
    return { sinks: { merge: emit }, drain };
  }
  const { emit, drain } = createDbSink<LedgerProgressPatch>(source, ledgerToTaskPatch);
  return { sinks: { ledger: emit }, drain };
}

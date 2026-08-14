/**
 * task_progress 表仓储层（跨进程任务进度的读写入口）
 *
 * 写方：GitHub Actions runner（scripts/scrape-runner.ts，节流后调用 upsertTaskProgress）
 * 读方：Vercel API 进度轮询接口（fetchProgressFromDb / mergeProgressFromDb）
 *
 * 替代原 globalThis 内存 store：serverless 实例在响应返回后冻结且多实例不共享内存，
 * 进度必须落到数据库才能被轮询接口看见。
 */

import { db } from '@/storage/database/db';
import { taskProgress } from '@/storage/database/shared/schema';
import { eq } from 'drizzle-orm';
import { withDbRetry } from './shared/db-retry';
import type { FetchProgress } from './progress-manager';
import type { MergeProgress } from './merged-progress-manager';

export type TaskProgressSource = 'gz_drug' | 'gd_pubonln' | 'merged_drug' | 'ledger';
export type TaskProgressStatus = 'idle' | 'running' | 'completed' | 'error';

/** running 但心跳（updated_at）超过该阈值视为执行进程已失联，读取方降级为 error */
const STALE_PROGRESS_MS = 5 * 60 * 1000;

/** 心跳丢失时的降级错误文案（展示给前端进度卡片） */
export const HEARTBEAT_LOST_MESSAGE = '执行进程心跳丢失，任务可能已中断';

/** upsert 时的部分字段补丁（未提供的字段不覆盖现值） */
export interface TaskProgressPatch {
  status?: TaskProgressStatus;
  phase?: string;
  /** 计数器快照，按源区分结构（见 design §3.1），序列化为 JSON 存储 */
  counters?: Record<string, unknown>;
  startTime?: Date | null;
  endTime?: Date | null;
  error?: string | null;
}

/** 解析后的通用进度行（时间已转毫秒时间戳） */
export interface TaskProgressRow {
  source: TaskProgressSource;
  status: TaskProgressStatus;
  phase: string | null;
  counters: Record<string, unknown> | null;
  startTime: number | null;
  endTime: number | null;
  error: string | null;
  updatedAt: number;
}

/** datetime 列（驱动返回 Date 或字符串）→ 毫秒时间戳 */
function toMillis(value: unknown): number | null {
  if (value == null) return null;
  const ts = value instanceof Date ? value.getTime() : new Date(value as string).getTime();
  return Number.isFinite(ts) ? ts : null;
}

/**
 * 插入或更新进度行（source 为主键，ON DUPLICATE KEY UPDATE 语义）。
 * 每次调用都刷新 updated_at 作为心跳。
 */
export async function upsertTaskProgress(
  source: TaskProgressSource,
  patch: TaskProgressPatch
): Promise<void> {
  const now = new Date();

  const values: Record<string, unknown> = {
    source,
    status: patch.status ?? 'running',
    updated_at: now,
  };
  if (patch.phase !== undefined) values.phase = patch.phase;
  if (patch.counters !== undefined) values.counters = JSON.stringify(patch.counters);
  if (patch.startTime !== undefined) values.start_time = patch.startTime;
  if (patch.endTime !== undefined) values.end_time = patch.endTime;
  if (patch.error !== undefined) values.error = patch.error;

  // ON DUPLICATE KEY UPDATE 只覆盖本次补丁提供的字段 + 心跳
  const updateSet: Record<string, unknown> = { updated_at: now };
  for (const key of ['status', 'phase', 'counters', 'start_time', 'end_time', 'error']) {
    if (key in values) updateSet[key] = values[key];
  }

  await withDbRetry(
    () =>
      db
        .insert(taskProgress)
        .values(values as never)
        .onDuplicateKeyUpdate({ set: updateSet as never }),
    3,
    `TaskProgress/${source} upsert`
  );
}

/** 读取原始进度行；无记录返回 null */
export async function getTaskProgressRow(
  source: TaskProgressSource
): Promise<TaskProgressRow | null> {
  const rows = await db
    .select()
    .from(taskProgress)
    .where(eq(taskProgress.source, source))
    .limit(1);

  const row = rows[0] as
    | {
        source: string;
        status: string;
        phase: string | null;
        counters: string | null;
        start_time: unknown;
        end_time: unknown;
        error: string | null;
        updated_at: unknown;
      }
    | undefined;
  if (!row) return null;

  let counters: Record<string, unknown> | null = null;
  if (row.counters) {
    try {
      counters = JSON.parse(row.counters) as Record<string, unknown>;
    } catch {
      counters = null;
    }
  }

  return {
    source: row.source as TaskProgressSource,
    status: row.status as TaskProgressStatus,
    phase: row.phase,
    counters,
    startTime: toMillis(row.start_time),
    endTime: toMillis(row.end_time),
    error: row.error,
    updatedAt: toMillis(row.updated_at) ?? 0,
  };
}

/** 重置进度（删除行，读取方回到 idle 默认值） */
export async function resetTaskProgress(source: TaskProgressSource): Promise<void> {
  await db.delete(taskProgress).where(eq(taskProgress.source, source));
}

// ─── 面向 API 响应契约的映射 ────────────────────────────────────────

function idleFetchProgress(): FetchProgress {
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

function idleMergeProgress(): MergeProgress {
  return {
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

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** 心跳丢失判定：running 且 updated_at 超过阈值 → 降级 error */
function degradedIfStale<T extends { status: TaskProgressStatus; error: string | null }>(
  row: TaskProgressRow,
  progress: T
): T {
  if (row.status === 'running' && Date.now() - row.updatedAt > STALE_PROGRESS_MS) {
    return { ...progress, status: 'error', error: HEARTBEAT_LOST_MESSAGE, endTime: row.updatedAt };
  }
  return progress;
}

/** 读取 gz/pubonln 抓取进度（FetchProgress 契约，逐字段与原内存版一致） */
export async function fetchProgressFromDb(
  source: 'gz_drug' | 'gd_pubonln'
): Promise<FetchProgress> {
  const row = await getTaskProgressRow(source);
  if (!row) return idleFetchProgress();

  const c = row.counters ?? {};
  return degradedIfStale(row, {
    status: row.status,
    currentPage: num(c.currentPage),
    totalPages: num(c.totalPages),
    processedCount: num(c.processedCount),
    totalCount: num(c.totalCount),
    newCount: num(c.newCount),
    updateCount: num(c.updateCount),
    startTime: row.startTime,
    endTime: row.endTime,
    error: row.error,
  });
}

/** 读取 merged 合并进度（MergeProgress 契约，逐字段与原内存版一致） */
export async function mergeProgressFromDb(): Promise<MergeProgress> {
  const row = await getTaskProgressRow('merged_drug');
  if (!row) return idleMergeProgress();

  const c = row.counters ?? {};
  return degradedIfStale(row, {
    status: row.status,
    phase: row.phase ?? '',
    gdLoaded: num(c.gdLoaded),
    gzLoaded: num(c.gzLoaded),
    mergedTotal: num(c.mergedTotal),
    savedCount: num(c.savedCount),
    startTime: row.startTime,
    endTime: row.endTime,
    error: row.error,
  });
}

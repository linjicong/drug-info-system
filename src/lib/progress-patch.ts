/**
 * 任务进度补丁类型定义
 *
 * 业务函数（scraper / 合并 / 台账）通过 onProgress 回调吐出"部分字段补丁"，
 * 由执行侧选择写入目标：内存 store（过渡期兼容）或 task_progress 表（Actions runner）。
 * 补丁的合并语义由接收方负责（内存版合并进 store，DB 版合并进 job 级累加器）。
 */

import type { FetchProgress } from './progress-manager';
import type { MergeProgress } from './merged-progress-manager';

/** gz/pubonln 抓取进度补丁（FetchProgress 部分字段） */
export type FetchProgressPatch = Partial<FetchProgress>;

/** merged 合并进度补丁（MergeProgress 部分字段） */
export type MergeProgressPatch = Partial<MergeProgress>;

/** ledger 台账快照进度补丁 */
export interface LedgerProgressPatch {
  status?: 'running' | 'completed' | 'error';
  tracked?: number;
  done?: number;
  error?: string | null;
  startTime?: number | null;
  endTime?: number | null;
}

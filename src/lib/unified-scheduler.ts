/**
 * 统一的调度器管理模块
 * 支持多数据源，防止重复抓取，记录抓取日志
 */

import { db } from '@/storage/database/db';
import {
  schedulerConfig,
  scrapeLog,
  drugInfoGz,
  drugInfoGd,
  drugInfoMerged,
} from '@/storage/database/shared/schema';
import { eq, desc, and, lt, asc } from 'drizzle-orm';
import { scrapeDrugInfo } from './drug-scraper';
import { scrapePubonlnDrugInfo } from './pubonln-scraper';

import { syncMergedDrugData } from './merged-drug-service';
import { executeLedgerSnapshot } from './ledger-service';
import { resetTaskProgress } from './task-progress-repo';
import type { FetchProgressPatch, MergeProgressPatch, LedgerProgressPatch } from './progress-patch';

// 数据源类型
export type DataSource = 'gz_drug' | 'gd_pubonln' | 'merged_drug' | 'ledger';

// 调度器配置接口
export interface UnifiedSchedulerConfig {
  id: number;
  source: DataSource;
  enabled: boolean;
  interval_minutes: number;
  next_run_at: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
  running_status: 'idle' | 'running';
  updated_at: string;
  cron_secret: string | null;
}

// 抓取日志接口
export interface ScrapeLog {
  id: number;
  source: DataSource;
  scrape_type: 'manual' | 'scheduled';
  status: 'queued' | 'running' | 'success' | 'failed';
  start_time: string;
  end_time: string | null;
  duration_seconds: number | null;
  total_count: number;
  new_count: number;
  update_count: number;
  error_message: string | null;
}

// 调度器间隔存储已被移除，由外部 Cron API 触发

/**
 * 获取调度器配置
 */
export async function getUnifiedSchedulerConfig(source: DataSource): Promise<UnifiedSchedulerConfig | null> {
  try {
    const rows = await db
      .select()
      .from(schedulerConfig)
      .where(eq(schedulerConfig.source, source))
      .limit(1);

    if (rows.length > 0) {
      return rows[0] as unknown as UnifiedSchedulerConfig;
    }

    // 没有记录，创建默认配置。优先复用环境变量 CRON_SECRET（与 Vercel Cron 鉴权一致），否则生成密码学安全随机值
    const cronSecret = process.env.CRON_SECRET || crypto.randomUUID();
    const insertResult = await db.insert(schedulerConfig).values({
      source,
      enabled: false,
      interval_minutes: 60,
      running_status: 'idle',
      cron_secret: cronSecret,
    });

    // MySQL 不支持 RETURNING，按自增 lastInsertId 回查
    const newConfigId = Number((insertResult as unknown as { lastInsertId: number | string | null }).lastInsertId ?? 0);
    if (!newConfigId) return null;
    const newRows = await db
      .select()
      .from(schedulerConfig)
      .where(eq(schedulerConfig.id, newConfigId))
      .limit(1);

    return (newRows[0] as unknown as UnifiedSchedulerConfig) ?? null;
  } catch (error) {
    console.error(`[UnifiedScheduler] 获取配置失败 (${source}):`, error);
    return null;
  }
}

/**
 * 更新调度器配置
 */
export async function updateUnifiedSchedulerConfig(
  source: DataSource,
  config: { enabled?: boolean; interval_minutes?: number; cron_secret?: string }
): Promise<UnifiedSchedulerConfig | null> {
  try {
    const currentConfig = await getUnifiedSchedulerConfig(source);
    if (!currentConfig) {
      throw new Error('无法获取配置');
    }

    const updateData: Record<string, unknown> = {
      // datetime 列（date 模式）必须传 Date 对象：drizzle 驱动层会调 value.toISOString()，
      // 传 ISO 字符串会直接抛错导致整条 update 失败
      updated_at: new Date(),
    };

    if (config.enabled !== undefined) {
      updateData.enabled = config.enabled;
    }
    if (config.interval_minutes !== undefined) {
      updateData.interval_minutes = config.interval_minutes;
    }
    if (config.cron_secret !== undefined) {
      updateData.cron_secret = config.cron_secret;
    }

    // 计算下次执行时间
    if (config.enabled === true) {
      const intervalMinutes = config.interval_minutes || currentConfig.interval_minutes;
      updateData.next_run_at = new Date(
        Date.now() + intervalMinutes * 60 * 1000
      );
    } else if (config.enabled === false) {
      updateData.next_run_at = null;
    }

    await db
      .update(schedulerConfig)
      .set(updateData)
      .where(eq(schedulerConfig.id, currentConfig.id));

    // 已移除对 restartUnifiedScheduler 的调用，依靠外部 Cron 定期拉取最新状态
    // MySQL 不支持 RETURNING，回查更新后的配置
    const updatedRows = await db
      .select()
      .from(schedulerConfig)
      .where(eq(schedulerConfig.id, currentConfig.id))
      .limit(1);

    return (updatedRows[0] as unknown as UnifiedSchedulerConfig) ?? null;
  } catch (error) {
    console.error(`[UnifiedScheduler] 更新配置失败 (${source}):`, error);
    throw error;
  }
}

/**
 * 僵尸运行状态判定阈值：running 且 updated_at 距今超过此时长视为残留
 * （进程崩溃/实例回收导致 setRunningStatus('idle') 未执行），
 * 自动复位后放行新抓取。阈值须大于最长单次抓取时长（当前约 10~20 分钟）
 */
export const STALE_RUNNING_TIMEOUT_MS = 30 * 60 * 1000;

/** 心跳间隔：执行中每 60s 刷新 scheduler_config.updated_at，证明自己仍存活 */
const HEARTBEAT_INTERVAL_MS = 60 * 1000;

/**
 * 归一化 update 结果的影响行数：
 * HTTP 驱动（Vercel / Actions 内 serverless 模式）返回 FullResult，字段为 rowsAffected；
 * Node mysql2 回退模式返回 [ResultSetHeader, ...]，字段为 affectedRows
 */
function getAffectedRows(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  const candidate = header as { rowsAffected?: number | string; affectedRows?: number | string } | undefined;
  return Number(candidate?.rowsAffected ?? candidate?.affectedRows ?? 0);
}

/**
 * 检查是否可以开始抓取（防止重复抓取）
 */
export async function canStartScrape(source: DataSource): Promise<{ canStart: boolean; reason: string }> {
  const config = await getUnifiedSchedulerConfig(source);

  if (!config) {
    return { canStart: false, reason: '无法获取配置' };
  }

  if (config.running_status === 'running') {
    // setRunningStatus 每次都会刷新 updated_at，抓取中途不再更新；
    // 超过阈值说明上次任务异常终止未复位，自动自愈避免永久 409
    const updatedAt = new Date(config.updated_at as unknown as string).getTime();
    if (Number.isFinite(updatedAt) && Date.now() - updatedAt > STALE_RUNNING_TIMEOUT_MS) {
      console.warn(`[UnifiedScheduler] 检测到僵尸运行状态 (${source})，自动复位为 idle`);
      await setRunningStatus(source, 'idle');
      return { canStart: true, reason: '' };
    }
    return { canStart: false, reason: '已有抓取任务正在运行中' };
  }

  return { canStart: true, reason: '' };
}

/**
 * 设置运行状态
 */
export async function setRunningStatus(
  source: DataSource,
  status: 'idle' | 'running'
): Promise<void> {
  const config = await getUnifiedSchedulerConfig(source);
  if (!config) return;

  await db
    .update(schedulerConfig)
    .set({
      running_status: status,
      updated_at: new Date(),
    })
    .where(eq(schedulerConfig.id, config.id));
}

/**
 * 抓取任务结束时统一更新 config 表的"上次执行时间/状态/下次执行时间"
 * 手动触发和定时任务都调用它，确保前端 scheduler 接口里的 lastRunAt/nextRunAt 与
 * scrape_log 最新一条始终一致，不会停留在前一次定时任务的时间。
 */
export async function finalizeScrapeRun(
  source: DataSource,
  status: 'success' | 'failed'
): Promise<void> {
  const config = await getUnifiedSchedulerConfig(source);
  if (!config) return;

  // datetime 列必须写 Date 对象（同 updateUnifiedSchedulerConfig 的说明）
  const now = new Date();
  const updateData: Record<string, unknown> = {
    last_run_at: now,
    last_run_status: status,
    updated_at: now,
  };

  // 启用状态下顺便推进 next_run_at，避免外部 Cron 触发时间一直停留在过去的时刻
  if (config.enabled) {
    updateData.next_run_at = new Date(
      Date.now() + config.interval_minutes * 60 * 1000
    );
  }

  await db
    .update(schedulerConfig)
    .set(updateData)
    .where(eq(schedulerConfig.id, config.id));
}

/**
 * 创建抓取日志
 *
 * @param status 初始状态：queued 为入队待执行（runner 认领后改 running），running 为立即执行
 */
export async function createScrapeLog(
  source: DataSource,
  scrapeType: 'manual' | 'scheduled',
  status: 'queued' | 'running' = 'running'
): Promise<number | null> {
  try {
    const insertResult = await db.insert(scrapeLog).values({
      source,
      scrape_type: scrapeType,
      status,
      start_time: new Date(),
    });

    // MySQL 不支持 RETURNING，使用自增 lastInsertId
    const logId = Number((insertResult as unknown as { lastInsertId: number | string | null }).lastInsertId ?? 0);
    return logId || null;
  } catch (error) {
    console.error(`[UnifiedScheduler] 创建日志失败:`, error);
    return null;
  }
}

/**
 * 更新抓取日志
 */
export async function updateScrapeLog(
  logId: number,
  data: {
    status: 'success' | 'failed';
    total_count?: number;
    new_count?: number;
    update_count?: number;
    error_message?: string;
  }
): Promise<void> {
  // 获取开始时间计算耗时
  const logRows = await db
    .select({ start_time: scrapeLog.start_time })
    .from(scrapeLog)
    .where(eq(scrapeLog.id, logId))
    .limit(1);

  const log = logRows[0];
  const endTime = new Date();
  const durationSeconds = log?.start_time
    ? Math.floor((endTime.getTime() - new Date(log.start_time as unknown as string).getTime()) / 1000)
    : null;

  await db
    .update(scrapeLog)
    .set({
      ...data,
      end_time: endTime,
      duration_seconds: durationSeconds,
    })
    .where(eq(scrapeLog.id, logId));
}

/**
 * 获取最新抓取日志
 */
export async function getLatestScrapeLog(source: DataSource): Promise<ScrapeLog | null> {
  try {
    const rows = await db
      .select()
      .from(scrapeLog)
      .where(eq(scrapeLog.source, source))
      .orderBy(desc(scrapeLog.start_time))
      .limit(1);

    return (rows[0] as unknown as ScrapeLog) ?? null;
  } catch {
    return null;
  }
}

/**
 * 获取抓取日志列表
 */
export async function getScrapeLogs(
  source: DataSource,
  limit: number = 10
): Promise<ScrapeLog[]> {
  try {
    const rows = await db
      .select()
      .from(scrapeLog)
      .where(eq(scrapeLog.source, source))
      .orderBy(desc(scrapeLog.start_time))
      .limit(limit);

    return rows as unknown as ScrapeLog[];
  } catch {
    return [];
  }
}

/**
 * 获取最新数据时间
 */
export async function getLatestDataTime(source: DataSource): Promise<string | null> {
  try {
    if (source === 'gz_drug') {
      const rows = await db
        .select({ created_at: drugInfoGz.created_at })
        .from(drugInfoGz)
        .orderBy(desc(drugInfoGz.created_at))
        .limit(1);
      return (rows[0]?.created_at as unknown as string) ?? null;
    }

    if (source === 'gd_pubonln') {
      const rows = await db
        .select({ created_at: drugInfoGd.created_at })
        .from(drugInfoGd)
        .orderBy(desc(drugInfoGd.created_at))
        .limit(1);
      return (rows[0]?.created_at as unknown as string) ?? null;
    }

    if (source === 'merged_drug') {
      const rows = await db
        .select({ synced_at: drugInfoMerged.synced_at })
        .from(drugInfoMerged)
        .orderBy(desc(drugInfoMerged.synced_at))
        .limit(1);
      return (rows[0]?.synced_at as unknown as string) ?? null;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * 僵尸清扫：running 且 updated_at 超过阈值的配置置回 idle，
 * 并把该 source 下 status='running' 的残留日志标为 failed。
 * 返回清扫到的僵尸数（0 表示无残留）
 */
export async function sweepStaleRunning(source: DataSource): Promise<number> {
  const staleBefore = new Date(Date.now() - STALE_RUNNING_TIMEOUT_MS);

  const result = await db
    .update(schedulerConfig)
    .set({ running_status: 'idle', updated_at: new Date() })
    .where(and(
      eq(schedulerConfig.source, source),
      eq(schedulerConfig.running_status, 'running'),
      lt(schedulerConfig.updated_at, staleBefore)
    ));

  const swept = getAffectedRows(result);
  if (swept > 0) {
    console.warn(`[UnifiedScheduler] 清扫僵尸运行状态 (${source})，复位为 idle`);
    // 残留的 running 日志永远不会有进程来收尾，直接标 failed 闭环
    await db
      .update(scrapeLog)
      .set({
        status: 'failed',
        end_time: new Date(),
        error_message: '进程异常终止，任务被僵尸清扫标记为失败',
      })
      .where(and(eq(scrapeLog.source, source), eq(scrapeLog.status, 'running')));
    // 同步复位进度行，避免前端一直看到降级前的 running 残留
    await resetTaskProgress(source);
  }
  return swept;
}

/**
 * CAS 认领数据源锁：仅当当前为 idle 时才置 running，
 * affectedRows=1 才算认领成功（多 runner 并发时天然互斥）
 */
export async function claimSourceLock(source: DataSource): Promise<boolean> {
  // 确保配置行存在（首次访问时自动创建默认配置）
  await getUnifiedSchedulerConfig(source);

  const result = await db
    .update(schedulerConfig)
    .set({ running_status: 'running', updated_at: new Date() })
    .where(and(
      eq(schedulerConfig.source, source),
      eq(schedulerConfig.running_status, 'idle')
    ));

  return getAffectedRows(result) === 1;
}

/**
 * 认领最早一条 queued 日志：改为 running 并返回，无 queued 时返回 null
 */
export async function claimQueuedLog(
  source: DataSource
): Promise<{ logId: number; scrapeType: 'manual' | 'scheduled' } | null> {
  const rows = await db
    .select({ id: scrapeLog.id, scrape_type: scrapeLog.scrape_type })
    .from(scrapeLog)
    .where(and(eq(scrapeLog.source, source), eq(scrapeLog.status, 'queued')))
    .orderBy(asc(scrapeLog.start_time))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  await db
    .update(scrapeLog)
    .set({ status: 'running' })
    .where(and(eq(scrapeLog.id, row.id), eq(scrapeLog.status, 'queued')));

  return { logId: row.id, scrapeType: row.scrape_type as 'manual' | 'scheduled' };
}

/** 各源进度补丁汇编写写器（runScrapeJob 按源取用） */
export interface ScrapeJobSinks {
  /** gz_drug / gd_pubonln 抓取进度 */
  fetch?: (patch: FetchProgressPatch) => void;
  /** merged_drug 合并进度 */
  merge?: (patch: MergeProgressPatch) => void;
  /** ledger 台账快照进度 */
  ledger?: (patch: LedgerProgressPatch) => void;
}

/**
 * 抓取任务共享生命周期：心跳 + 执行 + 日志回写 + finalize + finally 释放锁。
 * 认领（CAS）与日志创建由调用方完成，本函数只负责执行期生命周期。
 * 不传 sinks 时业务函数回退写内存进度 store（过渡期兼容）
 */
export async function runScrapeJob(
  source: DataSource,
  logId: number | null,
  sinks?: ScrapeJobSinks
): Promise<void> {
  // 心跳：定期刷新 updated_at，避免长任务被误判为僵尸清扫掉
  const heartbeat = setInterval(() => {
    setRunningStatus(source, 'running').catch(error => {
      console.error(`[UnifiedScheduler] 心跳刷新失败 (${source}):`, error);
    });
  }, HEARTBEAT_INTERVAL_MS);
  // 不阻止进程在任务结束后退出
  heartbeat.unref?.();

  try {
    let result: { success: boolean; message: string; total?: number; newCount?: number; updateCount?: number; error?: string };

    if (source === 'gz_drug') {
      result = await scrapeDrugInfo(undefined, undefined, sinks?.fetch ? { onProgress: sinks.fetch } : undefined);
    } else if (source === 'gd_pubonln') {
      result = await scrapePubonlnDrugInfo(sinks?.fetch ? { onProgress: sinks.fetch } : undefined);
    } else if (source === 'merged_drug') {
      result = await syncMergedDrugData(sinks?.merge ? { onProgress: sinks.merge } : undefined);
      // syncMergedDrugData返回的对象缺少total/newCount等具体统计，为了统一日志，将其置0或在调用处后续扩展
      result.total = 0;
      result.newCount = 0;
      result.updateCount = 0;
    } else if (source === 'ledger') {
      try {
        result = await executeLedgerSnapshot(sinks?.ledger ? { onProgress: sinks.ledger } : undefined);
      } catch (error) {
        result = { success: false, message: '台账快照失败', error: error instanceof Error ? error.message : '未知错误' };
      }
    } else {
      throw new Error(`未知数据源: ${source}`);
    }

    // 更新抓取日志
    if (logId) {
      await updateScrapeLog(logId, {
        status: result.success ? 'success' : 'failed',
        total_count: result.total || 0,
        new_count: result.newCount || 0,
        update_count: result.updateCount || 0,
        error_message: result.error,
      });
    }

    // 更新配置表中的最后执行状态和下次执行时间
    await finalizeScrapeRun(source, result.success ? 'success' : 'failed');

    console.log(`[UnifiedScheduler] 抓取任务完成 (${source}): ${result.message}`);
  } catch (error) {
    console.error(`[UnifiedScheduler] 抓取任务失败 (${source}):`, error);

    // 异常路径补发终态错误补丁，避免进度行停留 running 等待读侧降级
    const errorText = error instanceof Error ? error.message : '未知错误';
    if (sinks?.fetch) {
      sinks.fetch({ status: 'error', error: errorText, endTime: Date.now() });
    } else if (sinks?.merge) {
      sinks.merge({ status: 'error', phase: '同步失败', error: errorText, endTime: Date.now() });
    } else if (sinks?.ledger) {
      sinks.ledger({ status: 'error', error: errorText, endTime: Date.now() });
    }

    // 更新抓取日志为失败
    if (logId) {
      await updateScrapeLog(logId, {
        status: 'failed',
        error_message: error instanceof Error ? error.message : '未知错误',
      });
    }

    // 更新配置表中的失败状态
    await finalizeScrapeRun(source, 'failed');
  } finally {
    clearInterval(heartbeat);
    // 释放锁
    await setRunningStatus(source, 'idle');
  }
}

/**
 * 执行定时抓取任务（旧 cron trigger 通道过渡兼容封装）
 * @deprecated 唯一调用方 /api/cron/trigger 已删除，定时/手动执行均由
 * GitHub Actions runner（scripts/scrape-runner.ts）认领执行。观察期后物理删除。
 *
 * 防重复检查 → 置 running → 建日志 → runScrapeJob（无 sinks，回退内存进度）
 */
export async function executeScrapeTask(source: DataSource): Promise<void> {
  console.log(`[UnifiedScheduler] 开始执行定时抓取任务 (${source})...`);

  // 检查是否可以开始（防止重复抓取）
  const { canStart, reason } = await canStartScrape(source);
  if (!canStart) {
    console.log(`[UnifiedScheduler] 跳过定时抓取 (${source}): ${reason}`);
    return;
  }

  // 设置运行状态
  await setRunningStatus(source, 'running');

  // 创建抓取日志
  const logId = await createScrapeLog(source, 'scheduled');

  await runScrapeJob(source, logId);
}

/**
 * 初始化调度器（预热并确保配置记录存在）
 */
export async function initUnifiedScheduler(source: DataSource): Promise<void> {
  await getUnifiedSchedulerConfig(source);
  console.log(`[UnifiedScheduler] 调度器初始化/预热完成 (${source})`);
}

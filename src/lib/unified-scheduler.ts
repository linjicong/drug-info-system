/**
 * 统一的调度器管理模块
 * 支持多数据源，防止重复抓取，记录抓取日志
 */

import { db } from '@/storage/database/db';
import {
  unifiedSchedulerConfig,
  scrapeLog,
  drugInfo,
  pubonlnDrugInfo,
  mergedDrugInfo,
} from '@/storage/database/shared/schema';
import { eq, desc } from 'drizzle-orm';
import { scrapeDrugInfo } from './drug-scraper';
import { scrapePubonlnDrugInfo } from './pubonln-scraper';

import { syncMergedDrugData } from './merged-drug-service';

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
  status: 'running' | 'success' | 'failed';
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
      .from(unifiedSchedulerConfig)
      .where(eq(unifiedSchedulerConfig.source, source))
      .limit(1);

    if (rows.length > 0) {
      return rows[0] as unknown as UnifiedSchedulerConfig;
    }

    // 没有记录，创建默认配置。优先复用环境变量 CRON_SECRET（与 Vercel Cron 鉴权一致），否则生成密码学安全随机值
    const cronSecret = process.env.CRON_SECRET || crypto.randomUUID();
    const insertResult = await db.insert(unifiedSchedulerConfig).values({
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
      .from(unifiedSchedulerConfig)
      .where(eq(unifiedSchedulerConfig.id, newConfigId))
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
      updated_at: new Date().toISOString(),
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
      ).toISOString();
    } else if (config.enabled === false) {
      updateData.next_run_at = null;
    }

    await db
      .update(unifiedSchedulerConfig)
      .set(updateData)
      .where(eq(unifiedSchedulerConfig.id, currentConfig.id));

    // 已移除对 restartUnifiedScheduler 的调用，依靠外部 Cron 定期拉取最新状态
    // MySQL 不支持 RETURNING，回查更新后的配置
    const updatedRows = await db
      .select()
      .from(unifiedSchedulerConfig)
      .where(eq(unifiedSchedulerConfig.id, currentConfig.id))
      .limit(1);

    return (updatedRows[0] as unknown as UnifiedSchedulerConfig) ?? null;
  } catch (error) {
    console.error(`[UnifiedScheduler] 更新配置失败 (${source}):`, error);
    throw error;
  }
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
    .update(unifiedSchedulerConfig)
    .set({
      running_status: status,
      updated_at: new Date(),
    })
    .where(eq(unifiedSchedulerConfig.id, config.id));
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

  const nowIso = new Date().toISOString();
  const updateData: Record<string, unknown> = {
    last_run_at: nowIso,
    last_run_status: status,
    updated_at: nowIso,
  };

  // 启用状态下顺便推进 next_run_at，避免外部 Cron 触发时间一直停留在过去的时刻
  if (config.enabled) {
    updateData.next_run_at = new Date(
      Date.now() + config.interval_minutes * 60 * 1000
    ).toISOString();
  }

  await db
    .update(unifiedSchedulerConfig)
    .set(updateData)
    .where(eq(unifiedSchedulerConfig.id, config.id));
}

/**
 * 创建抓取日志
 */
export async function createScrapeLog(
  source: DataSource,
  scrapeType: 'manual' | 'scheduled'
): Promise<number | null> {
  try {
    const insertResult = await db.insert(scrapeLog).values({
      source,
      scrape_type: scrapeType,
      status: 'running',
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
        .select({ created_at: drugInfo.created_at })
        .from(drugInfo)
        .orderBy(desc(drugInfo.created_at))
        .limit(1);
      return (rows[0]?.created_at as unknown as string) ?? null;
    }

    if (source === 'gd_pubonln') {
      const rows = await db
        .select({ created_at: pubonlnDrugInfo.created_at })
        .from(pubonlnDrugInfo)
        .orderBy(desc(pubonlnDrugInfo.created_at))
        .limit(1);
      return (rows[0]?.created_at as unknown as string) ?? null;
    }

    if (source === 'merged_drug') {
      const rows = await db
        .select({ synced_at: mergedDrugInfo.synced_at })
        .from(mergedDrugInfo)
        .orderBy(desc(mergedDrugInfo.synced_at))
        .limit(1);
      return (rows[0]?.synced_at as unknown as string) ?? null;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * 执行定时抓取任务
 * 根据数据源类型调用对应的抓取函数，并记录日志和更新状态
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

  try {
    // 根据数据源调用对应的抓取/合并函数
    let result: { success: boolean; message: string; total?: number; newCount?: number; updateCount?: number; error?: string };

    if (source === 'gz_drug') {
      result = await scrapeDrugInfo();
    } else if (source === 'gd_pubonln') {
      result = await scrapePubonlnDrugInfo();
    } else if (source === 'merged_drug') {
      result = await syncMergedDrugData();
      // syncMergedDrugData返回的对象缺少total/newCount等具体统计，为了统一日志，将其置0或在调用处后续扩展
      result.total = 0;
      result.newCount = 0;
      result.updateCount = 0;
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

    console.log(`[UnifiedScheduler] 定时抓取完成 (${source}): ${result.message}`);
  } catch (error) {
    console.error(`[UnifiedScheduler] 定时抓取失败 (${source}):`, error);

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
    // 重置运行状态
    await setRunningStatus(source, 'idle');
  }
}

/**
 * 初始化调度器（预热并确保配置记录存在）
 */
export async function initUnifiedScheduler(source: DataSource): Promise<void> {
  await getUnifiedSchedulerConfig(source);
  console.log(`[UnifiedScheduler] 调度器初始化/预热完成 (${source})`);
}

/**
 * 统一的调度器管理模块
 * 支持多数据源，防止重复抓取，记录抓取日志
 */

import { getSupabaseClient } from '@/storage/database/supabase-client';
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

// 配置表名
const CONFIG_TABLE = 'unified_scheduler_config';
const LOG_TABLE = 'scrape_log';

// 调度器间隔存储已被移除，由外部 Cron API 触发

/**
 * 获取调度器配置
 */
export async function getUnifiedSchedulerConfig(source: DataSource): Promise<UnifiedSchedulerConfig | null> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from(CONFIG_TABLE)
      .select('*')
      .eq('source', source)
      .single();
    
    if (error && error.code === 'PGRST116') {
      // 没有记录，创建默认配置
      const { data: newConfig, error: insertError } = await supabase
        .from(CONFIG_TABLE)
        .insert({
          source,
          enabled: false,
          interval_minutes: 60,
          running_status: 'idle',
          cron_secret: Math.random().toString(36).substring(2, 15) // 生成初始随机秘钥
        })
        .select()
        .single();
      
      if (insertError) {
        console.error(`[UnifiedScheduler] 创建默认配置失败 (${source}):`, insertError);
        return null;
      }
      return newConfig;
    }
    
    if (error) {
      console.error(`[UnifiedScheduler] 获取配置失败 (${source}):`, error);
      return null;
    }
    
    return data;
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

    const supabase = getSupabaseClient();
    const { data: updated, error } = await supabase
      .from(CONFIG_TABLE)
      .update(updateData)
      .eq('id', currentConfig.id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    // 已移除对 restartUnifiedScheduler 的调用，依靠外部 Cron 定期拉取最新状态

    return updated;
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

  const supabase = getSupabaseClient();
  await supabase
    .from(CONFIG_TABLE)
    .update({
      running_status: status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', config.id);
}

/**
 * 创建抓取日志
 */
export async function createScrapeLog(
  source: DataSource,
  scrapeType: 'manual' | 'scheduled'
): Promise<number | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(LOG_TABLE)
    .insert({
      source,
      scrape_type: scrapeType,
      status: 'running',
      start_time: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    console.error(`[UnifiedScheduler] 创建日志失败:`, error);
    return null;
  }

  return data.id;
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
  const supabase = getSupabaseClient();
  
  // 获取开始时间计算耗时
  const { data: log } = await supabase
    .from(LOG_TABLE)
    .select('start_time')
    .eq('id', logId)
    .single();

  const endTime = new Date();
  const durationSeconds = log ? Math.floor((endTime.getTime() - new Date(log.start_time).getTime()) / 1000) : null;

  await supabase
    .from(LOG_TABLE)
    .update({
      ...data,
      end_time: endTime.toISOString(),
      duration_seconds: durationSeconds,
    })
    .eq('id', logId);
}

/**
 * 获取最新抓取日志
 */
export async function getLatestScrapeLog(source: DataSource): Promise<ScrapeLog | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(LOG_TABLE)
    .select('*')
    .eq('source', source)
    .order('start_time', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    return null;
  }

  return data;
}

/**
 * 获取抓取日志列表
 */
export async function getScrapeLogs(
  source: DataSource,
  limit: number = 10
): Promise<ScrapeLog[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(LOG_TABLE)
    .select('*')
    .eq('source', source)
    .order('start_time', { ascending: false })
    .limit(limit);

  if (error) {
    return [];
  }

  return data || [];
}

/**
 * 获取最新数据时间
 */
export async function getLatestDataTime(source: DataSource): Promise<string | null> {
  const supabase = getSupabaseClient();
  let table = 'drug_info';
  let timestampCol = 'created_at';
  if (source === 'gd_pubonln') {
    table = 'pubonln_drug_info';
  } else if (source === 'merged_drug') {
    table = 'merged_drug_info';
    timestampCol = 'synced_at';
  }
  
  const { data, error } = await supabase
    .from(table)
    .select(timestampCol)
    .order(timestampCol, { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return null;
  }

  return (data as any)[timestampCol];
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
    const config = await getUnifiedSchedulerConfig(source);
    if (config) {
      const nextRunAt = new Date(Date.now() + config.interval_minutes * 60 * 1000);
      const supabase = getSupabaseClient();
      await supabase
        .from(CONFIG_TABLE)
        .update({
          last_run_at: new Date().toISOString(),
          last_run_status: result.success ? 'success' : 'failed',
          next_run_at: nextRunAt.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', config.id);
    }

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
    const config = await getUnifiedSchedulerConfig(source);
    if (config) {
      const supabase = getSupabaseClient();
      await supabase
        .from(CONFIG_TABLE)
        .update({
          last_run_at: new Date().toISOString(),
          last_run_status: 'failed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', config.id);
    }
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

/**
 * 统一的调度器管理模块
 * 支持多数据源，防止重复抓取，记录抓取日志
 */

import { getSupabaseClient } from '@/storage/database/supabase-client';

// 数据源类型
export type DataSource = 'gz_drug' | 'gd_pubonln';

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

// 调度器间隔存储
const schedulerIntervals = new Map<DataSource, NodeJS.Timeout>();

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
  config: { enabled?: boolean; interval_minutes?: number }
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

    // 重启调度器
    restartUnifiedScheduler(source);

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
  const table = source === 'gz_drug' ? 'drug_info' : 'pubonln_drug_info';
  
  const { data, error } = await supabase
    .from(table)
    .select('created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return null;
  }

  return data.created_at;
}

/**
 * 重启调度器
 */
function restartUnifiedScheduler(source: DataSource): void {
  stopUnifiedScheduler(source);
  startUnifiedScheduler(source);
}

/**
 * 停止调度器
 */
function stopUnifiedScheduler(source: DataSource): void {
  const interval = schedulerIntervals.get(source);
  if (interval) {
    clearInterval(interval);
    schedulerIntervals.delete(source);
    console.log(`[UnifiedScheduler] 定时任务已停止 (${source})`);
  }
}

/**
 * 启动调度器
 */
async function startUnifiedScheduler(source: DataSource): Promise<void> {
  if (schedulerIntervals.has(source)) {
    return;
  }

  const config = await getUnifiedSchedulerConfig(source);
  if (!config || !config.enabled) {
    return;
  }

  const intervalMs = config.interval_minutes * 60 * 1000;
  
  console.log(`[UnifiedScheduler] 启动定时任务 (${source})，间隔: ${config.interval_minutes} 分钟`);
  
  const interval = setInterval(async () => {
    const currentConfig = await getUnifiedSchedulerConfig(source);
    if (!currentConfig?.enabled) {
      stopUnifiedScheduler(source);
      return;
    }
    
    // 执行定时抓取（通过回调函数）
    console.log(`[UnifiedScheduler] 定时触发抓取 (${source})`);
  }, intervalMs);

  schedulerIntervals.set(source, interval);
}

/**
 * 初始化调度器
 */
export async function initUnifiedScheduler(source: DataSource): Promise<void> {
  const config = await getUnifiedSchedulerConfig(source);
  if (config?.enabled) {
    await startUnifiedScheduler(source);
  }
  console.log(`[UnifiedScheduler] 调度器初始化完成 (${source})`);
}

/**
 * 检查调度器是否运行中
 */
export function isUnifiedSchedulerRunning(source: DataSource): boolean {
  return schedulerIntervals.has(source);
}

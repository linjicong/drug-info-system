/**
 * 广东医保挂网药品后端定时任务调度器
 */

import { getSupabaseClient } from '@/storage/database/supabase-client';
import { scrapePubonlnDrugInfo } from './pubonln-scraper';

// 调度器状态
let schedulerInterval: NodeJS.Timeout | null = null;
let isInitialized = false;

// 配置表名
const CONFIG_TABLE = 'pubonln_scheduler_config';

/**
 * 获取当前调度器配置
 */
export async function getPubonlnSchedulerConfig() {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from(CONFIG_TABLE)
      .select('*')
      .limit(1)
      .single();
    
    if (error && error.code === 'PGRST116') {
      // 没有记录，创建默认配置
      const { data: newConfig, error: insertError } = await supabase
        .from(CONFIG_TABLE)
        .insert({
          enabled: false,
          interval_minutes: 60,
        })
        .select()
        .single();
      
      if (insertError) {
        console.error('[PubonlnScheduler] 创建默认配置失败:', insertError);
        return null;
      }
      return newConfig;
    }
    
    if (error) {
      console.error('[PubonlnScheduler] 获取配置失败:', error);
      return null;
    }
    
    return data;
  } catch (error) {
    console.error('[PubonlnScheduler] 获取配置失败:', error);
    return null;
  }
}

/**
 * 更新调度器配置
 */
export async function updatePubonlnSchedulerConfig(config: {
  enabled?: boolean;
  interval_minutes?: number;
}) {
  try {
    const currentConfig = await getPubonlnSchedulerConfig();
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
    restartPubonlnScheduler();

    return updated;
  } catch (error) {
    console.error('[PubonlnScheduler] 更新配置失败:', error);
    throw error;
  }
}

/**
 * 执行抓取任务
 */
async function executeFetchTask() {
  console.log('[PubonlnScheduler] 开始执行定时抓取任务...');
  
  try {
    const result = await scrapePubonlnDrugInfo();
    
    // 更新最后执行状态和下次执行时间
    const config = await getPubonlnSchedulerConfig();
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
    
    console.log('[PubonlnScheduler] 定时抓取完成:', result.message);
  } catch (error) {
    console.error('[PubonlnScheduler] 定时抓取失败:', error);
    
    // 更新失败状态
    const config = await getPubonlnSchedulerConfig();
    if (config) {
      const supabase = getSupabaseClient();
      await supabase
        .from(CONFIG_TABLE)
        .update({
          last_run_at: new Date().toISOString(),
          last_run_status: 'error',
          updated_at: new Date().toISOString(),
        })
        .eq('id', config.id);
    }
  }
}

/**
 * 启动调度器
 */
async function startScheduler() {
  if (schedulerInterval) {
    return;
  }

  const config = await getPubonlnSchedulerConfig();
  if (!config || !config.enabled) {
    return;
  }

  const intervalMs = config.interval_minutes * 60 * 1000;
  
  console.log(`[PubonlnScheduler] 启动定时任务，间隔: ${config.interval_minutes} 分钟`);
  
  schedulerInterval = setInterval(async () => {
    const currentConfig = await getPubonlnSchedulerConfig();
    if (!currentConfig?.enabled) {
      stopScheduler();
      return;
    }
    
    await executeFetchTask();
  }, intervalMs);
}

/**
 * 停止调度器
 */
function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[PubonlnScheduler] 定时任务已停止');
  }
}

/**
 * 重启调度器
 */
function restartPubonlnScheduler() {
  stopScheduler();
  startScheduler();
}

/**
 * 初始化调度器
 */
export async function initPubonlnScheduler() {
  if (isInitialized) {
    return;
  }
  
  console.log('[PubonlnScheduler] 初始化定时任务调度器...');
  
  const config = await getPubonlnSchedulerConfig();
  if (config?.enabled) {
    await startScheduler();
  }
  
  isInitialized = true;
  console.log('[PubonlnScheduler] 调度器初始化完成');
}

// 导出状态检查函数
export function isPubonlnSchedulerRunning() {
  return schedulerInterval !== null;
}

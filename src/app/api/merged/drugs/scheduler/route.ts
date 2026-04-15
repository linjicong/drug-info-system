import { NextRequest, NextResponse } from 'next/server';
import {
  getUnifiedSchedulerConfig,
  updateUnifiedSchedulerConfig,
  getLatestScrapeLog,
  getLatestDataTime,
  initUnifiedScheduler,
  isUnifiedSchedulerRunning,
} from '@/lib/unified-scheduler';

const SOURCE = 'merged_drug' as const;

// 初始化标记
let initialized = false;

/**
 * GET /api/merged/drugs/scheduler - 获取当前调度器配置
 */
export async function GET() {
  try {
    if (!initialized) {
      await initUnifiedScheduler(SOURCE);
      initialized = true;
    }

    const config = await getUnifiedSchedulerConfig(SOURCE);
    
    if (!config) {
      return NextResponse.json({
        success: false,
        message: '无法获取调度器配置',
      }, { status: 500 });
    }

    const latestLog = await getLatestScrapeLog(SOURCE);
    const latestDataTime = await getLatestDataTime(SOURCE);

    return NextResponse.json({
      success: true,
      data: {
        enabled: config.enabled,
        intervalMinutes: config.interval_minutes,
        nextRunAt: config.next_run_at,
        lastRunAt: config.last_run_at,
        lastRunStatus: config.last_run_status,
        isRunning: isUnifiedSchedulerRunning(SOURCE),
        runningStatus: config.running_status,
        latestLog: latestLog ? {
          startTime: latestLog.start_time,
          endTime: latestLog.end_time,
          status: latestLog.status,
          totalCount: latestLog.total_count,
          newCount: latestLog.new_count,
          updateCount: latestLog.update_count,
          durationSeconds: latestLog.duration_seconds,
        } : null,
        latestDataTime,
      },
    });
  } catch (error) {
    console.error('[API] 获取调度器配置失败:', error);
    return NextResponse.json({
      success: false,
      message: '获取调度器配置失败',
      error: error instanceof Error ? error.message : '未知错误',
    }, { status: 500 });
  }
}

/**
 * POST /api/merged/drugs/scheduler - 更新调度器配置
 */
export async function POST(request: NextRequest) {
  try {
    if (!initialized) {
      await initUnifiedScheduler(SOURCE);
      initialized = true;
    }

    const body = await request.json();
    const { enabled, intervalMinutes } = body;

    const updateData: { enabled?: boolean; interval_minutes?: number } = {};
    
    if (typeof enabled === 'boolean') {
      updateData.enabled = enabled;
    }
    
    if (typeof intervalMinutes === 'number' && intervalMinutes >= 1 && intervalMinutes <= 1440) {
      updateData.interval_minutes = intervalMinutes;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({
        success: false,
        message: '无效的配置参数',
      }, { status: 400 });
    }

    const updated = await updateUnifiedSchedulerConfig(SOURCE, updateData);

    return NextResponse.json({
      success: true,
      message: updateData.enabled === true 
        ? `定时同步已配置，每 ${updated!.interval_minutes} 分钟执行一次`
        : updateData.enabled === false 
          ? '定时同步已停止'
          : '配置已更新',
      data: {
        enabled: updated!.enabled,
        intervalMinutes: updated!.interval_minutes,
        nextRunAt: updated!.next_run_at,
      },
    });
  } catch (error) {
    console.error('[API] 更新调度器配置失败:', error);
    return NextResponse.json({
      success: false,
      message: '更新调度器配置失败',
      error: error instanceof Error ? error.message : '未知错误',
    }, { status: 500 });
  }
}

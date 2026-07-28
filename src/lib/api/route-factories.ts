import { NextRequest, NextResponse } from 'next/server';
import {
  getUnifiedSchedulerConfig,
  updateUnifiedSchedulerConfig,
  getLatestScrapeLog,
  getLatestDataTime,
  initUnifiedScheduler,
  canStartScrape,
  setRunningStatus,
  createScrapeLog,
  updateScrapeLog,
  finalizeScrapeRun,
} from '@/lib/unified-scheduler';
import { errorMessage, jsonError } from './responses';

type ScrapeSource = 'gz_drug' | 'gd_pubonln';

/**
 * 调度器配置路由工厂（GET 读取配置 / POST 更新配置）
 * initialized 标记移入闭包，route 模块单例语义与原模块级变量等价
 */
export function createSchedulerHandlers(source: ScrapeSource) {
  // 初始化标记
  let initialized = false;

  async function ensureInitialized() {
    if (!initialized) {
      await initUnifiedScheduler(source);
      initialized = true;
    }
  }

  async function GET() {
    try {
      // 首次请求时初始化调度器
      await ensureInitialized();

      const config = await getUnifiedSchedulerConfig(source);

      if (!config) {
        return jsonError('无法获取调度器配置', 500);
      }

      // 获取最新抓取日志
      const latestLog = await getLatestScrapeLog(source);
      // 获取最新数据时间
      const latestDataTime = await getLatestDataTime(source);

      return NextResponse.json({
        success: true,
        data: {
          enabled: config.enabled,
          intervalMinutes: config.interval_minutes,
          nextRunAt: config.next_run_at,
          lastRunAt: config.last_run_at,
          lastRunStatus: config.last_run_status,
          cronSecret: config.cron_secret,
          isRunning: config.running_status === 'running',
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
      return jsonError('获取调度器配置失败', 500, error);
    }
  }

  async function POST(request: NextRequest) {
    try {
      // 首次请求时初始化调度器
      await ensureInitialized();

      const body = await request.json();
      const { enabled, intervalMinutes, cronSecret } = body;

      // 验证参数
      const updateData: { enabled?: boolean; interval_minutes?: number; cron_secret?: string } = {};

      if (typeof enabled === 'boolean') {
        updateData.enabled = enabled;
      }

      if (typeof intervalMinutes === 'number' && intervalMinutes >= 1 && intervalMinutes <= 1440) {
        updateData.interval_minutes = intervalMinutes;
      }

      if (typeof cronSecret === 'string') {
        updateData.cron_secret = cronSecret;
      }

      if (Object.keys(updateData).length === 0) {
        return jsonError('无效的配置参数', 400);
      }

      const updated = await updateUnifiedSchedulerConfig(source, updateData);

      return NextResponse.json({
        success: true,
        message: updateData.enabled === true
          ? `定时抓取已配置，每 ${updated!.interval_minutes} 分钟执行一次`
          : updateData.enabled === false
            ? '定时抓取已停止'
            : '配置已更新',
        data: {
          enabled: updated!.enabled,
          intervalMinutes: updated!.interval_minutes,
          nextRunAt: updated!.next_run_at,
        },
      });
    } catch (error) {
      console.error('[API] 更新调度器配置失败:', error);
      return jsonError('更新调度器配置失败', 500, error);
    }
  }

  return { GET, POST };
}

/** 抓取结果基本形状（gz / pubonln scraper 共同字段） */
interface ScrapeResultBase {
  success: boolean;
  message: string;
  error?: string;
}

/**
 * 手动抓取路由工厂（POST 触发抓取）
 * 保留原有双层 catch 语义：内层负责日志/状态回写后 rethrow，外层统一 500；
 * setRunningStatus('idle') 置于 finally，确保任何异常路径都不会把运行状态卡在 running
 */
export function createFetchHandler<R extends ScrapeResultBase>(options: {
  source: ScrapeSource;
  /** 执行抓取（含请求体解析） */
  run: (request: NextRequest) => Promise<R>;
  /** 抓取结果 → 日志计数字段 */
  toLogCounts: (result: R) => { total_count?: number; new_count?: number; update_count?: number };
  /** 抓取结果 → 成功响应 data */
  toResponseData: (result: R) => Record<string, unknown>;
  /** 错误日志前缀 */
  errorLogPrefix: string;
}) {
  const { source, run, toLogCounts, toResponseData, errorLogPrefix } = options;

  return async function POST(request: NextRequest) {
    try {
      // 检查是否可以开始抓取
      const { canStart, reason } = await canStartScrape(source);

      if (!canStart) {
        return jsonError(reason!, 409); // 409 Conflict
      }

      // 设置运行状态
      await setRunningStatus(source, 'running');

      // 创建抓取日志
      const logId = await createScrapeLog(source, 'manual');

      try {
        // 执行抓取
        const result = await run(request);

        // 更新抓取日志
        if (logId) {
          await updateScrapeLog(logId, {
            status: result.success ? 'success' : 'failed',
            ...toLogCounts(result),
            error_message: result.error,
          });
        }

        // 同步更新 config 表的 last_run_at / last_run_status / next_run_at
        await finalizeScrapeRun(source, result.success ? 'success' : 'failed');

        if (result.success) {
          return NextResponse.json({
            success: true,
            message: result.message,
            data: toResponseData(result),
          });
        } else {
          return NextResponse.json({
            success: false,
            message: result.message,
            error: result.error,
          }, { status: 500 });
        }
      } catch (error) {
        // 日志/结果回写各自兜底，任一步失败都不阻断后续复位
        if (logId) {
          try {
            await updateScrapeLog(logId, {
              status: 'failed',
              error_message: errorMessage(error),
            });
          } catch (logErr) {
            console.error('[API] 回写抓取日志失败:', logErr);
          }
        }

        try {
          await finalizeScrapeRun(source, 'failed');
        } catch (finalizeErr) {
          console.error('[API] 回写抓取结果失败:', finalizeErr);
        }

        throw error;
      } finally {
        // 无论成功/失败/回写异常，都强制复位运行状态，
        // 避免 running_status 卡死导致下次无法再次触发抓取
        try {
          await setRunningStatus(source, 'idle');
        } catch (resetErr) {
          console.error('[API] 复位运行状态失败:', resetErr);
        }
      }
    } catch (error) {
      console.error(errorLogPrefix, error);
      return jsonError('抓取失败', 500, error);
    }
  };
}

/**
 * 抓取进度路由工厂（GET 轮询 / DELETE 重置 / POST 405）
 * POST 是否导出由各 route.ts 自行决定（gz 有、pubonln 无）
 */
export function createProgressHandlers(options: {
  getFn: () => unknown;
  resetFn: () => void;
}) {
  const { getFn, resetFn } = options;

  async function GET() {
    const progress = getFn();
    return NextResponse.json(progress, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    });
  }

  async function DELETE() {
    resetFn();
    return NextResponse.json({ success: true });
  }

  async function POST() {
    return NextResponse.json(
      { error: '此端点仅支持 GET / DELETE 请求' },
      { status: 405 }
    );
  }

  return { GET, DELETE, POST };
}

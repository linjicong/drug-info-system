import { NextRequest, NextResponse } from 'next/server';
import {
  getUnifiedSchedulerConfig,
  updateUnifiedSchedulerConfig,
  getLatestScrapeLog,
  getLatestDataTime,
  initUnifiedScheduler,
  canStartScrape,
  createScrapeLog,
} from '@/lib/unified-scheduler';
import { jsonError } from './responses';

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

/**
 * 手动抓取路由工厂（POST 入队）
 * Vercel serverless 不再本地执行抓取：插入 queued 日志后立即返回，
 * 由 GitHub Actions runner 轮询认领执行（design §5）。
 * 响应契约不变：{ success, message }；运行中仍返回 409
 */
export function createFetchHandler(options: {
  source: ScrapeSource;
  /** 错误日志前缀 */
  errorLogPrefix: string;
}) {
  const { source, errorLogPrefix } = options;

  return async function POST() {
    try {
      // 检查是否可以开始（防重入，409）
      const { canStart, reason } = await canStartScrape(source);

      if (!canStart) {
        return jsonError(reason!, 409); // 409 Conflict
      }

      // 插入 queued 日志即入队，runner 下个周期认领执行
      const logId = await createScrapeLog(source, 'manual', 'queued');
      if (!logId) {
        return jsonError('抓取任务入队失败', 500);
      }

      return NextResponse.json({
        success: true,
        message: '抓取任务已加入执行队列',
      });
    } catch (error) {
      console.error(errorLogPrefix, error);
      return jsonError('抓取失败', 500, error);
    }
  };
}

/**
 * 抓取进度路由工厂（GET 轮询 / DELETE 重置 / POST 405）
 * getFn/resetFn 改接 task_progress 仓储层（异步），进度读写跨进程一致
 */
export function createProgressHandlers(options: {
  getFn: () => Promise<unknown> | unknown;
  resetFn: () => Promise<void> | void;
}) {
  const { getFn, resetFn } = options;

  async function GET() {
    const progress = await getFn();
    return NextResponse.json(progress, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    });
  }

  async function DELETE() {
    await resetFn();
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

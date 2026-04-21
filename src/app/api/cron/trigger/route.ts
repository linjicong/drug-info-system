import { NextRequest, NextResponse } from 'next/server';
import {
  DataSource,
  getUnifiedSchedulerConfig,
  executeScrapeTask,
} from '@/lib/unified-scheduler';
import { executeLedgerSnapshot } from '@/lib/ledger-service';

// 允许的所有数据源
const ALL_SOURCES: DataSource[] = ['gz_drug', 'gd_pubonln', 'merged_drug', 'ledger'];

/**
 * GET /api/cron/trigger
 * 供外部 Cron（如 GitHub Actions, UptimeRobot, Serverless CRON）调用的触发接口
 * 必须携带 ?source=xxx 参数指定要触发的数据源，每次只触发一个任务
 */
export async function GET(request: NextRequest) {
  try {
    const passedSecret = request.headers.get('authorization')?.replace('Bearer ', '') || request.nextUrl.searchParams.get('secret');
    const targetSource = request.nextUrl.searchParams.get('source') as DataSource | null;

    // source 参数为必填项
    if (!targetSource) {
      return NextResponse.json(
        { success: false, message: 'Missing required parameter: source. Allowed values: ' + ALL_SOURCES.join(', ') },
        { status: 400 }
      );
    }

    // 校验 source 是否合法
    if (!ALL_SOURCES.includes(targetSource)) {
      return NextResponse.json(
        { success: false, message: 'Invalid source. Allowed values: ' + ALL_SOURCES.join(', ') },
        { status: 400 }
      );
    }

    // 获取该数据源的调度器配置
    const config = await getUnifiedSchedulerConfig(targetSource);

    if (!config || !config.enabled) {
      return NextResponse.json({
        success: true,
        message: 'Cron trigger skipped',
        result: { source: targetSource, status: 'skipped (disabled)' },
      });
    }

    // 校验 cron_secret
    const expectedSecret = config.cron_secret;
    if (expectedSecret && passedSecret !== expectedSecret) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized: invalid secret' },
        { status: 401 }
      );
    }

    // 检查是否正在运行中
    if (config.running_status === 'running') {
      return NextResponse.json({
        success: true,
        message: 'Cron trigger skipped',
        result: { source: targetSource, status: 'skipped (already running)' },
      });
    }

    // 检查是否到达执行时间
    const now = new Date();
    const nextRunAt = config.next_run_at ? new Date(config.next_run_at) : new Date(0);

    if (now < nextRunAt) {
      return NextResponse.json({
        success: true,
        message: 'Cron trigger skipped',
        result: { source: targetSource, status: `skipped (next run at ${nextRunAt.toISOString()})` },
      });
    }

    // 串行执行单个任务，同步等待完成（FaaS 防挂起）
    try {
      if (targetSource === 'ledger') {
        const ledgerResult = await executeLedgerSnapshot();
        if (!ledgerResult.success) {
          throw new Error(ledgerResult.message || 'Ledger snapshot failed');
        }
      } else {
        await executeScrapeTask(targetSource);
      }
    } catch (e) {
      console.error(`[CronTrigger] 触发任务失败 (${targetSource}):`, e);
      return NextResponse.json(
        {
          success: false,
          message: `Task execution failed for source: ${targetSource}`,
          error: e instanceof Error ? e.message : 'Unknown error',
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Cron trigger completed',
      result: { source: targetSource, status: 'triggered' },
    });
  } catch (error) {
    console.error('[API Cron Trigger] 失败:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Internal server error during cron trigger',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

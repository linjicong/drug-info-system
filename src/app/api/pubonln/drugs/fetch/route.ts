import { NextRequest, NextResponse } from 'next/server';
import { scrapePubonlnDrugInfo } from '@/lib/pubonln-scraper';
import {
  canStartScrape,
  setRunningStatus,
  createScrapeLog,
  updateScrapeLog,
  finalizeScrapeRun,
} from '@/lib/unified-scheduler';

const SOURCE = 'gd_pubonln' as const;

/**
 * POST /api/pubonln/drugs/fetch - 触发抓取挂网药品信息
 */
export async function POST(request: NextRequest) {
  try {
    // 检查是否可以开始抓取
    const { canStart, reason } = await canStartScrape(SOURCE);
    
    if (!canStart) {
      return NextResponse.json({
        success: false,
        message: reason,
      }, { status: 409 }); // 409 Conflict
    }

    // 设置运行状态
    await setRunningStatus(SOURCE, 'running');
    
    // 创建抓取日志
    const logId = await createScrapeLog(SOURCE, 'manual');

    try {
      // 执行抓取
      const result = await scrapePubonlnDrugInfo();

      // 更新抓取日志
      if (logId) {
        await updateScrapeLog(logId, {
          status: result.success ? 'success' : 'failed',
          total_count: result.total,
          new_count: result.newCount,
          update_count: 0,
          error_message: result.error,
        });
      }

      // 同步更新 config 表的 last_run_at / last_run_status / next_run_at
      await finalizeScrapeRun(SOURCE, result.success ? 'success' : 'failed');

      // 重置运行状态
      await setRunningStatus(SOURCE, 'idle');

      if (result.success) {
        return NextResponse.json({
          success: true,
          message: result.message,
          data: {
            total: result.total,
            newCount: result.newCount,
          },
        });
      } else {
        return NextResponse.json({
          success: false,
          message: result.message,
          error: result.error,
        }, { status: 500 });
      }
    } catch (error) {
      // 更新抓取日志
      if (logId) {
        await updateScrapeLog(logId, {
          status: 'failed',
          error_message: error instanceof Error ? error.message : '未知错误',
        });
      }

      // 同步更新 config 表的失败状态
      await finalizeScrapeRun(SOURCE, 'failed');

      // 重置运行状态
      await setRunningStatus(SOURCE, 'idle');

      throw error;
    }
  } catch (error) {
    console.error('[API] 挂网药品抓取错误:', error);
    return NextResponse.json({
      success: false,
      message: '抓取失败',
      error: error instanceof Error ? error.message : '未知错误',
    }, { status: 500 });
  }
}

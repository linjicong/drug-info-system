import { NextResponse } from 'next/server';
import { syncMergedDrugData } from '@/lib/merged-drug-service';
import {
  canStartScrape,
  setRunningStatus,
  createScrapeLog,
  updateScrapeLog,
} from '@/lib/unified-scheduler';
import { startMergeProgress } from '@/lib/merged-progress-manager';

const SOURCE = 'merged_drug' as const;

/**
 * 手动触发合并同步任务
 * POST /api/merged/drugs/sync
 */
export async function POST() {
  let runningMarked = false;
  try {
    const { canStart, reason } = await canStartScrape(SOURCE);
    if (!canStart) {
      return NextResponse.json(
        { success: false, message: reason },
        { status: 409 }
      );
    }

    await setRunningStatus(SOURCE, 'running');
    runningMarked = true;
    startMergeProgress();
    const logId = await createScrapeLog(SOURCE, 'manual');

    // 异步执行合并同步，不阻塞响应
    syncMergedDrugData()
      .then(async (result) => {
        if (logId) {
          await updateScrapeLog(logId, {
            status: result.success ? 'success' : 'failed',
            total_count: 0,
            new_count: 0,
            update_count: 0,
            error_message: result.error,
          });
        }
      })
      .catch(async (err) => {
        console.error('[API] 执行合并同步任务失败:', err);
        if (logId) {
          await updateScrapeLog(logId, {
            status: 'failed',
            total_count: 0,
            new_count: 0,
            update_count: 0,
            error_message: err instanceof Error ? err.message : '未知错误',
          });
        }
      })
      .finally(async () => {
        await setRunningStatus(SOURCE, 'idle');
      });

    return NextResponse.json({
      success: true,
      message: '合并任务已在后台启动',
    });
  } catch (error) {
    if (runningMarked) {
      try {
        await setRunningStatus(SOURCE, 'idle');
      } catch (resetErr) {
        console.error('[API] 回滚合并任务运行状态失败:', resetErr);
      }
    }
    console.error('[API] 触发合并任务错误:', error);
    return NextResponse.json(
      {
        success: false,
        message: '触发失败',
        error: error instanceof Error ? error.message : '未知错误',
      },
      { status: 500 }
    );
  }
}

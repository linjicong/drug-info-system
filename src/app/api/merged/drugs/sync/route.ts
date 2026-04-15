import { NextResponse } from 'next/server';
import { syncMergedDrugData } from '@/lib/merged-drug-service';
import { isMergingRunning } from '@/lib/merged-progress-manager';

/**
 * 手动触发合并同步任务
 * POST /api/merged/drugs/sync
 */
export async function POST() {
  try {
    if (isMergingRunning()) {
      return NextResponse.json(
        { success: false, message: '已有合并任务正在进行中，请稍后再试' },
        { status: 409 }
      );
    }

    // 异步执行合并同步，不阻塞响应
    syncMergedDrugData().catch((err) => {
      console.error('[API] 执行合并同步任务失败:', err);
    });

    return NextResponse.json({
      success: true,
      message: '合并任务已在后台启动',
    });
  } catch (error) {
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

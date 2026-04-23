import { NextResponse } from 'next/server';
import { getMergeProgress, resetMergeProgress } from '@/lib/merged-progress-manager';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * 获取合并同步任务进度（供前端轮询）
 * GET /api/merged/drugs/sync/progress
 */
export async function GET() {
  const progress = getMergeProgress();
  return NextResponse.json(progress, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });
}

/**
 * DELETE - 重置合并进度（合并完成后前端延时调用以收起进度卡片）
 */
export async function DELETE() {
  resetMergeProgress();
  return NextResponse.json({ success: true });
}

/**
 * 不支持 POST 等其他方法
 */
export async function POST() {
  return NextResponse.json(
    { error: 'Method Not Allowed' },
    { status: 405 }
  );
}

import { NextResponse } from 'next/server';
import { getMergeProgress } from '@/lib/merged-progress-manager';

/**
 * 获取合并同步任务进度（供前端轮询）
 * GET /api/merged/drugs/sync/progress
 */
export async function GET() {
  const progress = getMergeProgress();
  return NextResponse.json(progress);
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

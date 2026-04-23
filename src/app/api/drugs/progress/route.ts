import { NextResponse } from 'next/server';
import { getProgress, resetProgress } from '@/lib/progress-manager';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/drugs/progress - 获取抓取进度（轮询方式）
 */
export async function GET() {
  const progress = getProgress('gz_drug');
  return NextResponse.json(progress, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });
}

/**
 * DELETE /api/drugs/progress - 重置抓取进度（抓取完成后前端延时调用以收起进度卡片）
 */
export async function DELETE() {
  resetProgress('gz_drug');
  return NextResponse.json({ success: true });
}

/**
 * POST - 不支持
 */
export async function POST() {
  return NextResponse.json(
    { error: '此端点仅支持 GET / DELETE 请求' },
    { status: 405 }
  );
}

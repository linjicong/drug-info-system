import { NextResponse } from 'next/server';
import { getProgress } from '@/lib/progress-manager';

/**
 * GET /api/drugs/progress - 获取抓取进度（轮询方式）
 */
export async function GET() {
  const progress = getProgress('gz_drug');
  return NextResponse.json(progress);
}

/**
 * POST - 不支持
 */
export async function POST() {
  return NextResponse.json(
    { error: '此端点仅支持 GET 请求' },
    { status: 405 }
  );
}

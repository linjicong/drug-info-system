import { NextResponse } from 'next/server';
import { getProgress, resetProgress } from '@/lib/progress-manager';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const progress = getProgress('gd_pubonln');
  return NextResponse.json(progress, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });
}

/**
 * DELETE - 重置抓取进度（抓取完成后前端延时调用以收起进度卡片）
 */
export async function DELETE() {
  resetProgress('gd_pubonln');
  return NextResponse.json({ success: true });
}

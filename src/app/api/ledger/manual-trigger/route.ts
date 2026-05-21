import { NextRequest, NextResponse } from 'next/server';
import { executeLedgerSnapshot } from '@/lib/ledger-service';

/**
 * 应用内部手动触发台账快照生成接口
 * 与 cron 接口分离，避免在浏览器端暴露 cron_secret
 */
export async function POST(request: NextRequest) {
  try {
    const result = await executeLedgerSnapshot();
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Ledger Manual Trigger] 手动触发失败:', error);
    return NextResponse.json(
      { success: false, message: '手动触发台账生成失败', error: String(error) },
      { status: 500 }
    );
  }
}

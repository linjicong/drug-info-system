import { NextRequest, NextResponse } from 'next/server';
import { executeLedgerSnapshot } from '@/lib/ledger-service';
import { getUnifiedSchedulerConfig } from '@/lib/unified-scheduler';

/**
 * 可以通过 cron jobs 每天调用一次，或者手动触发
 * 鉴权方式：从数据库 unified_scheduler_config 表读取 cron_secret 进行校验
 */
export async function POST(request: NextRequest) {
  try {
    const passedSecret = request.headers.get('authorization')?.replace('Bearer ', '') || request.nextUrl.searchParams.get('secret');

    const config = await getUnifiedSchedulerConfig('ledger');

    if (!config) {
      return NextResponse.json(
        { success: false, message: 'Ledger scheduler config not found' },
        { status: 500 }
      );
    }

    if (!config.enabled) {
      return NextResponse.json({
        success: true,
        message: 'Ledger scheduler skipped',
        result: { status: 'skipped (disabled)' },
      });
    }

    const expectedSecret = config.cron_secret;
    if (expectedSecret && passedSecret !== expectedSecret) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized: invalid secret' },
        { status: 401 }
      );
    }

    const result = await executeLedgerSnapshot();

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Ledger Scheduler] 跑批失败:', error);
    return NextResponse.json(
      { success: false, message: '生成每天快照失败', error: String(error) },
      { status: 500 }
    );
  }
}

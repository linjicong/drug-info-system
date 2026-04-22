import { NextRequest, NextResponse } from 'next/server';
import { executeLedgerSnapshot } from '@/lib/ledger-service';

/**
 * 校验请求是否来自同域或可信本地地址
 * 兼容 localhost/127.0.0.1 混用及反向代理场景
 */
function isSameOriginRequest(request: NextRequest): boolean {
  const expectedOrigin = request.nextUrl.origin;
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');

  // 标准同域检查
  if (origin && origin === expectedOrigin) {
    return true;
  }

  if (referer && referer.startsWith(expectedOrigin)) {
    return true;
  }

  // 兼容本地开发环境：localhost 与 127.0.0.1 视为同源
  const isLocalExpected = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(expectedOrigin);
  if (isLocalExpected) {
    if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return true;
    }
    if (referer && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(referer)) {
      return true;
    }
  }

  return false;
}

/**
 * 应用内部手动触发台账快照生成接口
 * 与 cron 接口分离，避免在浏览器端暴露 cron_secret
 */
export async function POST(request: NextRequest) {
  try {
    if (!isSameOriginRequest(request)) {
      return NextResponse.json(
        { success: false, message: 'Forbidden: internal endpoint only' },
        { status: 403 }
      );
    }

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

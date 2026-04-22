import { NextResponse } from 'next/server';

function buildHeartbeatResponse() {
  return NextResponse.json(
    {
      success: true,
      message: 'service is alive',
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    }
  );
}

/**
 * GET /api/heartbeat
 * 用于外部定时探活，防止 FaaS 服务长时间空闲后休眠
 */
export async function GET() {
  return buildHeartbeatResponse();
}

/**
 * HEAD /api/heartbeat
 * 允许探活平台使用 HEAD 进行更轻量的可用性检查
 */
export async function HEAD() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });
}

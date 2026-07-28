import { NextResponse } from 'next/server';
import { db } from '@/storage/database/db';
import { healthCheck } from '@/storage/database/shared/schema';

/**
 * 写入 health_check 表（验证数据库连通性）。
 * 探活接口不因数据库失败而失败：写入异常仅记录日志，仍返回 200。
 */
async function touchHealthCheck() {
  try {
    // 保持单行（先清空再写入），避免探活频繁导致表膨胀
    await db.delete(healthCheck);
    await db.insert(healthCheck).values({ updatedAt: new Date().toISOString() });
  } catch (e) {
    console.warn('[heartbeat] health_check 写入失败:', e instanceof Error ? e.message : e);
  }
}

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
 * 用于外部定时探活，防止 FaaS 服务长时间空闲后休眠；同时写入 health_check 验证数据库连通
 */
export async function GET() {
  await touchHealthCheck();
  return buildHeartbeatResponse();
}

/**
 * HEAD /api/heartbeat
 * 允许探活平台使用 HEAD 进行更轻量的可用性检查（不写数据库）
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

import { NextResponse } from 'next/server';

/**
 * 提取错误消息（catch 块统一口径）
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误';
}

/**
 * 统一错误响应：{ success: false, message, error? }
 */
export function jsonError(message: string, status: number, error?: unknown): NextResponse {
  if (error === undefined) {
    return NextResponse.json({ success: false, message }, { status });
  }
  return NextResponse.json(
    { success: false, message, error: errorMessage(error) },
    { status },
  );
}

/**
 * 统一分页列表响应：{ success: true, data, pagination }
 */
export function pagedResponse<T>(params: {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}): NextResponse {
  const { data, page, pageSize, total } = params;
  return NextResponse.json({
    success: true,
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  });
}

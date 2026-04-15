import { NextRequest, NextResponse } from 'next/server';
import { getMergedDrugList } from '@/lib/merged-drug-service';

/**
 * 整合药品数据查询接口
 * GET /api/merged/drugs?page=1&pageSize=20&search=xxx
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');
    const searchKeyword = searchParams.get('search') || undefined;

    const result = await getMergedDrugList({ page, pageSize, searchKeyword });

    return NextResponse.json({
      success: true,
      data: result.data,
      pagination: {
        page,
        pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / pageSize),
      },
    });
  } catch (error) {
    console.error('[API] 整合药品查询错误:', error);
    return NextResponse.json(
      {
        success: false,
        message: '查询失败',
        error: error instanceof Error ? error.message : '未知错误',
      },
      { status: 500 }
    );
  }
}

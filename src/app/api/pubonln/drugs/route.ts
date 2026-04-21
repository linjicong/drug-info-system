import { NextRequest, NextResponse } from 'next/server';
import { getPubonlnDrugList } from '@/lib/pubonln-scraper';

/**
 * GET /api/pubonln/drugs - 获取挂网药品列表
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const searchKeyword = searchParams.get('search') || undefined;
    const productName = searchParams.get('productName') || undefined;
    const nationalDrugCode = searchParams.get('nationalDrugCode') || undefined;
    const companyName = searchParams.get('companyName') || searchParams.get('manufacturer') || undefined;
    const minPacQuantity = searchParams.get('minPacQuantity') || searchParams.get('minPackQuantity') || undefined;
    const minMeasureUnit = searchParams.get('minMeasureUnit') || searchParams.get('minPackUnit') || undefined;

    const { data, total } = await getPubonlnDrugList({
      page,
      pageSize,
      searchKeyword,
      productName,
      nationalDrugCode,
      companyName,
      minPacQuantity,
      minMeasureUnit,
    });

    const totalPages = Math.ceil(total / pageSize);

    return NextResponse.json({
      success: true,
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
    });
  } catch (error) {
    console.error('[API] 获取挂网药品列表失败:', error);
    return NextResponse.json({
      success: false,
      message: '获取数据失败',
      error: error instanceof Error ? error.message : '未知错误',
    }, { status: 500 });
  }
}

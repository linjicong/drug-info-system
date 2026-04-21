import { NextRequest, NextResponse } from 'next/server';
import { getDailyLedgers } from '@/lib/ledger-service';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');
    const productName = searchParams.get('productName') || undefined;
    const nationalDrugCode = searchParams.get('nationalDrugCode') || undefined;
    const companyName = searchParams.get('companyName') || undefined;
    const minPacQuantity = searchParams.get('minPacQuantity') || undefined;
    const minMeasureUnit = searchParams.get('minMeasureUnit') || undefined;
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;

    const result = await getDailyLedgers({
      page,
      pageSize,
      productName,
      nationalDrugCode,
      companyName,
      minPacQuantity,
      minMeasureUnit,
      startDate,
      endDate,
    });

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
    return NextResponse.json({ success: false, message: '查询台账历史数据失败', error: String(error) }, { status: 500 });
  }
}

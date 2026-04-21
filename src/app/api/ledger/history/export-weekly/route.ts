import { NextRequest, NextResponse } from 'next/server';
import { getDailyLedgersByDates } from '@/lib/ledger-service';

/**
 * 按指定日期列表查询台账数据（用于周一导出）
 * GET /api/ledger/history/export-weekly?dates=2024-04-01,2024-04-08&productName=xxx
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const datesStr = searchParams.get('dates') || '';
    const productName = searchParams.get('productName') || undefined;
    const nationalDrugCode = searchParams.get('nationalDrugCode') || undefined;
    const companyName = searchParams.get('companyName') || undefined;
    const minPacQuantity = searchParams.get('minPacQuantity') || undefined;
    const minMeasureUnit = searchParams.get('minMeasureUnit') || undefined;

    // 解析逗号分隔的日期字符串
    const dates = datesStr
      .split(',')
      .map(d => d.trim())
      .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));

    if (dates.length === 0) {
      return NextResponse.json({
        success: false,
        message: '未提供有效的日期参数',
      }, { status: 400 });
    }

    const data = await getDailyLedgersByDates(dates, {
      productName,
      nationalDrugCode,
      companyName,
      minPacQuantity,
      minMeasureUnit,
    });

    return NextResponse.json({
      success: true,
      data,
      dates, // 返回实际查询的日期列表，方便前端透视
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: '查询周一台账数据失败', error: String(error) },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getTrackedDrugs, insertTrackedDrugs, replaceTrackedDrugs, updateTrackedDrug, deleteTrackedDrug } from '@/lib/ledger-service';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');
    const searchKeyword = searchParams.get('search') || undefined;
    const productName = searchParams.get('productName') || undefined;
    const companyName = searchParams.get('companyName') || undefined;
    const nationalDrugCode = searchParams.get('nationalDrugCode') || undefined;
    const onlyUnmatched = searchParams.get('onlyUnmatched') === 'true';

    const result = await getTrackedDrugs({ page, pageSize, searchKeyword, productName, companyName, nationalDrugCode, onlyUnmatched });

    return NextResponse.json({
      success: true,
      data: result.data,
      pagination: {
        page,
        pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / pageSize),
      },
      summary: {
        unmatchedTotal: result.unmatchedTotal,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: '查询失败', error: String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const replace = searchParams.get('replace') === 'true';
    const body = await request.json();
    
    // 如果是数组，则批量插入；如果是对象，则包装为数组
    const data = Array.isArray(body) ? body : [body];

    const result = replace
      ? await replaceTrackedDrugs(data)
      : await insertTrackedDrugs(data);
    return NextResponse.json({ success: true, count: result.count });
  } catch (error) {
    return NextResponse.json({ success: false, message: '保存失败', error: String(error) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ success: false, message: '缺少参数 ID' }, { status: 400 });
    }

    const updates = await request.json();
    await updateTrackedDrug(id, updates);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, message: '更新失败', error: String(error) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ success: false, message: '缺少参数 ID' }, { status: 400 });
    }

    await deleteTrackedDrug(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, message: '删除失败', error: String(error) }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { exportMergedDrugData } from '@/lib/merged-drug-service';
import type { MergedDrugInfo } from '@/components/drug/types';

/**
 * 药品汇总表导出接口（Excel）
 * GET /api/merged/drugs/export
 */
export async function GET(request: NextRequest) {
  try {
    const searchKeyword = request.nextUrl.searchParams.get('search') || undefined;
    const allData = await exportMergedDrugData({ searchKeyword });

    if (allData.length === 0) {
      return NextResponse.json(
        { success: false, message: '没有可导出的数据' },
        { status: 400 }
      );
    }

    // 来源标签映射
    const sourceMap: Record<string, string> = {
      gd_only: '仅广东医保',
      gz_only: '仅广州采购',
      both: '双源匹配',
    };

    // 将数据映射为 Excel 工作表格式
    const worksheetData = (allData as MergedDrugInfo[]).map((item, index) => ({
      '序号': index + 1,
      '产品名称': item.product_name,
      '医保编码': item.national_drug_code ?? '',
      '剂型': item.dosform ?? '',
      '生产企业': item.company_name ?? '',
      '规格': item.spec ?? '',
      '最小包装数量': item.min_pac_quantity ?? '',
      '最小包装单位': item.min_pac_unit ?? '',
      '最小计量单位': item.min_measure_unit ?? '',
      '药品挂网类别': item.drug_net_type ?? '',
      '挂网时间': item.net_time ?? '',
      '医保甲乙类': item.medicare_type_label ?? '',
      '包装材料': item.package_material ?? '',
      '省平台挂网价格(元)': item.gd_price ?? '',
      'GPO挂网价格(元)': item.gz_bid_price ?? '',
      'GPO挂网最小规格价格(元)': item.gz_min_unit_price ?? '',
      '数据来源': sourceMap[item.source] ?? item.source,
    }));

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(worksheetData);

    // 设置列宽
    worksheet['!cols'] = [
      { wch: 6 },   // 序号
      { wch: 30 },  // 产品名称
      { wch: 22 },  // 医保编码
      { wch: 14 },  // 剂型
      { wch: 32 },  // 生产企业
      { wch: 24 },  // 规格
      { wch: 14 },  // 最小包装数量
      { wch: 14 },  // 最小包装单位
      { wch: 14 },  // 最小计量单位
      { wch: 16 },  // 药品挂网类别
      { wch: 20 },  // 挂网时间
      { wch: 12 },  // 医保甲乙类
      { wch: 20 },  // 包装材料
      { wch: 18 },  // 省平台挂网价格
      { wch: 16 },  // GPO挂网价格
      { wch: 22 },  // GPO挂网最小规格价格
      { wch: 14 },  // 数据来源
    ];

    XLSX.utils.book_append_sheet(workbook, worksheet, '药品汇总表');

    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const filename = `药品汇总表-${ts}.xlsx`;

    return new NextResponse(excelBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      },
    });
  } catch (error) {
    console.error('[API] 药品汇总表导出错误:', error);
    return NextResponse.json(
      {
        success: false,
        message: '导出失败',
        error: error instanceof Error ? error.message : '未知错误',
      },
      { status: 500 }
    );
  }
}

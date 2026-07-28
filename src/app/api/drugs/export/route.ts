import { NextRequest } from 'next/server';
import { exportDrugData } from '@/lib/drug-scraper';
import { parseDrugFilterParams } from '@/lib/api/drug-query-params';
import { jsonError } from '@/lib/api/responses';
import { buildExcelResponse, exportTimestamp } from '@/lib/api/excel-export';

export async function GET(request: NextRequest) {
  try {
    const filters = parseDrugFilterParams(request.nextUrl.searchParams);

    // 导出数据（支持筛选参数）
    const data = await exportDrugData(filters);

    if (data.length === 0) {
      return jsonError('没有可导出的数据', 400);
    }

    // 转换数据为工作表格式 - 完整字段（与API返回一致，共25个API字段）
    const worksheetData = data.map((item, index) => ({
      '序号': index + 1,
      '产品名称(productName)': item.product_name || '',
      '商品名(goodsName)': item.goods_name || '',
      '剂型(medicinemodel)': item.medicinemodel || '',
      '规格(outlook)': item.outlook || '',
      '生产企业(companyNameSc)': item.company_name_sc || '',
      '中标价(元)(bidPrice)': item.bid_price || '',
      '最小单位价(元)(minUnitPrice)': item.min_unit_price || '',
      '最高挂网价(元)(maxListingPrice)': item.max_listing_price || '',
      '单位(unit)': item.unit || '',
      '最小规格(minUnit)': item.min_unit || '',
      '数量(factor)': item.factor || '',
      '费率(fsRate)': item.fs_rate || '',
      '药品挂网类别(sourceType)': item.source_type || '',
      '采购方式(purchaseType)': item.purchase_type || '',
      '甲乙类(medicareType)': item.medicare_type === 0 ? '甲类' : item.medicare_type === 1 ? '乙类' : item.medicare_type === 2 ? '非医保' : item.medicare_type || '',
      '医保编码(nationalDrugCode)': item.national_drug_code || '',
      '商品ID(goodsId)': item.goods_id || '',
      '采购目录ID(procurecatalogId)': item.procurecatalog_id || '',
      '规格ID(unitId)': item.unit_id || '',
      '材料名称(materialName)': item.material_name || '',
      '规格单位数值(outlookUnit)': item.outlook_unit || '',
      '商品状态(isOutStock)': item.is_out_stock === 1 ? '停用' : '正常',
      '隐藏价格标志(hiddenPriceFlag)': item.hidden_price_flag === 1 ? '是' : '否',
      '活跃分区标志(subareaFlag)': item.subarea_flag === 1 ? '是' : '否',
      '挂网时间(netTime)': item.net_time || '',
      '价格形成时间(priceFormationTime)': item.price_formation_time || '',
      '创建时间': item.created_at || '',
      '更新时间': item.updated_at || '',
    }));
    
    // 设置列宽
    const colWidths = [
      { wch: 6 },   // 序号
      { wch: 30 },  // 产品名称
      { wch: 15 },  // 商品名
      { wch: 12 },  // 剂型
      { wch: 25 },  // 规格
      { wch: 35 },  // 生产企业
      { wch: 15 },  // 中标价
      { wch: 15 },  // 最小单位价
      { wch: 15 },  // 最高挂网价
      { wch: 8 },   // 单位
      { wch: 10 },  // 最小规格
      { wch: 10 },  // 数量
      { wch: 10 },  // 费率
      { wch: 12 },  // 药品挂网类别
      { wch: 12 },  // 采购方式
      { wch: 12 },  // 甲乙类
      { wch: 25 },  // 医保编码
      { wch: 12 },  // 商品ID
      { wch: 12 },  // 采购目录ID
      { wch: 15 },  // 规格ID
      { wch: 35 },  // 材料名称
      { wch: 12 },  // 规格单位数值
      { wch: 10 },  // 商品状态
      { wch: 12 },  // 隐藏价格标志
      { wch: 12 },  // 活跃分区标志
      { wch: 20 },  // 挂网时间
      { wch: 20 },  // 价格形成时间
      { wch: 20 },  // 创建时间
      { wch: 20 },  // 更新时间
    ];

    // 文件名格式：广州药品采购平台-YYMMDD-HHMMSS.xlsx
    return buildExcelResponse({
      rows: worksheetData,
      sheetName: '药品信息',
      colWidths,
      filename: `广州药品采购平台-${exportTimestamp()}.xlsx`,
    });
  } catch (error) {
    console.error('[API] 导出错误:', error);
    return jsonError('导出失败', 500, error);
  }
}

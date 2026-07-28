import { NextRequest } from 'next/server';
import {
  getPubonlnDrugList,
  exportPubonlnDrugData,
  scrapePubonlnDrugInfo,
} from '@/lib/pubonln-scraper';
import { getProgress, resetProgress } from '@/lib/progress-manager';
import { parseDrugFilterParams, parsePaginationParams } from '@/lib/api/drug-query-params';
import { jsonError, pagedResponse } from '@/lib/api/responses';
import { buildExcelResponse, exportTimestamp } from '@/lib/api/excel-export';
import {
  createFetchHandler,
  createProgressHandlers,
  createSchedulerHandlers,
} from '@/lib/api/route-factories';
import { createModuleRoute } from '@/lib/api/module-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * 广东医保挂网药品（pubonln）页面模块路由
 * GET  /api/pubonln            - 挂网药品列表
 * GET  /api/pubonln/export     - 导出 Excel
 * POST /api/pubonln/fetch      - 触发抓取
 * GET/DELETE /api/pubonln/progress  - 抓取进度轮询 / 重置
 * GET/POST   /api/pubonln/scheduler - 调度器配置读取 / 更新
 */

async function getList(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const { page, pageSize } = parsePaginationParams(searchParams);
    const filters = parseDrugFilterParams(searchParams);

    const { data, total } = await getPubonlnDrugList({ page, pageSize, ...filters });

    return pagedResponse({ data, page, pageSize, total });
  } catch (error) {
    console.error('[API] 获取挂网药品列表失败:', error);
    return jsonError('获取数据失败', 500, error);
  }
}

async function exportExcel(request: NextRequest) {
  try {
    const filters = parseDrugFilterParams(request.nextUrl.searchParams);

    // 导出所有数据
    const data = await exportPubonlnDrugData(filters);

    if (data.length === 0) {
      return jsonError('没有可导出的数据', 400);
    }

    // 转换数据为工作表格式 - 完整字段
    const worksheetData = data.map((item, index) => ({
      '序号': index + 1,
      '全省交易状态': item.gw_active || '',
      '注册名称(通用名)': item.genname || '',
      '商品名': item.trade_name || '',
      '注册剂型': item.reg_dosform_name || '',
      '剂型名称': item.dosform_name || '',
      '注册规格': item.reg_spec_name || '',
      '包装材质': item.pacmatl || '',
      '规格属性': item.specification_properties || '',
      '上市许可持有人': item.listing_license_holder || '',
      '生产企业/厂商': item.prodentp_name || '',
      '申报企业名称': item.dcla_entp_name || '',
      '批准文号/注册证号': item.aprvno || '',
      '最小包装数量(转换比)': item.convrat || '',
      '最小计量单位': item.minunt_name || '',
      '最小包装单位': item.minpac_name || '',
      '挂网价格(元)': item.min_pac_pubonln_pric || '',
      '挂网时间': item.pubonln_time || '',
      '药品分类': item.drug_class || '',
      '政策属性': item.policy_att || '',
      '政策类别': item.drug_select_type || '',
      '质量层次': item.quality_lv || '',
      '是否国家基药': item.is_national_basic_drug || '',
      '是否短缺易短缺药品': item.is_shortage_drug || '',
      '编号': item.jyl_no || '',
      '2025版甲乙类': item.jyl_category || '',
      '失信等级': item.dishonesty_lv || '',
      '是否修复': item.dishonesty_stas || '',
      '价格风险提示': item.price_risk || '',
      '国家医保代码': item.drug_code || '',
      '招采系统ID': item.zc_spt_id || '',
      '是否暂停挂网/已撤网': item.stop_pubonln === 1 ? '是' : '否',
      '创建时间': item.created_at || '',
    }));

    // 设置列宽
    const colWidths = [
      { wch: 6 },   // 序号
      { wch: 12 },  // 全省交易状态
      { wch: 40 },  // 注册名称
      { wch: 15 },  // 商品名
      { wch: 12 },  // 注册剂型
      { wch: 15 },  // 剂型名称
      { wch: 40 },  // 注册规格
      { wch: 30 },  // 包装材质
      { wch: 15 },  // 规格属性
      { wch: 35 },  // 上市许可持有人
      { wch: 35 },  // 生产企业
      { wch: 35 },  // 申报企业
      { wch: 25 },  // 批准文号
      { wch: 15 },  // 最小包装数量
      { wch: 12 },  // 最小计量单位
      { wch: 12 },  // 最小包装单位
      { wch: 15 },  // 挂网价格
      { wch: 15 },  // 挂网时间
      { wch: 12 },  // 药品分类
      { wch: 15 },  // 政策属性
      { wch: 15 },  // 政策类别
      { wch: 12 },  // 质量层次
      { wch: 12 },  // 是否国家基药
      { wch: 15 },  // 是否短缺易短缺药品
      { wch: 10 },  // 编号
      { wch: 12 },  // 甲乙类
      { wch: 10 },  // 失信等级
      { wch: 10 },  // 是否修复
      { wch: 15 },  // 价格风险提示
      { wch: 25 },  // 国家医保代码
      { wch: 20 },  // 招采系统ID
      { wch: 15 },  // 是否暂停挂网
      { wch: 20 },  // 创建时间
    ];

    // 文件名格式：广东医保挂网药品-YYMMDD-HHMMSS.xlsx
    return buildExcelResponse({
      rows: worksheetData,
      sheetName: '挂网药品信息',
      colWidths,
      filename: `广东医保挂网药品-${exportTimestamp()}.xlsx`,
    });
  } catch (error) {
    console.error('[API] 导出挂网药品错误:', error);
    return jsonError('导出失败', 500, error);
  }
}

const fetchDrugs = createFetchHandler({
  source: 'gd_pubonln',
  run: () => scrapePubonlnDrugInfo(),
  toLogCounts: (result) => ({
    total_count: result.total,
    new_count: result.newCount,
    update_count: 0,
  }),
  toResponseData: (result) => ({
    total: result.total,
    newCount: result.newCount,
  }),
  errorLogPrefix: '[API] 挂网药品抓取错误:',
});

const progressHandlers = createProgressHandlers({
  getFn: () => getProgress('gd_pubonln'),
  resetFn: () => resetProgress('gd_pubonln'),
});

const schedulerHandlers = createSchedulerHandlers('gd_pubonln');

export const { GET, POST, PUT, DELETE } = createModuleRoute({
  '': { GET: getList },
  'export': { GET: exportExcel },
  'fetch': { POST: fetchDrugs },
  'progress': { GET: progressHandlers.GET, DELETE: progressHandlers.DELETE },
  'scheduler': { GET: schedulerHandlers.GET, POST: schedulerHandlers.POST },
});

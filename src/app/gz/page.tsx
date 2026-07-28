'use client';

import { useDrugModule } from '@/components/drug/hooks';
import { DrugModulePageLayout } from '@/components/drug/DrugModulePageLayout';
import { GzDrugTable } from '@/components/drug/GzDrugTable';
import type { DrugInfo } from '@/components/drug/types';

/** 广州药品采购平台 API 配置 */
const GZ_API_CONFIG = {
  drugsApi: '/api/drugs',
  schedulerApi: '/api/scheduler',
  progressApi: '/api/drugs/progress',
  fetchApi: '/api/drugs/fetch',
  exportApi: '/api/drugs/export',
  defaultExportFilename: '药品信息.xlsx',
};

/** 广州平台使用说明 */
const GZ_INSTRUCTIONS = [
  '**手动抓取**：点击"手动抓取"按钮立即从广州药品采购平台获取最新数据',
  '**实时进度**：抓取过程中实时显示进度条、已处理条数、新增/更新数量',
  '**展开详情**：点击行首的展开按钮查看完整字段信息',
  '**多条件筛选**：支持关键字、生产企业、医保类别、挂网类别、医保编码等多条件组合查询',
  '**导出数据**：点击"导出 Excel"按钮将当前筛选结果下载为 Excel 文件',
];

/**
 * 广州药品采购平台页面
 * 提供广州公共资源交易中心药品采购公示信息的抓取、查询和管理功能
 */
export default function GzDrugPage() {
  const module = useDrugModule<DrugInfo>(GZ_API_CONFIG);

  return (
    <DrugModulePageLayout
      title="广州药品采购平台"
      description="广州公共资源交易中心药品采购公示信息抓取与管理"
      searchPlaceholder="搜索药品名称、商品名或生产企业..."
      instructions={GZ_INSTRUCTIONS}
      sourceUrl="https://gpo.gzggzy.cn/webPortal/publicity/toNotice.html"
      sourceName="广州药品采购平台公示信息"
      module={module}
      renderTable={(m) => (
        <GzDrugTable
          drugs={m.drugs}
          pagination={m.pagination}
          loading={m.loading}
          expandedRows={m.expandedRows}
          onToggleRowExpand={m.toggleRowExpand}
          onPageChange={m.handlePageChange}
          formatPrice={m.formatPrice}
        />
      )}
    />
  );
}

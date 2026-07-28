'use client';

import { useDrugModule } from '@/components/drug/hooks';
import { DrugModulePageLayout } from '@/components/drug/DrugModulePageLayout';
import { GdDrugTable } from '@/components/drug/GdDrugTable';
import type { PubonlnDrugInfo } from '@/components/drug/types';

/** 广东省医保局 API 配置 */
const GD_API_CONFIG = {
  drugsApi: '/api/pubonln',
  schedulerApi: '/api/pubonln/scheduler',
  progressApi: '/api/pubonln/progress',
  fetchApi: '/api/pubonln/fetch',
  exportApi: '/api/pubonln/export',
  defaultExportFilename: '挂网药品信息.xlsx',
};

/** 广东医保使用说明 */
const GD_INSTRUCTIONS = [
  '**手动抓取**：点击"手动抓取"按钮立即从广东省医疗保障局获取最新挂网药品数据',
  '**实时进度**：抓取过程中实时显示进度条、已处理条数',
  '**展开详情**：点击行首的展开按钮查看完整字段信息',
  '**多条件筛选**：支持关键字、上市许可持有人、甲乙类、药品分类、医保编码等多条件组合查询',
  '**导出数据**：点击"导出 Excel"按钮将所有数据下载为 Excel 文件',
];

/**
 * 广东省医保局挂网药品页面
 * 提供广东省医疗保障局挂网药品公示信息的抓取、查询和管理功能
 */
export default function PubonlnDrugPage() {
  const module = useDrugModule<PubonlnDrugInfo>(GD_API_CONFIG);

  return (
    <DrugModulePageLayout
      title="广东省医保局挂网药品"
      description="广东省医疗保障局挂网药品公示信息抓取与管理"
      searchPlaceholder="搜索通用名、商品名或上市许可持有人..."
      instructions={GD_INSTRUCTIONS}
      sourceUrl="https://igi.hsa.gd.gov.cn/tps/tps_public/publicity/listPubonlnPublicityD"
      sourceName="广东省医疗保障局挂网药品公示"
      module={module}
      renderTable={(m) => (
        <GdDrugTable
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

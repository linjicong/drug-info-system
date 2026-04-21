'use client';

import { Toaster } from 'sonner';
import { useDrugModule } from '@/components/drug/hooks';
import { FetchProgressCard } from '@/components/drug/FetchProgressCard';
import { SearchCard, type FilterFieldConfig } from '@/components/drug/SearchCard';
import { StatsCard } from '@/components/drug/StatsCard';
import { ActionBar } from '@/components/drug/ActionBar';
import { UsageGuide } from '@/components/drug/UsageGuide';
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

  /** 广州平台筛选字段配置 */
  const GZ_FILTER_FIELDS: FilterFieldConfig[] = [
    {
      key: 'productName',
      label: '产品名称',
      type: 'input',
      placeholder: '输入产品名称',
    },
    {
      key: 'nationalDrugCode',
      label: '医保编码',
      type: 'input',
      placeholder: '输入医保编码',
    },
    {
      key: 'companyName',
      label: '生产企业',
      type: 'input',
      placeholder: '输入生产企业名称',
    },
    {
      key: 'minPacQuantity',
      label: '最小包装数量',
      type: 'input',
      placeholder: '输入最小包装数量',
    },
    {
      key: 'minMeasureUnit',
      label: '最小计量单位',
      type: 'input',
      placeholder: '输入最小计量单位',
    },
  ];

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
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <Toaster position="top-right" />

      {/* 页面标题 */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          广州药品采购平台
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          广州公共资源交易中心药品采购公示信息抓取与管理
        </p>
      </div>

      {/* 抓取进度卡片 */}
      <FetchProgressCard
        progress={module.progress}
        progressPercent={module.progressPercent}
        formatDuration={module.formatDuration}
      />

      {/* 搜索筛选区域 */}
      <div className="mb-6">
        <SearchCard
          searchKeyword={module.searchKeyword}
          onSearchKeywordChange={module.setSearchKeyword}
          onSearch={module.handleSearch}
          onReset={module.handleReset}
          loading={module.loading}
          placeholder="搜索药品名称、商品名或生产企业..."
          filterFields={GZ_FILTER_FIELDS}
          filterValues={module.filterValues}
          onFilterChange={module.handleFilterChange}
        />
      </div>

      {/* 数据统计 */}
      <StatsCard
        pagination={module.pagination}
        schedulerConfig={module.schedulerConfig}
      />

      {/* 操作按钮 */}
      <ActionBar
        fetchStatus={module.progress.status}
        exporting={module.exporting}
        total={module.pagination.total}
        onFetch={module.handleFetch}
        onExport={module.handleExport}
      />

      {/* 数据表格 */}
      <GzDrugTable
        drugs={module.drugs}
        pagination={module.pagination}
        loading={module.loading}
        expandedRows={module.expandedRows}
        onToggleRowExpand={module.toggleRowExpand}
        onPageChange={module.handlePageChange}
        formatPrice={module.formatPrice}
      />

      {/* 使用说明 */}
      <UsageGuide
        instructions={GZ_INSTRUCTIONS}
        sourceUrl="https://gpo.gzggzy.cn/webPortal/publicity/toNotice.html"
        sourceName="广州药品采购平台公示信息"
      />
    </div>
  );
}

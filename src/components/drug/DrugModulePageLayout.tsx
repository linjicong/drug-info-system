'use client';

import type { ReactNode } from 'react';
import { Toaster } from 'sonner';
import { SearchCard } from './SearchCard';
import { FetchProgressCard } from './FetchProgressCard';
import { StatsCard } from './StatsCard';
import { ActionBar } from './ActionBar';
import { UsageGuide } from './UsageGuide';
import { DRUG_FILTER_FIELDS } from './filter-fields';
import type { useDrugModule } from './hooks';

export interface DrugModulePageLayoutProps<T extends { id: string }> {
  /** 页面标题 */
  title: string;
  /** 页面副标题描述 */
  description: string;
  /** 搜索框占位文案 */
  searchPlaceholder: string;
  /** 使用说明条目 */
  instructions: string[];
  /** 数据来源链接 */
  sourceUrl: string;
  /** 数据来源名称 */
  sourceName: string;
  /** useDrugModule 返回的模块状态与操作 */
  module: ReturnType<typeof useDrugModule<T>>;
  /** 数据表格插槽（各模块列结构不同） */
  renderTable: (module: ReturnType<typeof useDrugModule<T>>) => ReactNode;
}

/**
 * 药品模块页面骨架
 * gz / pubonln 页面共用：标题 → 进度卡 → 搜索 → 统计 → 操作栏 → 表格 → 使用说明
 */
export function DrugModulePageLayout<T extends { id: string }>({
  title,
  description,
  searchPlaceholder,
  instructions,
  sourceUrl,
  sourceName,
  module,
  renderTable,
}: DrugModulePageLayoutProps<T>) {
  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <Toaster position="top-right" />

      {/* 页面标题 */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          {title}
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          {description}
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
          placeholder={searchPlaceholder}
          filterFields={DRUG_FILTER_FIELDS}
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
      {renderTable(module)}

      {/* 使用说明 */}
      <UsageGuide
        instructions={instructions}
        sourceUrl={sourceUrl}
        sourceName={sourceName}
      />
    </div>
  );
}

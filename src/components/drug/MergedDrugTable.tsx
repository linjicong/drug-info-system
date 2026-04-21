'use client';

import { Fragment } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PaginationBar } from './PaginationBar';
import { TableLoadingState, TableEmptyState, ExpandButton, ExpandedRowWrapper } from './TableCommon';
import type { MergedDrugInfo, PaginationInfo } from './types';

interface MergedDrugTableProps {
  /** 整合药品数据列表 */
  drugs: MergedDrugInfo[];
  /** 分页信息 */
  pagination: PaginationInfo;
  /** 是否加载中 */
  loading: boolean;
  /** 展开行集合 */
  expandedRows: Set<string>;
  /** 切换行展开/收起回调 */
  onToggleRowExpand: (id: string) => void;
  /** 页码切换回调 */
  onPageChange: (page: number) => void;
  /** 格式化价格函数 */
  formatPrice: (price?: number) => string;
}

/**
 * 数据来源 Badge 渲染
 */
function SourceBadge({ source }: { source: MergedDrugInfo['source'] }) {
  if (source === 'both') {
    return (
      <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border-purple-200">
        双源匹配
      </Badge>
    );
  }
  if (source === 'gd_only') {
    return (
      <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-200">
        广东医保
      </Badge>
    );
  }
  return (
    <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200">
      广州采购
    </Badge>
  );
}

/**
 * 整合药品数据表格组件
 * 展示合并后的统一字段，价格列按来源区分显示
 */
export function MergedDrugTable({
  drugs,
  pagination,
  loading,
  expandedRows,
  onToggleRowExpand,
  onPageChange,
  formatPrice,
}: MergedDrugTableProps) {
  return (
    <Card>
      <CardContent className="p-0">
        {loading ? (
          <TableLoadingState />
        ) : drugs.length === 0 ? (
          <TableEmptyState hint="请确认两个数据源已完成抓取" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12"></TableHead>
                    <TableHead>产品名称</TableHead>
                    <TableHead>剂型</TableHead>
                    <TableHead>规格</TableHead>
                    <TableHead>生产企业</TableHead>
                    <TableHead>最小包装</TableHead>
                    <TableHead className="text-right">省平台挂网价格</TableHead>
                    <TableHead className="text-right">GPO挂网价格</TableHead>
                    <TableHead className="text-right">GPO最小规格价格</TableHead>
                    <TableHead>医保甲乙类</TableHead>
                    <TableHead>数据来源</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {drugs.map((drug) => {
                    const isExpanded = expandedRows.has(drug.id);
                    return (
                      <Fragment key={drug.id}>
                        <TableRow className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
                          {/* 展开按钮 */}
                          <TableCell>
                            <ExpandButton
                              isExpanded={isExpanded}
                              onClick={() => onToggleRowExpand(drug.id)}
                            />
                          </TableCell>

                          {/* 产品名称 */}
                          <TableCell className="font-medium text-blue-600 dark:text-blue-400 max-w-[180px] truncate" title={drug.product_name}>
                            {drug.product_name}
                          </TableCell>

                          {/* 剂型 */}
                          <TableCell>{drug.dosform || '-'}</TableCell>

                          {/* 规格 */}
                          <TableCell className="max-w-[160px] truncate" title={drug.spec || ''}>
                            {drug.spec || '-'}
                          </TableCell>

                          {/* 生产企业 */}
                          <TableCell className="max-w-[180px] truncate" title={drug.company_name || ''}>
                            {drug.company_name || '-'}
                          </TableCell>

                          {/* 最小包装（数量 + 单位） */}
                          <TableCell>
                            {drug.min_pac_quantity !== undefined && drug.min_pac_quantity !== ''
                              ? `${drug.min_pac_quantity} ${drug.min_pac_unit || ''}`
                              : drug.min_pac_unit || '-'}
                          </TableCell>

                          {/* 省平台挂网价格（广东医保来源） */}
                          <TableCell className="text-right font-medium text-emerald-600">
                            {drug.gd_price !== undefined ? formatPrice(drug.gd_price) : '-'}
                          </TableCell>

                          {/* GPO挂网价格（广州采购来源） */}
                          <TableCell className="text-right font-medium text-blue-600">
                            {drug.gz_bid_price !== undefined ? formatPrice(drug.gz_bid_price) : '-'}
                          </TableCell>

                          {/* GPO挂网最小规格价格 */}
                          <TableCell className="text-right">
                            {drug.gz_min_unit_price !== undefined ? formatPrice(drug.gz_min_unit_price) : '-'}
                          </TableCell>

                          {/* 医保甲乙类 */}
                          <TableCell>
                            {drug.medicare_type_label ? (
                              <Badge
                                variant={
                                  drug.medicare_type_label === '甲类'
                                    ? 'default'
                                    : drug.medicare_type_label === '乙类'
                                    ? 'secondary'
                                    : 'outline'
                                }
                              >
                                {drug.medicare_type_label}
                              </Badge>
                            ) : '-'}
                          </TableCell>

                          {/* 数据来源标识 */}
                          <TableCell>
                            <SourceBadge source={drug.source} />
                          </TableCell>
                        </TableRow>

                        {/* 展开详情行 */}
                        {isExpanded && (
                          <ExpandedRowWrapper colSpan={11}>
                                <div>
                                  <span className="text-gray-500">医保编码</span>
                                  <p className="font-mono truncate" title={drug.national_drug_code || ''}>
                                    {drug.national_drug_code || '-'}
                                  </p>
                                </div>
                                <div>
                                  <span className="text-gray-500">最小计量单位</span>
                                  <p>{drug.min_measure_unit || '-'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">药品挂网类别</span>
                                  <p>{drug.drug_net_type || '-'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">挂网时间</span>
                                  <p>{drug.net_time || '-'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">包装材料</span>
                                  <p className="truncate" title={drug.package_material || ''}>
                                    {drug.package_material || '-'}
                                  </p>
                                </div>
                                <div>
                                  <span className="text-gray-500">省平台挂网价格</span>
                                  <p className="font-medium text-emerald-600">
                                    {drug.gd_price !== undefined ? formatPrice(drug.gd_price) : '-'}
                                  </p>
                                </div>
                                <div>
                                  <span className="text-gray-500">GPO挂网价格(中标价)</span>
                                  <p className="font-medium text-blue-600">
                                    {drug.gz_bid_price !== undefined ? formatPrice(drug.gz_bid_price) : '-'}
                                  </p>
                                </div>
                                <div>
                                  <span className="text-gray-500">GPO挂网最小规格价格</span>
                                  <p>{drug.gz_min_unit_price !== undefined ? formatPrice(drug.gz_min_unit_price) : '-'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">数据来源</span>
                                  <div className="mt-1">
                                    <SourceBadge source={drug.source} />
                                  </div>
                                </div>
                              </ExpandedRowWrapper>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <PaginationBar pagination={pagination} onPageChange={onPageChange} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

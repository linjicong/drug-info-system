'use client';

import { Fragment } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PaginationBar } from './PaginationBar';
import { TableLoadingState, TableEmptyState, ExpandButton, ExpandedRowWrapper } from './TableCommon';
import type { DrugInfo, PaginationInfo } from './types';

interface GzDrugTableProps {
  /** 药品数据列表 */
  drugs: DrugInfo[];
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
 * 广州药品采购平台数据表格组件
 * 包含广州平台特有的列定义和展开详情内容
 */
export function GzDrugTable({
  drugs,
  pagination,
  loading,
  expandedRows,
  onToggleRowExpand,
  onPageChange,
  formatPrice,
}: GzDrugTableProps) {
  return (
    <Card>
      <CardContent className="p-0">
        {loading ? (
          <TableLoadingState />
        ) : drugs.length === 0 ? (
          <TableEmptyState hint="点击「手动抓取」按钮获取药品信息" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12"></TableHead>
                    <TableHead>产品名称</TableHead>
                    <TableHead>商品名</TableHead>
                    <TableHead>剂型</TableHead>
                    <TableHead>规格</TableHead>
                    <TableHead>生产企业</TableHead>
                    <TableHead className="text-right">中标价</TableHead>
                    <TableHead className="text-right">最小单位价</TableHead>
                    <TableHead>单位</TableHead>
                    <TableHead>来源类型</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {drugs.map((drug) => {
                    const isExpanded = expandedRows.has(drug.id);
                    return (
                      <Fragment key={drug.id}>
                        <TableRow className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
                          <TableCell>
                            <ExpandButton
                              isExpanded={isExpanded}
                              onClick={() => onToggleRowExpand(drug.id)}
                            />
                          </TableCell>
                          <TableCell className="font-medium text-blue-600 dark:text-blue-400">
                            {drug.product_name}
                          </TableCell>
                          <TableCell>{drug.goods_name || '-'}</TableCell>
                          <TableCell>{drug.medicinemodel || '-'}</TableCell>
                          <TableCell>{drug.outlook || '-'}</TableCell>
                          <TableCell>{drug.company_name_sc || '-'}</TableCell>
                          <TableCell className="text-right font-medium text-green-600">
                            {formatPrice(drug.bid_price)}
                          </TableCell>
                          <TableCell className="text-right">{formatPrice(drug.min_unit_price)}</TableCell>
                          <TableCell>{drug.unit || '-'}</TableCell>
                          <TableCell>
                            <Badge variant={drug.source_type === '省采中选' ? 'default' : 'secondary'}>
                              {drug.source_type || '-'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                        {isExpanded && (
                          <ExpandedRowWrapper colSpan={10}>
                                <div>
                                  <span className="text-gray-500">商品ID</span>
                                  <p className="font-mono">{drug.goods_id || '-'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">医保编码</span>
                                  <p className="font-mono">{drug.national_drug_code || '-'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">采购目录ID</span>
                                  <p className="font-mono">{drug.procurecatalog_id || '-'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">规格ID</span>
                                  <p className="font-mono">{drug.unit_id || '-'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">最小规格</span>
                                  <p>{drug.min_unit || '-'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">数量(转换因子)</span>
                                  <p>{drug.factor || '-'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">最高挂网价(元)</span>
                                  <p>{formatPrice(drug.max_listing_price)}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">费率</span>
                                  <p>{drug.fs_rate ?? '-'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">采购方式</span>
                                  <p>{drug.purchase_type === 1 ? '集中采购' : drug.purchase_type === 2 ? '其他' : drug.purchase_type || '-'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">甲乙类</span>
                                  <p>{drug.medicare_type === 0 ? '甲类' : drug.medicare_type === 1 ? '乙类' : drug.medicare_type === 2 ? '非医保' : drug.medicare_type ?? '-'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">材料名称</span>
                                  <p className="truncate" title={drug.material_name || ''}>{drug.material_name || '-'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">商品状态</span>
                                  <p>{drug.is_out_stock === 1 ? '停用' : '正常'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">隐藏价格</span>
                                  <p>{drug.hidden_price_flag === 1 ? '是' : '否'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">活跃分区</span>
                                  <p>{drug.subarea_flag === 1 ? '是' : '否'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">规格单位数值</span>
                                  <p>{drug.outlook_unit ?? '-'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">挂网时间</span>
                                  <p>{drug.net_time || '-'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">价格形成时间</span>
                                  <p>{drug.price_formation_time || '-'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">创建时间</span>
                                  <p>{new Date(drug.created_at).toLocaleString()}</p>
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

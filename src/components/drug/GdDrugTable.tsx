'use client';

import { Fragment } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PaginationBar } from './PaginationBar';
import { TableLoadingState, TableEmptyState, ExpandButton, ExpandedRowWrapper } from './TableCommon';
import type { PubonlnDrugInfo, PaginationInfo } from './types';

interface GdDrugTableProps {
  /** 挂网药品数据列表 */
  drugs: PubonlnDrugInfo[];
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
 * 广东省医保局挂网药品数据表格组件
 * 包含广东医保特有的列定义和展开详情内容
 */
export function GdDrugTable({
  drugs,
  pagination,
  loading,
  expandedRows,
  onToggleRowExpand,
  onPageChange,
  formatPrice,
}: GdDrugTableProps) {
  return (
    <Card>
      <CardContent className="p-0">
        {loading ? (
          <TableLoadingState />
        ) : drugs.length === 0 ? (
          <TableEmptyState hint="点击「手动抓取」按钮获取挂网药品信息" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12"></TableHead>
                    <TableHead>通用名</TableHead>
                    <TableHead>商品名</TableHead>
                    <TableHead>剂型</TableHead>
                    <TableHead>规格</TableHead>
                    <TableHead>上市许可持有人</TableHead>
                    <TableHead className="text-right">挂网价格</TableHead>
                    <TableHead>质量层次</TableHead>
                    <TableHead>政策属性</TableHead>
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
                            {drug.genname}
                          </TableCell>
                          <TableCell>{drug.trade_name || '-'}</TableCell>
                          <TableCell>{drug.dosform_name || '-'}</TableCell>
                          <TableCell className="max-w-xs truncate" title={drug.reg_spec_name || ''}>
                            {drug.reg_spec_name || '-'}
                          </TableCell>
                          <TableCell
                            className="max-w-xs truncate"
                            title={drug.listing_license_holder || ''}
                          >
                            {drug.listing_license_holder || '-'}
                          </TableCell>
                          <TableCell className="text-right font-medium text-green-600">
                            {formatPrice(drug.min_pac_pubonln_pric)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                drug.quality_lv === '参比制剂'
                                  ? 'default'
                                  : drug.quality_lv === '过评'
                                    ? 'secondary'
                                    : 'outline'
                              }
                            >
                              {drug.quality_lv || '-'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{drug.policy_att || '-'}</Badge>
                          </TableCell>
                        </TableRow>
                        {isExpanded && (
                          <ExpandedRowWrapper colSpan={9}>
                                <div>
                                  <span className="text-gray-500">药品ID</span>
                                  <p className="font-mono">{drug.drug_id || '-'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">医保编码</span>
                                  <p className="font-mono">{drug.drug_code || '-'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">批准文号</span>
                                  <p className="font-mono">{drug.aprvno || '-'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">生产企业</span>
                                  <p className="truncate" title={drug.prodentp_name || ''}>
                                    {drug.prodentp_name || '-'}
                                  </p>
                                </div>
                                <div>
                                  <span className="text-gray-500">申报企业</span>
                                  <p className="truncate" title={drug.dcla_entp_name || ''}>
                                    {drug.dcla_entp_name || '-'}
                                  </p>
                                </div>
                                <div>
                                  <span className="text-gray-500">最小单位</span>
                                  <p>{drug.minunt_name || '-'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">最小包装</span>
                                  <p>{drug.minpac_name || '-'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">转换系数</span>
                                  <p>{drug.convrat || '-'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">甲乙类</span>
                                  <p>{drug.jyl_category || '-'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">挂网时间</span>
                                  <p>{drug.pubonln_time || '-'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">活跃区状态</span>
                                  <p>{drug.gw_active || '-'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">包装材料</span>
                                  <p className="truncate" title={drug.pacmatl || ''}>
                                    {drug.pacmatl || '-'}
                                  </p>
                                </div>
                                <div>
                                  <span className="text-gray-500">注册剂型</span>
                                  <p>{drug.reg_dosform_name || '-'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">形成方式</span>
                                  <p>{drug.formation_mode || '-'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">停止挂网</span>
                                  <p>{drug.stop_pubonln === 1 ? '是' : '否'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">是否基药</span>
                                  <p>{drug.is_national_basic_drug || '-'}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500">是否短缺药</span>
                                  <p>{drug.is_shortage_drug || '-'}</p>
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

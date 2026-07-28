'use client';

import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableHeader } from '@/components/ui/table';
import { PaginationBar } from './PaginationBar';
import { TableLoadingState, TableEmptyState } from './TableCommon';
import type { PaginationInfo } from './types';

interface DrugTableShellProps<T extends { id: string }> {
  /** 药品数据列表 */
  drugs: T[];
  /** 分页信息 */
  pagination: PaginationInfo;
  /** 是否加载中 */
  loading: boolean;
  /** 空数据提示文案 */
  emptyHint: string;
  /** 页码切换回调 */
  onPageChange: (page: number) => void;
  /** 表头行（TableRow 及其列定义） */
  header: ReactNode;
  /** 单条数据行渲染（含展开详情行，需自带 key） */
  renderRow: (drug: T) => ReactNode;
}

/**
 * 药品数据表格外壳
 * 统一 Card 容器、加载态、空态、横向滚动与分页栏结构；
 * 列定义与行渲染由各表格组件通过 header / renderRow 提供
 */
export function DrugTableShell<T extends { id: string }>({
  drugs,
  pagination,
  loading,
  emptyHint,
  onPageChange,
  header,
  renderRow,
}: DrugTableShellProps<T>) {
  return (
    <Card>
      <CardContent className="p-0">
        {loading ? (
          <TableLoadingState />
        ) : drugs.length === 0 ? (
          <TableEmptyState hint={emptyHint} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>{header}</TableHeader>
                <TableBody>{drugs.map((drug) => renderRow(drug))}</TableBody>
              </Table>
            </div>

            <PaginationBar pagination={pagination} onPageChange={onPageChange} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

'use client';

import { Button } from '@/components/ui/button';
import { Loader2, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { TableCell, TableRow } from '@/components/ui/table';

/**
 * 表格加载状态组件
 */
export function TableLoadingState() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
    </div>
  );
}

/**
 * 表格空数据提示组件
 */
interface TableEmptyStateProps {
  /** 自定义提示文案，默认为"点击手动抓取按钮获取数据" */
  hint?: string;
}

export function TableEmptyState({ hint = '点击"手动抓取"按钮获取数据' }: TableEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-gray-500">
      <AlertCircle className="w-12 h-12 mb-4" />
      <p className="text-lg font-medium">暂无数据</p>
      <p className="text-sm mt-2">{hint}</p>
    </div>
  );
}

/**
 * 展开/收起按钮组件
 */
interface ExpandButtonProps {
  isExpanded: boolean;
  onClick: () => void;
}

export function ExpandButton({ isExpanded, onClick }: ExpandButtonProps) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick}>
      {isExpanded ? (
        <ChevronUp className="w-4 h-4" />
      ) : (
        <ChevronDown className="w-4 h-4" />
      )}
    </Button>
  );
}

/**
 * 展开详情行容器组件
 */
interface ExpandedRowWrapperProps {
  colSpan: number;
  children: React.ReactNode;
}

export function ExpandedRowWrapper({ colSpan, children }: ExpandedRowWrapperProps) {
  return (
    <TableRow className="bg-gray-50 dark:bg-gray-900">
      <TableCell colSpan={colSpan} className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-sm">
          {children}
        </div>
      </TableCell>
    </TableRow>
  );
}

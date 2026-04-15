'use client';

import { Button } from '@/components/ui/button';
import type { PaginationInfo } from './types';

interface PaginationBarProps {
  /** 分页信息 */
  pagination: PaginationInfo;
  /** 页码切换回调 */
  onPageChange: (page: number) => void;
}

/**
 * 分页控制栏组件
 * 展示当前页码信息和上一页/下一页按钮
 */
export function PaginationBar({ pagination, onPageChange }: PaginationBarProps) {
  if (pagination.totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between px-4 py-4 border-t">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        第 {pagination.page} / {pagination.totalPages} 页
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(pagination.page - 1)}
          disabled={pagination.page === 1}
        >
          上一页
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(pagination.page + 1)}
          disabled={pagination.page === pagination.totalPages}
        >
          下一页
        </Button>
      </div>
    </div>
  );
}

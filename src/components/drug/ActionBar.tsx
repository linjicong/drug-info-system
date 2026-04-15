'use client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Loader2,
  FileSpreadsheet,
  PlayCircle,
  PauseCircle,
} from 'lucide-react';

interface ActionBarProps {
  /** 抓取状态 */
  fetchStatus: 'idle' | 'running' | 'completed' | 'error';
  /** 是否正在导出 */
  exporting: boolean;
  /** 总记录数 */
  total: number;
  /** 手动抓取回调 */
  onFetch: () => void;
  /** 导出回调 */
  onExport: () => void;
  /** 自定义抓取按钮文本 */
  fetchText?: string;
}

/**
 * 操作按钮栏组件
 * 包含手动抓取/合并按钮、导出 Excel 按钮和记录数 Badge
 */
export function ActionBar({ fetchStatus, exporting, total, onFetch, onExport, fetchText }: ActionBarProps) {
  return (
    <div className="flex flex-wrap gap-4 mb-6">
      <Button
        onClick={onFetch}
        disabled={fetchStatus === 'running'}
        className="flex items-center gap-2"
      >
        {fetchStatus === 'running' ? (
          <>
            <PauseCircle className="w-4 h-4" />
            处理中...
          </>
        ) : (
          <>
            <PlayCircle className="w-4 h-4" />
            {fetchText || '手动抓取'}
          </>
        )}
      </Button>

      <Button
        onClick={onExport}
        disabled={exporting}
        variant="outline"
        className="flex items-center gap-2"
      >
        {exporting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            导出中...
          </>
        ) : (
          <>
            <FileSpreadsheet className="w-4 h-4" />
            导出 Excel
          </>
        )}
      </Button>

      <Badge variant="outline" className="flex items-center gap-2 py-2 px-4">
        共 {total.toLocaleString()} 条记录
      </Badge>
    </div>
  );
}

'use client';

import { ProgressCardShell } from './ProgressCardShell';
import type { FetchProgress } from './types';

interface FetchProgressCardProps {
  /** 抓取进度数据 */
  progress: FetchProgress;
  /** 进度百分比 */
  progressPercent: number;
  /** 格式化耗时函数 */
  formatDuration: () => string;
}

/**
 * 抓取进度卡片组件
 * 实时展示数据抓取的进度、状态和统计信息
 */
export function FetchProgressCard({ progress, progressPercent, formatDuration }: FetchProgressCardProps) {
  return (
    <ProgressCardShell
      status={progress.status}
      cardClassNames={{
        running: 'border-blue-500 bg-blue-50 dark:bg-blue-950',
        completed: 'border-green-500 bg-green-50 dark:bg-green-950',
        error: 'border-red-500 bg-red-50 dark:bg-red-950',
      }}
      titles={{
        running: '正在抓取数据...',
        completed: '抓取完成',
        error: '抓取出错',
      }}
      spinnerClassName="text-blue-600"
      percent={progressPercent}
      progressLabel={<span>进度: {progress.processedCount} / {progress.totalCount} 条</span>}
      error={progress.error}
      errorClassName="text-sm text-red-600 bg-red-100 dark:bg-red-900/50 p-2 rounded"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <span className="text-gray-500 dark:text-gray-400">当前页</span>
          <p className="font-medium">{progress.currentPage} / {progress.totalPages}</p>
        </div>
        <div>
          <span className="text-gray-500 dark:text-gray-400">新增</span>
          <p className="font-medium text-green-600">{progress.newCount} 条</p>
        </div>
        <div>
          <span className="text-gray-500 dark:text-gray-400">更新</span>
          <p className="font-medium text-blue-600">{progress.updateCount} 条</p>
        </div>
        <div>
          <span className="text-gray-500 dark:text-gray-400">耗时</span>
          <p className="font-medium">{formatDuration()}</p>
        </div>
      </div>
    </ProgressCardShell>
  );
}

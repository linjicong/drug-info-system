'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
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
  if (progress.status === 'idle') return null;

  return (
    <Card className={`mb-6 ${
      progress.status === 'running' ? 'border-blue-500 bg-blue-50 dark:bg-blue-950' :
      progress.status === 'completed' ? 'border-green-500 bg-green-50 dark:bg-green-950' :
      progress.status === 'error' ? 'border-red-500 bg-red-50 dark:bg-red-950' : ''
    }`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          {progress.status === 'running' && (
            <>
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
              <span>正在抓取数据...</span>
            </>
          )}
          {progress.status === 'completed' && (
            <>
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              <span>抓取完成</span>
            </>
          )}
          {progress.status === 'error' && (
            <>
              <AlertCircle className="w-5 h-5 text-red-600" />
              <span>抓取出错</span>
            </>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>进度: {progress.processedCount} / {progress.totalCount} 条</span>
            <span>{progressPercent}%</span>
          </div>
          <Progress value={progressPercent} className="h-3" />
        </div>

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

        {progress.status === 'error' && progress.error && (
          <div className="text-sm text-red-600 bg-red-100 dark:bg-red-900/50 p-2 rounded">
            错误: {progress.error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

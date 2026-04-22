'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import type { MergeProgress } from '@/lib/merged-progress-manager';
import { Progress } from '@/components/ui/progress';

interface MergeProgressCardProps {
  progress: MergeProgress;
  formatDuration: () => string;
}

/**
 * 整合同步任务进度卡片组件
 */
export function MergeProgressCard({ progress, formatDuration }: MergeProgressCardProps) {
  if (progress.status === 'idle') return null;

  const isStageLoad = progress.phase.includes('查询广东') || progress.phase.includes('查询广州');
  const isStageMerge = progress.phase.includes('合并去重');
  const isStageWrite = progress.phase.includes('清空旧') || progress.phase.includes('写入');

  const currentStage = progress.status === 'completed'
    ? 4
    : isStageWrite
      ? 3
      : isStageMerge
        ? 2
        : 1;

  // 4 阶段进度百分比：1) 数据读取 2) 合并去重 3) 写入新表 4) 完成
  let percent = 0;
  if (progress.status === 'completed') percent = 100;
  else if (progress.status === 'running') {
    if (isStageLoad) {
      percent = progress.phase.includes('查询广州') ? 35 : 20;
    } else if (isStageMerge) {
      percent = 60;
    } else if (isStageWrite) {
      const writeRatio = progress.mergedTotal > 0 ? (progress.savedCount / progress.mergedTotal) : 0;
      percent = 70 + Math.floor(writeRatio * 25);
    }
  } else if (progress.status === 'error') {
    percent = currentStage >= 3 ? 85 : currentStage >= 2 ? 60 : 30;
  }

  return (
    <Card className={`mb-6 ${
      progress.status === 'running' ? 'border-purple-500 bg-purple-50 dark:bg-purple-950/30' :
      progress.status === 'completed' ? 'border-green-500 bg-green-50 dark:bg-green-950/30' :
      progress.status === 'error' ? 'border-red-500 bg-red-50 dark:bg-red-950/30' : ''
    }`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          {progress.status === 'running' && (
            <>
              <Loader2 className="w-5 h-5 animate-spin text-purple-600" />
              <span>正在整合数据... {progress.phase}</span>
            </>
          )}
          {progress.status === 'completed' && (
            <>
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              <span>合并同步完成</span>
            </>
          )}
          {progress.status === 'error' && (
            <>
              <AlertCircle className="w-5 h-5 text-red-600" />
              <span>合并且同步出错</span>
            </>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>处理进度</span>
            <span>{percent}%</span>
          </div>
          <Progress value={percent} className="h-3" />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          {['1. 数据读取', '2. 合并去重', '3. 写入新表', '4. 完成'].map((label, index) => {
            const stageNumber = index + 1;
            const active = currentStage === stageNumber && progress.status === 'running';
            const done = currentStage > stageNumber || progress.status === 'completed';
            return (
              <div
                key={label}
                className={`rounded-md border px-2 py-1 text-center ${
                  active ? 'border-purple-400 bg-purple-100 text-purple-700' :
                  done ? 'border-green-400 bg-green-100 text-green-700' :
                  'border-slate-200 bg-white text-slate-500'
                }`}
              >
                {label}
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
          <div>
            <span className="text-gray-500 dark:text-gray-400">广东数据</span>
            <p className="font-medium text-emerald-600 dark:text-emerald-400">{progress.gdLoaded} 条</p>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">广州数据</span>
            <p className="font-medium text-blue-600 dark:text-blue-400">{progress.gzLoaded} 条</p>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">合并去重后</span>
            <p className="font-medium text-purple-600 dark:text-purple-400">{progress.mergedTotal} 条</p>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">已写入新表</span>
            <p className="font-medium text-amber-600 dark:text-amber-400">{progress.savedCount} 条</p>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">耗时</span>
            <p className="font-medium">{formatDuration()}</p>
          </div>
        </div>

        {progress.status === 'error' && progress.error && (
          <div className="text-sm text-red-600 bg-red-100 dark:bg-red-900/50 p-3 rounded-md font-mono mt-2">
            错误: {progress.error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

'use client';

import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

type ProgressStatus = 'idle' | 'running' | 'completed' | 'error';

export interface ProgressCardShellProps {
  /** 进度状态（idle 时不渲染） */
  status: ProgressStatus;
  /** 三态卡片着色 className */
  cardClassNames: { running: string; completed: string; error: string };
  /** 三态标题文案（running 可含动态内容） */
  titles: { running: ReactNode; completed: ReactNode; error: ReactNode };
  /** running 态加载图标颜色 className */
  spinnerClassName: string;
  /** 进度百分比 */
  percent: number;
  /** 进度条左侧标签 */
  progressLabel: ReactNode;
  /** 进度条与错误块之间的内容（统计网格 / 阶段指示器） */
  children: ReactNode;
  /** 错误信息（error 态且非空时展示） */
  error: string | null;
  /** 错误块 className */
  errorClassName: string;
}

/**
 * 进度卡片外壳
 * 统一三态着色边框、三态标题行、进度条与错误信息块的结构
 */
export function ProgressCardShell({
  status,
  cardClassNames,
  titles,
  spinnerClassName,
  percent,
  progressLabel,
  children,
  error,
  errorClassName,
}: ProgressCardShellProps) {
  if (status === 'idle') return null;

  return (
    <Card className={`mb-6 ${
      status === 'running' ? cardClassNames.running :
      status === 'completed' ? cardClassNames.completed :
      status === 'error' ? cardClassNames.error : ''
    }`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          {status === 'running' && (
            <>
              <Loader2 className={`w-5 h-5 animate-spin ${spinnerClassName}`} />
              <span>{titles.running}</span>
            </>
          )}
          {status === 'completed' && (
            <>
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              <span>{titles.completed}</span>
            </>
          )}
          {status === 'error' && (
            <>
              <AlertCircle className="w-5 h-5 text-red-600" />
              <span>{titles.error}</span>
            </>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            {progressLabel}
            <span>{percent}%</span>
          </div>
          <Progress value={percent} className="h-3" />
        </div>

        {children}

        {status === 'error' && error && (
          <div className={errorClassName}>
            错误: {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

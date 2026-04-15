'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { PaginationInfo, SchedulerConfig } from './types';

interface StatsCardProps {
  /** 分页信息 */
  pagination: PaginationInfo;
  /** 调度器配置（用于获取最新数据时间和运行状态） */
  schedulerConfig: SchedulerConfig;
}

/**
 * 数据统计卡片组件
 * 展示总记录数、当前页、最新数据时间和运行状态
 */
export function StatsCard({ pagination, schedulerConfig }: StatsCardProps) {
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-lg">数据统计</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <span className="text-gray-500 dark:text-gray-400">总记录数</span>
            <p className="text-2xl font-bold text-blue-600">{pagination.total.toLocaleString()}</p>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">当前页</span>
            <p className="text-2xl font-bold">{pagination.page} / {pagination.totalPages}</p>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">最新数据时间</span>
            <p className="text-lg font-medium">
              {schedulerConfig.latestDataTime
                ? new Date(schedulerConfig.latestDataTime).toLocaleString()
                : '-'}
            </p>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">运行状态</span>
            <p className="text-lg font-medium">
              <Badge variant={schedulerConfig.runningStatus === 'running' ? 'default' : 'secondary'}>
                {schedulerConfig.runningStatus === 'running' ? '抓取中' : '空闲'}
              </Badge>
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

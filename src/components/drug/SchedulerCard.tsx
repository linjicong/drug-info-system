'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Clock } from 'lucide-react';
import type { SchedulerConfig } from './types';

interface SchedulerCardProps {
  /** 调度器配置 */
  config: SchedulerConfig;
  /** 是否加载中 */
  configLoading: boolean;
  /** 更新配置回调 */
  onUpdateConfig: (updates: { enabled?: boolean; intervalMinutes?: number }) => void;
  /** Switch 和 Label 的唯一 ID 前缀（避免多实例冲突） */
  idPrefix?: string;
}

/**
 * 定时抓取配置卡片组件
 * 提供启用/关闭定时抓取和调整间隔的控制
 */
export function SchedulerCard({
  config,
  configLoading,
  onUpdateConfig,
  idPrefix = 'auto-fetch',
}: SchedulerCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Clock className="w-5 h-5" />
          定时抓取
          {config.isRunning && (
            <Badge variant="default" className="ml-2">运行中</Badge>
          )}
        </CardTitle>
        <CardDescription>
          后端定时任务，页面关闭后仍会继续执行
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch
                id={idPrefix}
                checked={config.enabled}
                onCheckedChange={(enabled) => onUpdateConfig({ enabled })}
                disabled={configLoading}
              />
              <Label htmlFor={idPrefix} className="font-medium">
                启用定时抓取
              </Label>
            </div>
            {config.enabled && (
              <Select
                value={String(config.intervalMinutes)}
                onValueChange={(value) => onUpdateConfig({ intervalMinutes: parseInt(value) })}
                disabled={configLoading}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 分钟</SelectItem>
                  <SelectItem value="60">1 小时</SelectItem>
                  <SelectItem value="120">2 小时</SelectItem>
                  <SelectItem value="360">6 小时</SelectItem>
                  <SelectItem value="720">12 小时</SelectItem>
                  <SelectItem value="1440">24 小时</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
        <div className="mt-3 space-y-1 text-sm text-gray-600 dark:text-gray-400">
          {config.nextRunAt && (
            <p>下次执行时间: {new Date(config.nextRunAt).toLocaleString()}</p>
          )}
          {config.lastRunAt && (
            <p>
              上次执行: {new Date(config.lastRunAt).toLocaleString()}
              {config.lastRunStatus && (
                <Badge
                  variant={config.lastRunStatus === 'success' ? 'default' : 'destructive'}
                  className="ml-2"
                >
                  {config.lastRunStatus === 'success' ? '成功' : '失败'}
                </Badge>
              )}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

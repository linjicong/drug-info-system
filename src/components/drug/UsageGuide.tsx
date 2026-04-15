'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2 } from 'lucide-react';

interface UsageGuideProps {
  /** 使用说明列表 */
  instructions: string[];
  /** 数据来源链接 */
  sourceUrl: string;
  /** 数据来源名称 */
  sourceName: string;
}

/**
 * 使用说明卡片组件
 * 展示操作说明和数据来源信息
 */
export function UsageGuide({ instructions, sourceUrl, sourceName }: UsageGuideProps) {
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-green-600" />
          使用说明
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-gray-600 dark:text-gray-400 space-y-2">
        {instructions.map((text, index) => (
          <p key={index}>{index + 1}. {text}</p>
        ))}
        <p className="mt-4 text-xs">
          数据来源：
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            {sourceName}
          </a>
        </p>
      </CardContent>
    </Card>
  );
}

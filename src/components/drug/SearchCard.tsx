'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';

interface SearchCardProps {
  /** 搜索关键字 */
  searchKeyword: string;
  /** 更新搜索关键字回调 */
  onSearchKeywordChange: (keyword: string) => void;
  /** 触发搜索回调 */
  onSearch: () => void;
  /** 是否加载中 */
  loading: boolean;
  /** 搜索框占位提示文本 */
  placeholder?: string;
}

/**
 * 搜索筛选卡片组件
 * 提供关键字搜索输入框和搜索按钮
 */
export function SearchCard({
  searchKeyword,
  onSearchKeywordChange,
  onSearch,
  loading,
  placeholder = '搜索药品名称...',
}: SearchCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Search className="w-5 h-5" />
          搜索筛选
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <Input
              placeholder={placeholder}
              value={searchKeyword}
              onChange={(e) => onSearchKeywordChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSearch()}
            />
          </div>
          <Button onClick={onSearch} disabled={loading}>
            搜索
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

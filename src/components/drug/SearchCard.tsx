'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, RotateCcw } from 'lucide-react';

/** 筛选字段配置 */
export interface FilterFieldConfig {
  /** 字段唯一标识 */
  key: string;
  /** 字段显示标签 */
  label: string;
  /** 字段类型：input=文本输入, select=下拉选择 */
  type: 'input' | 'select';
  /** 占位提示文本 */
  placeholder?: string;
  /** select 类型的选项列表 */
  options?: { label: string; value: string }[];
}

/** 筛选值映射类型 */
export type FilterValues = Record<string, string>;

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
  /** 额外筛选字段配置 */
  filterFields?: FilterFieldConfig[];
  /** 额外筛选字段当前值 */
  filterValues?: FilterValues;
  /** 更新筛选字段值回调 */
  onFilterChange?: (key: string, value: string) => void;
  /** 重置筛选回调 */
  onReset?: () => void;
}

/**
 * 搜索筛选卡片组件
 * 提供关键字搜索、多条件筛选输入和搜索/重置按钮
 */
export function SearchCard({
  searchKeyword,
  onSearchKeywordChange,
  onSearch,
  loading,
  placeholder = '搜索药品名称...',
  filterFields = [],
  filterValues = {},
  onFilterChange,
  onReset,
}: SearchCardProps) {
  /** 处理 Enter 键触发搜索 */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onSearch();
  };

  /** 渲染单个筛选字段 */
  const renderFilterField = (field: FilterFieldConfig) => {
    if (field.type === 'select') {
      return (
        <div key={field.key} className="flex flex-col gap-1.5">
          <Label className="text-sm text-gray-600 dark:text-gray-400">
            {field.label}
          </Label>
          <Select
            value={filterValues[field.key] || ''}
            onValueChange={(value) => onFilterChange?.(field.key, value)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={field.placeholder || '请选择'} />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    }

    return (
      <div key={field.key} className="flex flex-col gap-1.5">
        <Label className="text-sm text-gray-600 dark:text-gray-400">
          {field.label}
        </Label>
        <Input
          placeholder={field.placeholder || `请输入${field.label}`}
          value={filterValues[field.key] || ''}
          onChange={(e) => onFilterChange?.(field.key, e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Search className="w-5 h-5" />
          搜索筛选
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* 主搜索框 */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <Input
                placeholder={placeholder}
                value={searchKeyword}
                onChange={(e) => onSearchKeywordChange(e.target.value)}
                onKeyDown={handleKeyDown}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={onSearch} disabled={loading}>
                <Search className="w-4 h-4 mr-1" />
                搜索
              </Button>
              {onReset && (
                <Button variant="outline" onClick={onReset} disabled={loading}>
                  <RotateCcw className="w-4 h-4 mr-1" />
                  重置
                </Button>
              )}
            </div>
          </div>

          {/* 额外筛选条件 */}
          {filterFields.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {filterFields.map(renderFilterField)}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

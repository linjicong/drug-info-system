'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import type { PaginationInfo } from '../types';
import type { FilterValues } from '../SearchCard';
import { buildModuleQueryStorageKey, readModuleQueryState } from './storage';
import { trackEvent } from '@/lib/usage-tracker';

export interface UseDrugQueryOptions {
  /** 药品列表查询接口 */
  drugsApi: string;
  /** 导出接口 */
  exportApi: string;
  /** 无法从响应头解析文件名时的兜底文件名 */
  defaultExportFilename: string;
  /** 查询条件持久化键（merged 页沿用历史键名），默认按 drugsApi 生成 */
  queryStorageKey?: string;
  /** 列表接口返回非 success 时的失败描述兜底文案 */
  loadErrorFallback?: string;
  /** 网络错误时的失败描述文案 */
  networkErrorDescription?: string;
}

/**
 * 药品查询通用 Hook
 * 封装列表加载、搜索、筛选、分页、导出与查询条件 sessionStorage 记忆
 */
export function useDrugQuery<T extends { id: string }>(options: UseDrugQueryOptions) {
  const {
    drugsApi,
    exportApi,
    defaultExportFilename,
    loadErrorFallback,
    networkErrorDescription = '网络错误，请重试',
  } = options;

  const queryStorageKey = options.queryStorageKey ?? buildModuleQueryStorageKey(drugsApi);
  const persistedQueryState = readModuleQueryState(queryStorageKey);

  // 埋点：由 drugsApi 推导模块标识（/api/gz → /gz）
  const modulePath = drugsApi.replace(/^\/api/, '') || '/';
  const moduleKey = modulePath.replace(/\//g, '_').replace(/^_/, '') || 'module';

  // 药品列表数据
  const [drugs, setDrugs] = useState<T[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
  });
  const [searchKeyword, setSearchKeyword] = useState(persistedQueryState?.searchKeyword ?? '');
  const [filterValues, setFilterValues] = useState<FilterValues>(persistedQueryState?.filterValues ?? {});
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  /** 构造查询参数（search + 筛选字段） */
  const buildSearchParams = useCallback((base?: Record<string, string>) => {
    const params = new URLSearchParams(base);
    if (searchKeyword) params.append('search', searchKeyword);
    for (const [key, value] of Object.entries(filterValues)) {
      if (value) params.append(key, value);
    }
    return params;
  }, [searchKeyword, filterValues]);

  /** 加载药品列表 */
  const loadDrugs = useCallback(async (page = pagination.page) => {
    setLoading(true);
    try {
      const params = buildSearchParams({
        page: page.toString(),
        pageSize: pagination.pageSize.toString(),
      });

      const response = await fetch(`${drugsApi}?${params}`);
      const result = await response.json();

      if (result.success) {
        setDrugs(result.data);
        if (result.pagination) {
          setPagination(result.pagination);
        }
      } else {
        toast.error('加载失败', { description: result.message || loadErrorFallback });
      }
    } catch {
      toast.error('加载失败', { description: networkErrorDescription });
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, buildSearchParams, drugsApi, loadErrorFallback, networkErrorDescription]);

  /** 导出 Excel */
  const handleExport = async () => {
    setExporting(true);
    try {
      const params = buildSearchParams();

      const response = await fetch(`${exportApi}?${params}`);

      if (!response.ok) {
        const result = await response.json();
        toast.error('导出失败', { description: result.message });
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;

      // 从响应头获取文件名并解码
      const contentDisposition = response.headers.get('content-disposition');
      let filename = defaultExportFilename;
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename\*?=['"]?(?:UTF-\d['"]*)?([^;'"]+)/i);
        if (filenameMatch && filenameMatch[1]) {
          filename = decodeURIComponent(filenameMatch[1]);
        }
      }
      link.download = filename;

      link.click();
      window.URL.revokeObjectURL(url);

      toast.success('导出成功', { description: 'Excel 文件已下载' });

      // 埋点：导出成功
      trackEvent({
        event_type: 'export_data',
        event_name: `export_${moduleKey}`,
        page_path: modulePath,
        detail: { type: 'excel' },
      });
    } catch {
      toast.error('导出失败', { description: '网络错误，请重试' });
    } finally {
      setExporting(false);
    }
  };

  /** 搜索处理 */
  const handleSearch = () => {
    setPagination(prev => ({ ...prev, page: 1 }));
    loadDrugs();

    // 埋点：查询搜索（翻页不重复计数，仅搜索动作）
    trackEvent({
      event_type: 'search_query',
      event_name: `search_${moduleKey}`,
      page_path: modulePath,
      detail: { keyword: searchKeyword || undefined, filters: filterValues, page: 1 },
    });
  };

  /** 重置筛选条件 */
  const handleReset = () => {
    setSearchKeyword('');
    setFilterValues({});
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  /** 更新单个筛选字段值 */
  const handleFilterChange = (key: string, value: string) => {
    setFilterValues(prev => {
      const next = { ...prev };
      if (value === 'all') {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  };

  /** 分页处理 */
  const handlePageChange = (newPage: number) => {
    setPagination(prev => ({ ...prev, page: newPage }));
  };

  /** 展开/收起行 */
  const toggleRowExpand = (id: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  /** 格式化价格 */
  const formatPrice = (price?: number) => {
    if (price === undefined || price === null) return '-';
    return `¥${price.toFixed(2)}`;
  };

  // 记忆查询条件（菜单切换后返回时恢复）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(queryStorageKey, JSON.stringify({
      searchKeyword,
      filterValues,
    }));
  }, [queryStorageKey, searchKeyword, filterValues]);

  return {
    drugs,
    pagination,
    setPagination,
    searchKeyword,
    setSearchKeyword,
    filterValues,
    setFilterValues,
    loading,
    exporting,
    expandedRows,
    loadDrugs,
    handleExport,
    handleSearch,
    handleReset,
    handleFilterChange,
    handlePageChange,
    toggleRowExpand,
    formatPrice,
  };
}

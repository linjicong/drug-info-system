'use client';

import type { FilterValues } from '../SearchCard';

/** 查询条件持久化结构（sessionStorage） */
export type ModuleQueryState = {
  searchKeyword: string;
  filterValues: FilterValues;
};

export const buildModuleQueryStorageKey = (drugsApi: string) => `drug-module-query:${drugsApi}`;
export const buildProgressStorageKey = (progressApi: string) => `drug-module-progress:${progressApi}`;

/** 从 sessionStorage 读取并解析 JSON，SSR / 缺失 / 解析异常一律返回 null */
export const readSessionJson = (storageKey: string): unknown => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/** 读取持久化的查询条件（菜单切换后返回时恢复） */
export const readModuleQueryState = (storageKey: string): ModuleQueryState | null => {
  const parsed = readSessionJson(storageKey) as Partial<ModuleQueryState> | null;
  if (!parsed || typeof parsed !== 'object') return null;
  return {
    searchKeyword: typeof parsed.searchKeyword === 'string' ? parsed.searchKeyword : '',
    filterValues: parsed.filterValues && typeof parsed.filterValues === 'object' ? parsed.filterValues : {},
  };
};

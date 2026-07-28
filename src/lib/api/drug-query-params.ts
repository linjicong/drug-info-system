import type { NextRequest } from 'next/server';

/**
 * 药品筛选参数（gz / pubonln / merged 三组列表与导出路由共用）
 */
export interface DrugFilterParams {
  searchKeyword?: string;
  productName?: string;
  nationalDrugCode?: string;
  companyName?: string;
  minPacQuantity?: string;
  minMeasureUnit?: string;
}

export interface ParseDrugFilterOptions {
  /** companyName 是否接受 manufacturer 别名（gz/pubonln 为 true，merged 为 false） */
  manufacturerAlias?: boolean;
}

/**
 * 解析药品筛选参数
 * 别名兼容：manufacturer→companyName（可选）、minPackQuantity→minPacQuantity、minPackUnit→minMeasureUnit
 */
export function parseDrugFilterParams(
  searchParams: NextRequest['nextUrl']['searchParams'],
  options: ParseDrugFilterOptions = {},
): DrugFilterParams {
  const { manufacturerAlias = true } = options;
  return {
    searchKeyword: searchParams.get('search') || undefined,
    productName: searchParams.get('productName') || undefined,
    nationalDrugCode: searchParams.get('nationalDrugCode') || undefined,
    companyName: manufacturerAlias
      ? searchParams.get('companyName') || searchParams.get('manufacturer') || undefined
      : searchParams.get('companyName') || undefined,
    minPacQuantity: searchParams.get('minPacQuantity') || searchParams.get('minPackQuantity') || undefined,
    minMeasureUnit: searchParams.get('minMeasureUnit') || searchParams.get('minPackUnit') || undefined,
  };
}

/**
 * 解析分页参数（默认 page=1、pageSize=20）
 */
export function parsePaginationParams(
  searchParams: NextRequest['nextUrl']['searchParams'],
): { page: number; pageSize: number } {
  return {
    page: parseInt(searchParams.get('page') || '1', 10),
    pageSize: parseInt(searchParams.get('pageSize') || '20', 10),
  };
}

import { NextRequest } from 'next/server';
import { getDrugList } from '@/lib/drug-scraper';
import { parseDrugFilterParams, parsePaginationParams } from '@/lib/api/drug-query-params';
import { jsonError, pagedResponse } from '@/lib/api/responses';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const { page, pageSize } = parsePaginationParams(searchParams);
    const filters = parseDrugFilterParams(searchParams);

    const result = await getDrugList({ page, pageSize, ...filters });

    return pagedResponse({ data: result.data, page, pageSize, total: result.total });
  } catch (error) {
    console.error('[API] 查询错误:', error);
    return jsonError('查询失败', 500, error);
  }
}

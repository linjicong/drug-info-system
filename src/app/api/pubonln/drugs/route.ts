import { NextRequest } from 'next/server';
import { getPubonlnDrugList } from '@/lib/pubonln-scraper';
import { parseDrugFilterParams, parsePaginationParams } from '@/lib/api/drug-query-params';
import { jsonError, pagedResponse } from '@/lib/api/responses';

/**
 * GET /api/pubonln/drugs - 获取挂网药品列表
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const { page, pageSize } = parsePaginationParams(searchParams);
    const filters = parseDrugFilterParams(searchParams);

    const { data, total } = await getPubonlnDrugList({ page, pageSize, ...filters });

    return pagedResponse({ data, page, pageSize, total });
  } catch (error) {
    console.error('[API] 获取挂网药品列表失败:', error);
    return jsonError('获取数据失败', 500, error);
  }
}

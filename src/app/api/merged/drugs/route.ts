import { NextRequest } from 'next/server';
import { getMergedDrugList } from '@/lib/merged-drug-service';
import { parseDrugFilterParams, parsePaginationParams } from '@/lib/api/drug-query-params';
import { jsonError, pagedResponse } from '@/lib/api/responses';

/**
 * 整合药品数据查询接口
 * GET /api/merged/drugs?page=1&pageSize=20&search=xxx&productName=xxx&nationalDrugCode=xxx&companyName=xxx&minPacQuantity=xxx&minMeasureUnit=xxx
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const { page, pageSize } = parsePaginationParams(searchParams);
    // merged 路由的 companyName 不接受 manufacturer 别名（保持原行为）
    const filters = parseDrugFilterParams(searchParams, { manufacturerAlias: false });

    const result = await getMergedDrugList({ page, pageSize, ...filters });

    return pagedResponse({ data: result.data, page, pageSize, total: result.total });
  } catch (error) {
    console.error('[API] 整合药品查询错误:', error);
    return jsonError('查询失败', 500, error);
  }
}

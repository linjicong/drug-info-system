import { NextRequest } from 'next/server';
import { scrapeDrugInfo } from '@/lib/drug-scraper';
import { createFetchHandler } from '@/lib/api/route-factories';

/**
 * POST /api/drugs/fetch - 触发抓取广州药品信息
 */
export const POST = createFetchHandler({
  source: 'gz_drug',
  run: async (request: NextRequest) => {
    // 解析请求体（可能为空）
    let body: { url?: string } = {};
    try {
      const text = await request.text();
      if (text) {
        body = JSON.parse(text);
      }
    } catch {
      // 忽略解析错误，使用默认空对象
    }

    // 执行抓取
    return scrapeDrugInfo(body.url);
  },
  toLogCounts: (result) => ({
    total_count: result.total,
    new_count: result.newCount,
    update_count: result.updateCount,
  }),
  toResponseData: (result) => ({
    total: result.total,
    newCount: result.newCount,
    updateCount: result.updateCount,
  }),
  errorLogPrefix: '[API] 抓取错误:',
});

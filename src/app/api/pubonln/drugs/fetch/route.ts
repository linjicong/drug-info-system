import { scrapePubonlnDrugInfo } from '@/lib/pubonln-scraper';
import { createFetchHandler } from '@/lib/api/route-factories';

/**
 * POST /api/pubonln/drugs/fetch - 触发抓取挂网药品信息
 */
export const POST = createFetchHandler({
  source: 'gd_pubonln',
  run: () => scrapePubonlnDrugInfo(),
  toLogCounts: (result) => ({
    total_count: result.total,
    new_count: result.newCount,
    update_count: 0,
  }),
  toResponseData: (result) => ({
    total: result.total,
    newCount: result.newCount,
  }),
  errorLogPrefix: '[API] 挂网药品抓取错误:',
});

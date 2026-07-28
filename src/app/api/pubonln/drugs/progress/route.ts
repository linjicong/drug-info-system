import { getProgress, resetProgress } from '@/lib/progress-manager';
import { createProgressHandlers } from '@/lib/api/route-factories';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/pubonln/drugs/progress - 获取抓取进度（轮询方式）
 * DELETE /api/pubonln/drugs/progress - 重置抓取进度（抓取完成后前端延时调用以收起进度卡片）
 */
export const { GET, DELETE } = createProgressHandlers({
  getFn: () => getProgress('gd_pubonln'),
  resetFn: () => resetProgress('gd_pubonln'),
});

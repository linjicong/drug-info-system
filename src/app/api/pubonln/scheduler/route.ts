import { createSchedulerHandlers } from '@/lib/api/route-factories';

/**
 * GET /api/pubonln/scheduler - 获取当前调度器配置
 * POST /api/pubonln/scheduler - 更新调度器配置
 */
export const { GET, POST } = createSchedulerHandlers('gd_pubonln');

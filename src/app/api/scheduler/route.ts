import { createSchedulerHandlers } from '@/lib/api/route-factories';

/**
 * GET /api/scheduler - 获取当前调度器配置
 * POST /api/scheduler - 更新调度器配置
 */
export const { GET, POST } = createSchedulerHandlers('gz_drug');

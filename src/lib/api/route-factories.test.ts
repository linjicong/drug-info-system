/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock unified-scheduler：createFetchHandler 只用到 canStartScrape/createScrapeLog，其余给空实现
vi.mock('@/lib/unified-scheduler', () => ({
  canStartScrape: vi.fn(),
  createScrapeLog: vi.fn(),
  getUnifiedSchedulerConfig: vi.fn(),
  updateUnifiedSchedulerConfig: vi.fn(),
  getLatestScrapeLog: vi.fn(),
  getLatestDataTime: vi.fn(),
  initUnifiedScheduler: vi.fn(),
}));

import { createFetchHandler, createProgressHandlers } from './route-factories';
import { canStartScrape, createScrapeLog } from '@/lib/unified-scheduler';

function makeHandler() {
  return createFetchHandler({
    source: 'gz_drug',
    errorLogPrefix: '[test]',
  });
}

describe('createFetchHandler（入队化）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('canStartScrape 为 false 时返回 409 且不入队', async () => {
    (canStartScrape as any).mockResolvedValue({ canStart: false, reason: '已有抓取任务正在运行中' });
    const res = await makeHandler()();
    expect(res.status).toBe(409);
    expect((await res.json()).success).toBe(false);
    expect(createScrapeLog).not.toHaveBeenCalled();
  });

  it('canStartScrape 为 true 时插入 queued 日志并立即返回', async () => {
    (canStartScrape as any).mockResolvedValue({ canStart: true, reason: '' });
    (createScrapeLog as any).mockResolvedValue(123);
    const res = await makeHandler()();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain('队列');
    expect(createScrapeLog).toHaveBeenCalledWith('gz_drug', 'manual', 'queued');
  });

  it('入队失败（createScrapeLog 返回 null）返回 500', async () => {
    (canStartScrape as any).mockResolvedValue({ canStart: true, reason: '' });
    (createScrapeLog as any).mockResolvedValue(null);
    const res = await makeHandler()();
    expect(res.status).toBe(500);
    expect((await res.json()).success).toBe(false);
  });

  it('createScrapeLog 抛异常时返回 500（不传播）', async () => {
    (canStartScrape as any).mockResolvedValue({ canStart: true, reason: '' });
    (createScrapeLog as any).mockRejectedValue(new Error('db down'));
    const res = await makeHandler()();
    expect(res.status).toBe(500);
  });
});

describe('createProgressHandlers（异步仓储化）', () => {
  it('GET await 异步 getFn 并返回其结果', async () => {
    const progress = { status: 'running', currentPage: 1 };
    const handlers = createProgressHandlers({
      getFn: async () => progress,
      resetFn: vi.fn(),
    });
    const res = await handlers.GET();
    expect(await res.json()).toEqual(progress);
  });

  it('DELETE await 异步 resetFn 并返回 success', async () => {
    const resetFn = vi.fn().mockResolvedValue(undefined);
    const handlers = createProgressHandlers({
      getFn: () => ({}),
      resetFn,
    });
    const res = await handlers.DELETE();
    expect(resetFn).toHaveBeenCalled();
    expect((await res.json()).success).toBe(true);
  });

  it('POST 返回 405', async () => {
    const handlers = createProgressHandlers({
      getFn: () => ({}),
      resetFn: vi.fn(),
    });
    const res = await handlers.POST();
    expect(res.status).toBe(405);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock factory 被 hoisted，引用的 mock 变量必须用 vi.hoisted 定义
const mocks = vi.hoisted(() => {
  const mockInsertValues = vi.fn();
  const mockInsert = vi.fn(() => ({ values: mockInsertValues }));
  const mockSelectLimit = vi.fn();
  const mockSelectWhere = vi.fn(() => ({ limit: mockSelectLimit }));
  const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
  const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));
  return { mockInsertValues, mockInsert, mockSelect, mockSelectFrom, mockSelectWhere, mockSelectLimit };
});

vi.mock('@/storage/database/db', () => ({
  db: {
    insert: mocks.mockInsert,
    select: mocks.mockSelect,
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
    delete: vi.fn(),
  },
}));
vi.mock('../drug-scraper', () => ({ scrapeDrugInfo: vi.fn() }));
vi.mock('../pubonln-scraper', () => ({ scrapePubonlnDrugInfo: vi.fn() }));
vi.mock('../merged-drug-service', () => ({ syncMergedDrugData: vi.fn() }));

import { createScrapeLog, getUnifiedSchedulerConfig } from '../unified-scheduler';

describe('returning 改写: MySQL 不支持 RETURNING，用 lastInsertId 回查', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createScrapeLog: insert 后从 FullResult.lastInsertId 返回新日志 id', async () => {
    mocks.mockInsertValues.mockResolvedValue({ lastInsertId: 42 });
    const id = await createScrapeLog('gz_drug', 'scheduled');
    expect(id).toBe(42);
    expect(mocks.mockInsert).toHaveBeenCalled();
    expect(mocks.mockInsertValues).toHaveBeenCalled();
  });

  it('createScrapeLog: lastInsertId 为 null/0 时返回 null（防御）', async () => {
    mocks.mockInsertValues.mockResolvedValue({ lastInsertId: null });
    const id = await createScrapeLog('gz_drug', 'scheduled');
    expect(id).toBeNull();

    mocks.mockInsertValues.mockResolvedValue({ lastInsertId: 0 });
    const id2 = await createScrapeLog('gz_drug', 'scheduled');
    expect(id2).toBeNull();
  });

  it('createScrapeLog: insert 抛错时返回 null（不传播异常）', async () => {
    mocks.mockInsertValues.mockRejectedValue(new Error('db down'));
    const id = await createScrapeLog('gz_drug', 'scheduled');
    expect(id).toBeNull();
  });

  it('getUnifiedSchedulerConfig: 已有配置时直接返回（不 insert）', async () => {
    const existingConfig = {
      id: 7,
      source: 'gz_drug',
      enabled: false,
      interval_minutes: 60,
      next_run_at: null,
      last_run_at: null,
      last_run_status: null,
      running_status: 'idle',
      updated_at: '2026-01-01',
      cron_secret: 'secret-x',
    };
    mocks.mockSelectLimit.mockResolvedValue([existingConfig]);
    const config = await getUnifiedSchedulerConfig('gz_drug');
    expect(config).toEqual(existingConfig);
    expect(mocks.mockInsert).not.toHaveBeenCalled();
  });

  it('getUnifiedSchedulerConfig: 无配置时 insert 后按 lastInsertId 回查', async () => {
    mocks.mockSelectLimit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 100, source: 'gz_drug', enabled: false, interval_minutes: 60, running_status: 'idle', cron_secret: 'x', updated_at: '2026-01-01' }]);
    mocks.mockInsertValues.mockResolvedValue({ lastInsertId: 100 });
    const config = await getUnifiedSchedulerConfig('gz_drug');
    expect(mocks.mockInsert).toHaveBeenCalled();
    expect(config?.id).toBe(100);
  });

  it('getUnifiedSchedulerConfig: insert 后 lastInsertId 为 0 时返回 null', async () => {
    mocks.mockSelectLimit.mockResolvedValueOnce([]);
    mocks.mockInsertValues.mockResolvedValue({ lastInsertId: 0 });
    const config = await getUnifiedSchedulerConfig('gz_drug');
    expect(config).toBeNull();
  });
});

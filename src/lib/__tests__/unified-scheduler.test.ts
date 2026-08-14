import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.mock factory 被 hoisted，引用的 mock 变量必须用 vi.hoisted 定义
const mocks = vi.hoisted(() => {
  const mockInsertValues = vi.fn();
  const mockInsert = vi.fn(() => ({ values: mockInsertValues }));
  const mockSelectLimit = vi.fn();
  const mockSelectOrderBy = vi.fn(() => ({ limit: mockSelectLimit }));
  const mockSelectWhere = vi.fn(() => ({ limit: mockSelectLimit, orderBy: mockSelectOrderBy }));
  const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
  const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));
  const mockUpdateWhere = vi.fn();
  const mockUpdateSet = vi.fn();
  mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
  const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));
  return { mockInsertValues, mockInsert, mockSelect, mockSelectFrom, mockSelectWhere, mockSelectOrderBy, mockSelectLimit, mockUpdate, mockUpdateSet, mockUpdateWhere };
});

vi.mock('@/storage/database/db', () => ({
  db: {
    insert: mocks.mockInsert,
    select: mocks.mockSelect,
    update: mocks.mockUpdate,
    delete: vi.fn(),
  },
}));
vi.mock('../drug-scraper', () => ({ scrapeDrugInfo: vi.fn() }));
vi.mock('../pubonln-scraper', () => ({ scrapePubonlnDrugInfo: vi.fn() }));
vi.mock('../merged-drug-service', () => ({ syncMergedDrugData: vi.fn() }));
vi.mock('../ledger-service', () => ({ executeLedgerSnapshot: vi.fn() }));
vi.mock('../task-progress-repo', () => ({ resetTaskProgress: vi.fn(), upsertTaskProgress: vi.fn() }));

import { createScrapeLog, getUnifiedSchedulerConfig, canStartScrape, finalizeScrapeRun, updateUnifiedSchedulerConfig, sweepStaleRunning, claimSourceLock, claimQueuedLog, runScrapeJob } from '../unified-scheduler';
import { scrapeDrugInfo } from '../drug-scraper';
import { resetTaskProgress } from '../task-progress-repo';

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

describe('canStartScrape: 僵尸运行状态自愈', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseConfig = {
    id: 7,
    source: 'gz_drug',
    enabled: false,
    interval_minutes: 60,
    next_run_at: null,
    last_run_at: null,
    last_run_status: null,
    cron_secret: 'secret-x',
  };

  it('idle 状态直接放行', async () => {
    mocks.mockSelectLimit.mockResolvedValue([{ ...baseConfig, running_status: 'idle', updated_at: new Date().toISOString() }]);
    const { canStart } = await canStartScrape('gz_drug');
    expect(canStart).toBe(true);
  });

  it('running 且 updated_at 在 30 分钟内：拒绝（防重复抓取不受影响）', async () => {
    mocks.mockSelectLimit.mockResolvedValue([{ ...baseConfig, running_status: 'running', updated_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() }]);
    const { canStart, reason } = await canStartScrape('gz_drug');
    expect(canStart).toBe(false);
    expect(reason).toBe('已有抓取任务正在运行中');
  });

  it('running 且 updated_at 超过 30 分钟：自动复位并放行', async () => {
    mocks.mockSelectLimit.mockResolvedValue([{ ...baseConfig, running_status: 'running', updated_at: new Date(Date.now() - 31 * 60 * 1000).toISOString() }]);
    const { canStart } = await canStartScrape('gz_drug');
    expect(canStart).toBe(true);
  });
});

describe('datetime 列回写必须传 Date 对象（drizzle date 模式会调 value.toISOString，传字符串直接抛错）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const enabledConfig = {
    id: 9,
    source: 'merged_drug',
    enabled: true,
    interval_minutes: 60,
    next_run_at: null,
    last_run_at: null,
    last_run_status: null,
    running_status: 'idle',
    updated_at: new Date().toISOString(),
    cron_secret: 'secret-y',
  };

  it('finalizeScrapeRun: last_run_at/updated_at/next_run_at 均为 Date 实例', async () => {
    mocks.mockSelectLimit.mockResolvedValue([enabledConfig]);
    await finalizeScrapeRun('merged_drug', 'success');

    expect(mocks.mockUpdateSet).toHaveBeenCalledTimes(1);
    const setArg = mocks.mockUpdateSet.mock.calls[0][0];
    expect(setArg.last_run_status).toBe('success');
    expect(setArg.last_run_at).toBeInstanceOf(Date);
    expect(setArg.updated_at).toBeInstanceOf(Date);
    expect(setArg.next_run_at).toBeInstanceOf(Date);
  });

  it('updateUnifiedSchedulerConfig: updated_at/next_run_at 均为 Date 实例', async () => {
    mocks.mockSelectLimit.mockResolvedValue([enabledConfig]);
    await updateUnifiedSchedulerConfig('merged_drug', { enabled: true, interval_minutes: 30 });

    expect(mocks.mockUpdateSet).toHaveBeenCalledTimes(1);
    const setArg = mocks.mockUpdateSet.mock.calls[0][0];
    expect(setArg.updated_at).toBeInstanceOf(Date);
    expect(setArg.next_run_at).toBeInstanceOf(Date);
  });
});

describe('sweepStaleRunning: 僵尸清扫', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('清扫到僵尸：置 idle + running 日志标 failed + 复位进度行', async () => {
    // HTTP 驱动真实返回形状：rowsAffected
    mocks.mockUpdateWhere.mockResolvedValue({ rowsAffected: 1 });
    const swept = await sweepStaleRunning('gz_drug');

    expect(swept).toBe(1);
    expect(mocks.mockUpdateSet).toHaveBeenCalledTimes(2);
    // 第一次：config 置 idle；第二次：残留日志标 failed
    expect(mocks.mockUpdateSet.mock.calls[0][0].running_status).toBe('idle');
    expect(mocks.mockUpdateSet.mock.calls[1][0].status).toBe('failed');
    expect(resetTaskProgress).toHaveBeenCalledWith('gz_drug');
  });

  it('无僵尸：不碰日志与进度行', async () => {
    mocks.mockUpdateWhere.mockResolvedValue({ rowsAffected: 0 });
    const swept = await sweepStaleRunning('gz_drug');

    expect(swept).toBe(0);
    expect(mocks.mockUpdateSet).toHaveBeenCalledTimes(1);
    expect(resetTaskProgress).not.toHaveBeenCalled();
  });
});

describe('claimSourceLock: CAS 原子认领', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rowsAffected=1（HTTP 驱动）认领成功', async () => {
    mocks.mockSelectLimit.mockResolvedValue([{ id: 7, source: 'gz_drug', running_status: 'idle', updated_at: new Date().toISOString(), cron_secret: 'x', enabled: false, interval_minutes: 60 }]);
    mocks.mockUpdateWhere.mockResolvedValue({ rowsAffected: 1 });
    expect(await claimSourceLock('gz_drug')).toBe(true);
    expect(mocks.mockUpdateSet.mock.calls[0][0].running_status).toBe('running');
  });

  it('affectedRows=1（mysql2 回退驱动）认领成功', async () => {
    mocks.mockSelectLimit.mockResolvedValue([{ id: 7, source: 'gz_drug', running_status: 'idle', updated_at: new Date().toISOString(), cron_secret: 'x', enabled: false, interval_minutes: 60 }]);
    mocks.mockUpdateWhere.mockResolvedValue([{ affectedRows: 1 }]);
    expect(await claimSourceLock('gz_drug')).toBe(true);
  });

  it('影响行数=0（已被其他 runner 抢占）认领失败', async () => {
    mocks.mockSelectLimit.mockResolvedValue([{ id: 7, source: 'gz_drug', running_status: 'running', updated_at: new Date().toISOString(), cron_secret: 'x', enabled: false, interval_minutes: 60 }]);
    mocks.mockUpdateWhere.mockResolvedValue({ rowsAffected: 0 });
    expect(await claimSourceLock('gz_drug')).toBe(false);
  });
});

describe('claimQueuedLog: 认领最早 queued 日志', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('有 queued 日志：改 running 并返回 id 与类型', async () => {
    mocks.mockSelectLimit.mockResolvedValue([{ id: 5, scrape_type: 'manual' }]);
    mocks.mockUpdateWhere.mockResolvedValue({ rowsAffected: 1 });
    const claimed = await claimQueuedLog('merged_drug');
    expect(claimed).toEqual({ logId: 5, scrapeType: 'manual' });
    expect(mocks.mockUpdateSet.mock.calls[0][0].status).toBe('running');
  });

  it('无 queued 日志：返回 null 且不 update', async () => {
    mocks.mockSelectLimit.mockResolvedValue([]);
    expect(await claimQueuedLog('merged_drug')).toBeNull();
    expect(mocks.mockUpdate).not.toHaveBeenCalled();
  });
});

describe('runScrapeJob: 心跳与锁释放', () => {
  const runningConfig = {
    id: 7,
    source: 'gz_drug',
    enabled: false,
    interval_minutes: 60,
    next_run_at: null,
    last_run_at: null,
    last_run_status: null,
    running_status: 'running',
    updated_at: new Date().toISOString(),
    cron_secret: 'secret-x',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // runScrapeJob 内所有 select（日志 start_time 回查 / config 读取）统一返回 config 行
    mocks.mockSelectLimit.mockResolvedValue([runningConfig]);
    mocks.mockUpdateWhere.mockResolvedValue({ rowsAffected: 1 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('每 60s 心跳刷新 updated_at，结束后 finally 释放锁', async () => {
    vi.useFakeTimers();
    let resolveScrape!: (value: { success: boolean; message: string }) => void;
    (scrapeDrugInfo as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(resolve => { resolveScrape = resolve; })
    );

    const job = runScrapeJob('gz_drug', 42);

    // 心跳第一跳（60s）
    await vi.advanceTimersByTimeAsync(60_000);
    const heartbeatSets = mocks.mockUpdateSet.mock.calls
      .map(call => call[0])
      .filter(set => set.running_status === 'running' && set.updated_at instanceof Date);
    expect(heartbeatSets.length).toBe(1);

    resolveScrape({ success: true, message: 'ok' });
    await vi.advanceTimersByTimeAsync(0);
    await job;

    // 最后一次 update 为释放锁（idle）
    const lastSet = mocks.mockUpdateSet.mock.calls.at(-1)?.[0];
    expect(lastSet?.running_status).toBe('idle');
    // 任务成功日志回写
    const logSet = mocks.mockUpdateSet.mock.calls.map(call => call[0]).find(set => set.status === 'success');
    expect(logSet).toBeDefined();
  });

  it('任务抛错：日志标 failed 且仍释放锁', async () => {
    (scrapeDrugInfo as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('源站挂了'));

    await runScrapeJob('gz_drug', 42);

    const logSet = mocks.mockUpdateSet.mock.calls.map(call => call[0]).find(set => set.status === 'failed');
    expect(logSet?.error_message).toBe('源站挂了');
    expect(mocks.mockUpdateSet.mock.calls.at(-1)?.[0]?.running_status).toBe('idle');
  });

  it('sinks 注入时透传给业务函数', async () => {
    (scrapeDrugInfo as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, message: 'ok' });
    const fetchSink = vi.fn();

    await runScrapeJob('gz_drug', 42, { fetch: fetchSink });

    expect(scrapeDrugInfo).toHaveBeenCalledWith(undefined, undefined, { onProgress: fetchSink });
  });
});

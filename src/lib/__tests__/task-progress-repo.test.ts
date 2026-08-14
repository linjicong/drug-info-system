import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock factory 被 hoisted，引用的 mock 变量必须用 vi.hoisted 定义
const mocks = vi.hoisted(() => {
  const mockOnDuplicateKeyUpdate = vi.fn();
  const mockInsertValues = vi.fn();
  mockInsertValues.mockReturnValue({ onDuplicateKeyUpdate: mockOnDuplicateKeyUpdate });
  const mockInsert = vi.fn(() => ({ values: mockInsertValues }));
  const mockSelectLimit = vi.fn();
  const mockSelectWhere = vi.fn(() => ({ limit: mockSelectLimit }));
  const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
  const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));
  const mockDeleteWhere = vi.fn();
  const mockDelete = vi.fn(() => ({ where: mockDeleteWhere }));
  return {
    mockInsert,
    mockInsertValues,
    mockOnDuplicateKeyUpdate,
    mockSelect,
    mockSelectLimit,
    mockDelete,
    mockDeleteWhere,
  };
});

vi.mock('@/storage/database/db', () => ({
  db: {
    insert: mocks.mockInsert,
    select: mocks.mockSelect,
    delete: mocks.mockDelete,
  },
}));

import {
  upsertTaskProgress,
  getTaskProgressRow,
  resetTaskProgress,
  fetchProgressFromDb,
  mergeProgressFromDb,
  HEARTBEAT_LOST_MESSAGE,
} from '../task-progress-repo';

describe('upsertTaskProgress', () => {
  beforeEach(() => vi.clearAllMocks());

  it('按主键 upsert，补丁字段与心跳一起写入', async () => {
    mocks.mockOnDuplicateKeyUpdate.mockResolvedValue(undefined);
    await upsertTaskProgress('merged_drug', {
      status: 'running',
      phase: '正在合并',
      counters: { savedCount: 10 },
      startTime: new Date('2026-08-13T08:00:00Z'),
    });

    expect(mocks.mockInsertValues).toHaveBeenCalledTimes(1);
    const values = mocks.mockInsertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(values.source).toBe('merged_drug');
    expect(values.status).toBe('running');
    expect(values.counters).toBe(JSON.stringify({ savedCount: 10 }));
    expect(values.start_time).toBeInstanceOf(Date);
    expect(values.updated_at).toBeInstanceOf(Date);

    const setArg = mocks.mockOnDuplicateKeyUpdate.mock.calls[0][0].set as Record<string, unknown>;
    expect(setArg.updated_at).toBeInstanceOf(Date);
    expect(setArg.counters).toBe(JSON.stringify({ savedCount: 10 }));
  });

  it('未提供的补丁字段不进入写入对象', async () => {
    mocks.mockOnDuplicateKeyUpdate.mockResolvedValue(undefined);
    await upsertTaskProgress('gz_drug', { status: 'completed' });

    const values = mocks.mockInsertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(values).not.toHaveProperty('phase');
    expect(values).not.toHaveProperty('counters');
    expect(values).not.toHaveProperty('end_time');
  });
});

describe('getTaskProgressRow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('无记录返回 null', async () => {
    mocks.mockSelectLimit.mockResolvedValue([]);
    expect(await getTaskProgressRow('gz_drug')).toBeNull();
  });

  it('datetime 转毫秒时间戳，counters 反序列化', async () => {
    mocks.mockSelectLimit.mockResolvedValue([
      {
        source: 'merged_drug',
        status: 'completed',
        phase: '合并完成',
        counters: JSON.stringify({ savedCount: 5 }),
        start_time: new Date('2026-08-13T08:00:00Z'),
        end_time: new Date('2026-08-13T08:05:00Z'),
        error: null,
        updated_at: new Date('2026-08-13T08:05:00Z'),
      },
    ]);
    const row = await getTaskProgressRow('merged_drug');
    expect(row).not.toBeNull();
    expect(row!.startTime).toBe(Date.parse('2026-08-13T08:00:00Z'));
    expect(row!.endTime).toBe(Date.parse('2026-08-13T08:05:00Z'));
    expect(row!.counters).toEqual({ savedCount: 5 });
  });

  it('counters 为非法 JSON 时降级为 null（不抛错）', async () => {
    mocks.mockSelectLimit.mockResolvedValue([
      {
        source: 'gz_drug',
        status: 'running',
        phase: null,
        counters: '{broken',
        start_time: null,
        end_time: null,
        error: null,
        updated_at: new Date(),
      },
    ]);
    const row = await getTaskProgressRow('gz_drug');
    expect(row!.counters).toBeNull();
  });
});

describe('resetTaskProgress', () => {
  it('按 source 删除行', async () => {
    mocks.mockDeleteWhere.mockResolvedValue(undefined);
    await resetTaskProgress('ledger');
    expect(mocks.mockDelete).toHaveBeenCalled();
    expect(mocks.mockDeleteWhere).toHaveBeenCalled();
  });
});

describe('fetchProgressFromDb（gz/pubonln 契约映射）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('无记录返回 idle 默认值', async () => {
    mocks.mockSelectLimit.mockResolvedValue([]);
    const p = await fetchProgressFromDb('gz_drug');
    expect(p.status).toBe('idle');
    expect(p.totalPages).toBe(0);
    expect(p.startTime).toBeNull();
  });

  it('counters 映射到 FetchProgress 字段', async () => {
    mocks.mockSelectLimit.mockResolvedValue([
      {
        source: 'gz_drug',
        status: 'running',
        phase: null,
        counters: JSON.stringify({ currentPage: 3, totalPages: 40, processedCount: 300, totalCount: 4000, newCount: 1, updateCount: 2 }),
        start_time: new Date(),
        end_time: null,
        error: null,
        updated_at: new Date(),
      },
    ]);
    const p = await fetchProgressFromDb('gz_drug');
    expect(p.status).toBe('running');
    expect(p.currentPage).toBe(3);
    expect(p.totalPages).toBe(40);
    expect(p.processedCount).toBe(300);
    expect(p.newCount).toBe(1);
    expect(p.updateCount).toBe(2);
  });

  it('running 且心跳超过 5 分钟：降级为 error', async () => {
    mocks.mockSelectLimit.mockResolvedValue([
      {
        source: 'gd_pubonln',
        status: 'running',
        phase: null,
        counters: null,
        start_time: new Date(Date.now() - 10 * 60 * 1000),
        end_time: null,
        error: null,
        updated_at: new Date(Date.now() - 6 * 60 * 1000),
      },
    ]);
    const p = await fetchProgressFromDb('gd_pubonln');
    expect(p.status).toBe('error');
    expect(p.error).toBe(HEARTBEAT_LOST_MESSAGE);
    expect(p.endTime).not.toBeNull();
  });
});

describe('mergeProgressFromDb（merged 契约映射）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('无记录返回 idle 默认值', async () => {
    mocks.mockSelectLimit.mockResolvedValue([]);
    const p = await mergeProgressFromDb();
    expect(p.status).toBe('idle');
    expect(p.gdLoaded).toBe(0);
    expect(p.phase).toBe('');
  });

  it('counters 映射到 MergeProgress 字段', async () => {
    mocks.mockSelectLimit.mockResolvedValue([
      {
        source: 'merged_drug',
        status: 'running',
        phase: '正在写入',
        counters: JSON.stringify({ gdLoaded: 100, gzLoaded: 50, mergedTotal: 120, savedCount: 80 }),
        start_time: new Date(),
        end_time: null,
        error: null,
        updated_at: new Date(),
      },
    ]);
    const p = await mergeProgressFromDb();
    expect(p.gdLoaded).toBe(100);
    expect(p.gzLoaded).toBe(50);
    expect(p.mergedTotal).toBe(120);
    expect(p.savedCount).toBe(80);
    expect(p.phase).toBe('正在写入');
  });

  it('completed 状态即使心跳过期也不降级', async () => {
    mocks.mockSelectLimit.mockResolvedValue([
      {
        source: 'merged_drug',
        status: 'completed',
        phase: '合并完成',
        counters: null,
        start_time: new Date(Date.now() - 60 * 60 * 1000),
        end_time: new Date(Date.now() - 55 * 60 * 1000),
        error: null,
        updated_at: new Date(Date.now() - 55 * 60 * 1000),
      },
    ]);
    const p = await mergeProgressFromDb();
    expect(p.status).toBe('completed');
  });
});

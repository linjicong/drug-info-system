import { describe, expect, it, vi } from 'vitest';
import { chunkArray, isTransientDbError, withDbRetry } from '../shared/db-retry';

describe('isTransientDbError', () => {
  it('识别 fetch failed + cause ETIMEDOUT 的嵌套错误（undici 形状）', () => {
    const cause = Object.assign(new Error('read ETIMEDOUT'), { code: 'ETIMEDOUT' });
    const error = new TypeError('fetch failed', { cause });
    expect(isTransientDbError(error)).toBe(true);
  });

  it('识别顶层 ECONNRESET 错误码', () => {
    const error = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    expect(isTransientDbError(error)).toBe(true);
  });

  it('不识别业务/约束类错误', () => {
    expect(isTransientDbError(new Error("Duplicate entry 'x' for key 'PRIMARY'"))).toBe(false);
    expect(isTransientDbError(new Error('Invalid JSON response'))).toBe(false);
  });

  it('非 Error 值返回 false', () => {
    expect(isTransientDbError('oops')).toBe(false);
    expect(isTransientDbError(null)).toBe(false);
  });
});

describe('withDbRetry', () => {
  it('瞬时错误重试后成功', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed', { cause: Object.assign(new Error(), { code: 'ETIMEDOUT' }) }))
      .mockResolvedValueOnce('done');

    await expect(withDbRetry(fn, 3, 'test')).resolves.toBe('done');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('非瞬时错误直接抛出不重试', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Duplicate entry'));
    await expect(withDbRetry(fn, 3, 'test')).rejects.toThrow('Duplicate entry');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('耗尽重试次数后抛出最后一个错误', async () => {
    const fn = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(withDbRetry(fn, 2, 'test')).rejects.toThrow('fetch failed');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('chunkArray', () => {
  it('按块大小切分，尾块不足时保留剩余', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkArray([], 100)).toEqual([]);
  });
});

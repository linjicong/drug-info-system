import { describe, it, expect, vi } from 'vitest';

// mock 抓取相关依赖，避免 import 链触发环境变量读取等副作用
vi.mock('../api-config', () => ({
  getDrugApiConfig: vi.fn(),
  getPubonlnApiConfig: vi.fn(),
  buildRequestOptions: vi.fn(),
}));
vi.mock('../progress-manager', () => ({
  updateProgress: vi.fn(),
  startProgress: vi.fn(),
  completeProgress: vi.fn(),
  setErrorProgress: vi.fn(),
  resetProgress: vi.fn(),
}));
vi.mock('../drug-detail-worker', () => ({ batchFetchWithConcurrency: vi.fn() }));
vi.mock('../concurrent-pool', () => ({ promisePool: vi.fn() }));
vi.mock('../merged-progress-manager', () => ({
  startMergeProgress: vi.fn(),
  updateMergeProgress: vi.fn(),
  completeMergeProgress: vi.fn(),
  setMergeProgressError: vi.fn(),
}));

import { normalizeDrugRow } from '../drug-scraper';
import { normalizePubonlnRow } from '../pubonln-scraper';
import { normalizeMergedRow } from '../merged-drug-service';
import { normalizeLedgerRow } from '../ledger-service';

describe('decimal normalize: drizzle decimal(string) -> number（保持与原 Supabase numeric 行为一致）', () => {
  it('normalizeDrugRow: 5 个 decimal 字段转 number', () => {
    const r = normalizeDrugRow({
      outlook_unit: '1.5000',
      bid_price: '12.3400',
      min_unit_price: '0.5000',
      max_listing_price: '99.0000',
      fs_rate: '0.0300',
      product_name: '阿莫西林',
    });
    expect(r.outlook_unit).toBe(1.5);
    expect(r.bid_price).toBe(12.34);
    expect(r.min_unit_price).toBe(0.5);
    expect(r.max_listing_price).toBe(99);
    expect(r.fs_rate).toBe(0.03);
    expect(r.product_name).toBe('阿莫西林');
  });

  it('normalizeDrugRow: null/undefined -> undefined', () => {
    expect(normalizeDrugRow({ bid_price: null }).bid_price).toBeUndefined();
    expect(normalizeDrugRow({ bid_price: undefined }).bid_price).toBeUndefined();
    expect(normalizeDrugRow({}).bid_price).toBeUndefined();
  });

  it('normalizeDrugRow: 0 价格保留为 0（非 undefined）', () => {
    expect(normalizeDrugRow({ bid_price: '0' }).bid_price).toBe(0);
    expect(normalizeDrugRow({ bid_price: '0.0000' }).bid_price).toBe(0);
  });

  it('normalizePubonlnRow: 挂网价格转 number', () => {
    expect(normalizePubonlnRow({ min_pac_pubonln_pric: '9.5000' }).min_pac_pubonln_pric).toBe(9.5);
    expect(normalizePubonlnRow({ min_pac_pubonln_pric: null }).min_pac_pubonln_pric).toBeUndefined();
  });

  it('normalizeMergedRow: 3 个价格字段转 number', () => {
    const r = normalizeMergedRow({
      gd_price: '1.1000',
      gz_bid_price: '2.2000',
      gz_min_unit_price: '3.3000',
    });
    expect(r.gd_price).toBe(1.1);
    expect(r.gz_bid_price).toBe(2.2);
    expect(r.gz_min_unit_price).toBe(3.3);
  });

  it('normalizeLedgerRow: gpo_price 与 provincial_price 转 number', () => {
    const r = normalizeLedgerRow({ gpo_price: '10.0000', provincial_price: '20.5000' });
    expect(r.gpo_price).toBe(10);
    expect(r.provincial_price).toBe(20.5);
    expect(normalizeLedgerRow({ gpo_price: null }).gpo_price).toBeUndefined();
  });
});

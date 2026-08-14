import { db } from '@/storage/database/db';
import { userTrackedDrugs, drugDailyLedgers, drugInfoMerged } from '@/storage/database/shared/schema';
import { and, asc, count, desc, eq, gte, inArray, like, lte, or, type SQL } from 'drizzle-orm';
import type { LedgerProgressPatch } from './progress-patch';

function normalizeQueryText(value?: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

const CONDITION_CHUNK_SIZE = 60;

export interface UserTrackedDrug {
  id?: string;
  product_name: string;
  national_drug_code?: string;
  company_name?: string;
  min_pac_quantity?: string;
  min_measure_unit?: string;
  created_at?: string;
  updated_at?: string;
  match_status?: 'matched' | 'unmatched';
  mismatch_fields?: string[];
  match_hint?: string;
}

export interface DrugDailyLedger {
  id?: string;
  tracked_drug_id?: string;
  stat_date: string;
  product_name: string;
  national_drug_code?: string;
  dosform?: string;
  company_name?: string;
  spec?: string;
  min_pac_quantity?: string;
  min_pac_unit?: string;
  min_measure_unit?: string;
  drug_net_type?: string;
  net_time?: string;
  gpo_price?: number;
  provincial_price?: number;
  created_at?: string;
}

/**
 * 规整台账返回行：decimal 字段转 number（drizzle decimal 返回 string，原 Supabase numeric 返回 number）
 */
export function normalizeLedgerRow(row: Record<string, unknown>): DrugDailyLedger {
  return {
    ...row,
    gpo_price: row.gpo_price != null ? Number(row.gpo_price) : undefined,
    provincial_price: row.provincial_price != null ? Number(row.provincial_price) : undefined,
  } as DrugDailyLedger;
}

/**
 * 分页查询监控药品列表
 * 支持按产品名称、生产企业、医保编码分别筛选
 */
export async function getTrackedDrugs(options?: {
  page?: number;
  pageSize?: number;
  searchKeyword?: string;
  productName?: string;
  companyName?: string;
  nationalDrugCode?: string;
  onlyUnmatched?: boolean;
}) {
  const page = options?.page || 1;
  const pageSize = options?.pageSize || 20;
  const offset = (page - 1) * pageSize;
  const keyword = normalizeQueryText(options?.searchKeyword);
  const productName = normalizeQueryText(options?.productName);
  const companyName = normalizeQueryText(options?.companyName);
  const nationalDrugCode = normalizeQueryText(options?.nationalDrugCode);
  const onlyUnmatched = options?.onlyUnmatched === true;

  const conditions: SQL[] = [];

  // 通用关键词搜索（产品名称或生产企业）
  if (keyword) {
    conditions.push(or(
      like(userTrackedDrugs.product_name, `%${keyword}%`),
      like(userTrackedDrugs.company_name, `%${keyword}%`)
    ) as SQL);
  }

  // 单独字段筛选
  if (productName) {
    conditions.push(like(userTrackedDrugs.product_name, `%${productName}%`) as SQL);
  }
  if (companyName) {
    conditions.push(like(userTrackedDrugs.company_name, `%${companyName}%`) as SQL);
  }
  if (nationalDrugCode) {
    conditions.push(like(userTrackedDrugs.national_drug_code, `%${nationalDrugCode}%`) as SQL);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const trackedRowsRaw = await db
    .select()
    .from(userTrackedDrugs)
    .where(whereClause)
    .orderBy(desc(userTrackedDrugs.created_at));

  const trackedRows = trackedRowsRaw as unknown as UserTrackedDrug[];
  if (trackedRows.length === 0) {
    return {
      data: trackedRows,
      total: 0,
      unmatchedTotal: 0,
    };
  }

  const productNames = Array.from(new Set(
    trackedRows.map(item => item.product_name?.trim()).filter(Boolean) as string[]
  ));
  const drugCodes = Array.from(new Set(
    trackedRows.map(item => item.national_drug_code?.trim()).filter(Boolean) as string[]
  ));

  const mergedMap = new Map<string, any>();
  const upsertMergedRows = (rows: any[] | null) => {
    if (!rows) return;
    for (const row of rows) {
      const key = String(row.id ?? `${row.product_name ?? ''}|${row.national_drug_code ?? ''}|${row.company_name ?? ''}|${row.min_pac_quantity ?? ''}|${row.min_measure_unit ?? ''}`);
      mergedMap.set(key, row);
    }
  };

  const mergedSelectFields = {
    id: drugInfoMerged.id,
    product_name: drugInfoMerged.product_name,
    national_drug_code: drugInfoMerged.national_drug_code,
    company_name: drugInfoMerged.company_name,
    min_pac_quantity: drugInfoMerged.min_pac_quantity,
    min_measure_unit: drugInfoMerged.min_measure_unit,
  };

  if (productNames.length > 0) {
    for (const chunk of chunkArray(productNames, CONDITION_CHUNK_SIZE)) {
      const rows = await db
        .select(mergedSelectFields)
        .from(drugInfoMerged)
        .where(inArray(drugInfoMerged.product_name, chunk));
      upsertMergedRows(rows as any[]);
    }
  }

  if (drugCodes.length > 0) {
    for (const chunk of chunkArray(drugCodes, CONDITION_CHUNK_SIZE)) {
      const rows = await db
        .select(mergedSelectFields)
        .from(drugInfoMerged)
        .where(inArray(drugInfoMerged.national_drug_code, chunk));
      upsertMergedRows(rows as any[]);
    }
  }

  const mergedCandidates = Array.from(mergedMap.values());

  const normalize = (value?: string | number | null) => {
    if (value === undefined || value === null) return '';
    return String(value).trim();
  };

  const getMismatchFields = (track: UserTrackedDrug, candidates: any[]): string[] => {
    const requiredFields: Array<{ key: keyof UserTrackedDrug; label: string; mergedKey: string }> = [
      { key: 'product_name', label: '产品名称', mergedKey: 'product_name' },
      { key: 'national_drug_code', label: '医保编码', mergedKey: 'national_drug_code' },
      { key: 'company_name', label: '生产企业', mergedKey: 'company_name' },
      { key: 'min_pac_quantity', label: '最小包装数量', mergedKey: 'min_pac_quantity' },
      { key: 'min_measure_unit', label: '最小计量单位', mergedKey: 'min_measure_unit' },
    ];

    const mismatchLabels: string[] = [];
    for (const field of requiredFields) {
      const expected = normalize(track[field.key] as string | undefined);
      if (!expected) continue;
      const existsSameValue = candidates.some(item => normalize(item[field.mergedKey]) === expected);
      if (!existsSameValue) mismatchLabels.push(field.label);
    }
    return mismatchLabels;
  };

  const withMatchStatus = trackedRows.map(item => {
    const strictMatch = mergedCandidates.some(candidate => {
      if (item.product_name?.trim() && normalize(candidate.product_name) !== normalize(item.product_name)) return false;
      if (item.national_drug_code?.trim() && normalize(candidate.national_drug_code) !== normalize(item.national_drug_code)) return false;
      if (item.company_name?.trim() && normalize(candidate.company_name) !== normalize(item.company_name)) return false;
      if (item.min_pac_quantity?.trim() && normalize(candidate.min_pac_quantity) !== normalize(item.min_pac_quantity)) return false;
      if (item.min_measure_unit?.trim() && normalize(candidate.min_measure_unit) !== normalize(item.min_measure_unit)) return false;
      return true;
    });

    if (strictMatch) {
      return {
        ...item,
        match_status: 'matched' as const,
        mismatch_fields: [],
        match_hint: '已匹配',
      };
    }

    const relatedCandidates = mergedCandidates.filter(candidate => {
      const byName = item.product_name?.trim() && normalize(candidate.product_name) === normalize(item.product_name);
      const byCode = item.national_drug_code?.trim() && normalize(candidate.national_drug_code) === normalize(item.national_drug_code);
      return Boolean(byName || byCode);
    });

    const mismatchFields = getMismatchFields(item, relatedCandidates);
    const hint = relatedCandidates.length === 0
      ? '未找到同名或同医保编码记录'
      : mismatchFields.length > 0
        ? `字段不一致：${mismatchFields.join('、')}`
        : '存在候选记录但未达到严格匹配';

    return {
      ...item,
      match_status: 'unmatched' as const,
      mismatch_fields: mismatchFields,
      match_hint: hint,
    };
  });

  const unmatchedTotal = withMatchStatus.filter(item => item.match_status === 'unmatched').length;
  const filteredRows = onlyUnmatched
    ? withMatchStatus.filter(item => item.match_status === 'unmatched')
    : withMatchStatus;
  const pagedRows = filteredRows.slice(offset, offset + pageSize);

  return {
    data: pagedRows as UserTrackedDrug[],
    total: filteredRows.length,
    unmatchedTotal,
  };
}

/**
 * 批量插入监控药品
 */
export async function insertTrackedDrugs(drugs: UserTrackedDrug[]) {
  // 生成记录并确保产品名称不为空
  const records = drugs.filter(d => d.product_name && d.product_name.trim().length > 0).map(d => ({
    id: d.id || (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15) + Date.now().toString(36)),
    product_name: d.product_name,
    national_drug_code: d.national_drug_code || null,
    company_name: d.company_name || null,
    min_pac_quantity: d.min_pac_quantity || null,
    min_measure_unit: d.min_measure_unit || null,
  }));

  if (records.length === 0) return { success: true, count: 0 };

  await db.insert(userTrackedDrugs).values(records as never);
  return { success: true, count: records.length };
}

/**
 * 覆盖导入监控药品：先清空历史配置，再批量插入新数据
 */
export async function replaceTrackedDrugs(drugs: UserTrackedDrug[]) {
  // 先构建并校验记录，确保不会清空后插入 0 条导致“空覆盖”
  const records = drugs.filter(d => d.product_name && d.product_name.trim().length > 0).map(d => ({
    id: d.id || (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15) + Date.now().toString(36)),
    product_name: d.product_name,
    national_drug_code: d.national_drug_code || null,
    company_name: d.company_name || null,
    min_pac_quantity: d.min_pac_quantity || null,
    min_measure_unit: d.min_measure_unit || null,
  }));

  if (records.length === 0) {
    throw new Error('覆盖导入失败: 有效数据为空');
  }

  const existingRows = await db
    .select({
      id: userTrackedDrugs.id,
      product_name: userTrackedDrugs.product_name,
      national_drug_code: userTrackedDrugs.national_drug_code,
      company_name: userTrackedDrugs.company_name,
      min_pac_quantity: userTrackedDrugs.min_pac_quantity,
      min_measure_unit: userTrackedDrugs.min_measure_unit,
    })
    .from(userTrackedDrugs);

  const backupRecords = existingRows as unknown as UserTrackedDrug[];

  // 清空全表（等价于原 .not('id','is',null) 的清表语义）
  await db.delete(userTrackedDrugs);

  const batchSize = 500;
  let inserted = 0;
  try {
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      await db.insert(userTrackedDrugs).values(batch as never);
      inserted += batch.length;
    }
  } catch (insertError) {
    // 尝试补偿恢复，避免“先删后插失败”导致配置丢失
    if (backupRecords.length > 0) {
      for (let i = 0; i < backupRecords.length; i += batchSize) {
        const batch = backupRecords.slice(i, i + batchSize).map(d => ({
          id: d.id || (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15) + Date.now().toString(36)),
          product_name: d.product_name,
          national_drug_code: d.national_drug_code || null,
          company_name: d.company_name || null,
          min_pac_quantity: d.min_pac_quantity || null,
          min_measure_unit: d.min_measure_unit || null,
        }));
        try {
          await db.insert(userTrackedDrugs).values(batch as never);
        } catch (restoreErr) {
          // 补偿批次失败不抛出，避免掩盖原始错误；记录日志供排查
          console.error('[Ledger] 覆盖导入补偿恢复批次失败:', restoreErr);
        }
      }
    }
    throw insertError;
  }

  return { success: true, count: inserted };
}

/**
 * 更新监控药品
 */
export async function updateTrackedDrug(id: string, updates: Partial<UserTrackedDrug>) {
  await db
    .update(userTrackedDrugs)
    .set({ ...updates, updated_at: new Date() } as never)
    .where(eq(userTrackedDrugs.id, id));
  return true;
}

/**
 * 删除监控药品
 */
export async function deleteTrackedDrug(id: string) {
  await db.delete(userTrackedDrugs).where(eq(userTrackedDrugs.id, id));
  return true;
}

/**
 * 获取台账历史数据列表
 */
export async function getDailyLedgers(options?: {
  page?: number;
  pageSize?: number;
  productName?: string;
  nationalDrugCode?: string;
  companyName?: string;
  minPacQuantity?: string;
  minMeasureUnit?: string;
  startDate?: string;
  endDate?: string;
}) {
  const page = options?.page || 1;
  const pageSize = options?.pageSize || 20;
  const offset = (page - 1) * pageSize;
  const productName = normalizeQueryText(options?.productName);
  const nationalDrugCode = normalizeQueryText(options?.nationalDrugCode);
  const companyName = normalizeQueryText(options?.companyName);
  const minPacQuantity = normalizeQueryText(options?.minPacQuantity);
  const minMeasureUnit = normalizeQueryText(options?.minMeasureUnit);

  const conditions: SQL[] = [];

  if (productName) {
    conditions.push(like(drugDailyLedgers.product_name, `%${productName}%`) as SQL);
  }
  if (nationalDrugCode) {
    conditions.push(like(drugDailyLedgers.national_drug_code, `%${nationalDrugCode}%`) as SQL);
  }
  if (companyName) {
    conditions.push(like(drugDailyLedgers.company_name, `%${companyName}%`) as SQL);
  }
  if (minPacQuantity) {
    conditions.push(eq(drugDailyLedgers.min_pac_quantity, minPacQuantity) as SQL);
  }
  if (minMeasureUnit) {
    conditions.push(like(drugDailyLedgers.min_measure_unit, `%${minMeasureUnit}%`) as SQL);
  }
  if (options?.startDate) {
    conditions.push(gte(drugDailyLedgers.stat_date, options.startDate) as SQL);
  }
  if (options?.endDate) {
    conditions.push(lte(drugDailyLedgers.stat_date, options.endDate) as SQL);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [dataRows, countRows] = await Promise.all([
    db
      .select()
      .from(drugDailyLedgers)
      .where(whereClause)
      .orderBy(desc(drugDailyLedgers.stat_date), desc(drugDailyLedgers.created_at))
      .offset(offset)
      .limit(pageSize),
    db
      .select({ count: count() })
      .from(drugDailyLedgers)
      .where(whereClause),
  ]);

  return {
    data: dataRows.map(row => normalizeLedgerRow(row as unknown as Record<string, unknown>)),
    total: Number(countRows[0]?.count ?? 0),
  };
}

/**
 * 按指定日期列表批量查询台账记录（不分页，用于导出）
 * @param dates - 日期字符串数组，格式 YYYY-MM-DD
 * @param filters - 可选的筛选条件
 * @returns 匹配的台账记录数组
 */
export async function getDailyLedgersByDates(
  dates: string[],
  filters?: {
    productName?: string;
    nationalDrugCode?: string;
    companyName?: string;
    minPacQuantity?: string;
    minMeasureUnit?: string;
  }
): Promise<DrugDailyLedger[]> {
  if (!dates || dates.length === 0) return [];

  const productName = normalizeQueryText(filters?.productName);
  const nationalDrugCode = normalizeQueryText(filters?.nationalDrugCode);
  const companyName = normalizeQueryText(filters?.companyName);
  const minPacQuantity = normalizeQueryText(filters?.minPacQuantity);
  const minMeasureUnit = normalizeQueryText(filters?.minMeasureUnit);
  const allResults: DrugDailyLedger[] = [];

  const batchSize = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const conditions: SQL[] = [inArray(drugDailyLedgers.stat_date, dates) as SQL];

    if (productName) {
      conditions.push(like(drugDailyLedgers.product_name, `%${productName}%`) as SQL);
    }
    if (nationalDrugCode) {
      conditions.push(like(drugDailyLedgers.national_drug_code, `%${nationalDrugCode}%`) as SQL);
    }
    if (companyName) {
      conditions.push(like(drugDailyLedgers.company_name, `%${companyName}%`) as SQL);
    }
    if (minPacQuantity) {
      conditions.push(eq(drugDailyLedgers.min_pac_quantity, minPacQuantity) as SQL);
    }
    if (minMeasureUnit) {
      conditions.push(like(drugDailyLedgers.min_measure_unit, `%${minMeasureUnit}%`) as SQL);
    }

    const whereClause = and(...conditions);

    const rows = await db
      .select()
      .from(drugDailyLedgers)
      .where(whereClause)
      .orderBy(asc(drugDailyLedgers.product_name), asc(drugDailyLedgers.stat_date))
      .offset(offset)
      .limit(batchSize);

    if (rows.length > 0) {
      allResults.push(...rows.map(row => normalizeLedgerRow(row as unknown as Record<string, unknown>)));
      offset += batchSize;
      hasMore = rows.length === batchSize;
    } else {
      hasMore = false;
    }
  }

  return allResults;
}

/**
 * 调度执行台账合并同步：
 * 将用户追踪的配置应用到 drug_info_merged（汇总表），
 * 生成今天的快照写入 drug_daily_ledgers。
 *
 * @param options.onProgress 进度补丁回调；缺省时不发射（过渡期兼容）
 */
export async function executeLedgerSnapshot(
  options?: { onProgress?: (patch: LedgerProgressPatch) => void }
) {
  const emitProgress = options?.onProgress ?? (() => {});

  try {
    // 1. 获取所有用户追踪的药品配置
    const trackedRowsRaw = await db.select().from(userTrackedDrugs);
    const trackedDrugs = trackedRowsRaw as unknown as UserTrackedDrug[];

    if (!trackedDrugs || trackedDrugs.length === 0) {
      return { success: true, message: '没有需要监控的药品配置' };
    }

    emitProgress({ status: 'running', tracked: trackedDrugs.length, done: 0, startTime: Date.now(), endTime: null, error: null });

  // 统计日期按 Asia/Shanghai 自然日计算，避免 UTC 跨日导致“前一天”
  const statDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  // 3. 开始映射：为每个追踪药品，去 drug_info_merged 获取最新数据
  const ledgersToInsert: any[] = [];

  // 批量查询优化：收集所有追踪药品的关键字段，一次性查询 drug_info_merged，避免 N+1 问题
  const productNames = [...new Set(
    trackedDrugs.map(t => t.product_name?.trim()).filter(Boolean) as string[]
  )];
  const nationalDrugCodes = [...new Set(
    trackedDrugs.map(t => t.national_drug_code?.trim()).filter(Boolean) as string[]
  )];

  if (productNames.length === 0 && nationalDrugCodes.length === 0) {
    return { success: true, message: '没有有效的查询条件' };
  }

  // 避免 URI 过长：按字段分块查询并在内存去重
  const mergedRecordMap = new Map<string, any>();
  const queryBatchSize = 1000;

  const fetchMergedByField = async (field: 'product_name' | 'national_drug_code', values: string[]) => {
    let queryOffset = 0;
    let hasMore = true;
    while (hasMore) {
      const batchData = await db
        .select()
        .from(drugInfoMerged)
        .where(inArray(
          field === 'product_name' ? drugInfoMerged.product_name : drugInfoMerged.national_drug_code,
          values
        ))
        .offset(queryOffset)
        .limit(queryBatchSize);

      if (batchData.length > 0) {
        for (const row of batchData) {
          const key = row.id ?? `${row.product_name ?? ''}|${row.national_drug_code ?? ''}|${row.company_name ?? ''}|${row.spec ?? ''}`;
          mergedRecordMap.set(String(key), row);
        }
        queryOffset += queryBatchSize;
        hasMore = batchData.length === queryBatchSize;
      } else {
        hasMore = false;
      }
    }
  };

  for (const values of chunkArray(productNames, CONDITION_CHUNK_SIZE)) {
    await fetchMergedByField('product_name', values);
  }
  for (const values of chunkArray(nationalDrugCodes, CONDITION_CHUNK_SIZE)) {
    await fetchMergedByField('national_drug_code', values);
  }

  const allMergedRecords = Array.from(mergedRecordMap.values());

  /**
   * 严格匹配判定：追踪药品的非空字段必须与合并表记录完全相等
   */
  const isStrictMatch = (track: UserTrackedDrug, record: any): boolean => {
    if (track.national_drug_code?.trim() && record.national_drug_code !== track.national_drug_code.trim()) return false;
    if (track.product_name?.trim() && record.product_name !== track.product_name.trim()) return false;
    if (track.company_name?.trim() && record.company_name !== track.company_name.trim()) return false;
    if (track.min_pac_quantity?.trim() && String(record.min_pac_quantity) !== track.min_pac_quantity.trim()) return false;
    if (track.min_measure_unit?.trim() && record.min_measure_unit !== track.min_measure_unit.trim()) return false;
    return true;
  };

  // 在内存中为每个追踪药品匹配对应的合并表记录
  for (const track of trackedDrugs) {
    const bestMatch = allMergedRecords.find(record => isStrictMatch(track, record));

    if (bestMatch) {
      const mergedRecord = bestMatch;

      ledgersToInsert.push({
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15) + Date.now().toString(36),
        tracked_drug_id: track.id,
        stat_date: statDate,
        product_name: track.product_name,
        national_drug_code: mergedRecord.national_drug_code || track.national_drug_code || null,
        dosform: mergedRecord.dosform || null,
        company_name: mergedRecord.company_name || track.company_name || null,
        spec: mergedRecord.spec || null,
        min_pac_quantity: mergedRecord.min_pac_quantity || track.min_pac_quantity || null,
        min_pac_unit: mergedRecord.min_pac_unit || null,
        min_measure_unit: mergedRecord.min_measure_unit || track.min_measure_unit || null,
        drug_net_type: mergedRecord.drug_net_type || null,
        net_time: mergedRecord.net_time || null,
        gpo_price: mergedRecord.gz_bid_price || null,
        provincial_price: mergedRecord.gd_price || null,
      });
    } else {
      console.log(`[Ledger] 未能在匹配表中找到药品数据：${track.product_name}`);
    }
  }

  if (ledgersToInsert.length === 0) {
    return { success: true, message: '没有任何追踪药品在库中匹配到数据' };
  }

  // 4. 清除同一天的旧数据以防重复跑批
  await db.delete(drugDailyLedgers).where(eq(drugDailyLedgers.stat_date, statDate));

  // 5. 插入最新历史记录快照
  const batchSize = 500;
  let savedCount = 0;
  for (let i = 0; i < ledgersToInsert.length; i += batchSize) {
    const batch = ledgersToInsert.slice(i, i + batchSize);
    await db.insert(drugDailyLedgers).values(batch as never);
    savedCount += batch.length;
    emitProgress({ done: savedCount });
  }

  emitProgress({ status: 'completed', done: savedCount, endTime: Date.now() });
  return { success: true, message: `成功快照 ${savedCount} 条药品台账(${statDate})` };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : '未知错误';
    console.error('[Ledger] 台账快照失败:', error);
    emitProgress({ status: 'error', error: errorMsg, endTime: Date.now() });
    throw error;
  }
}

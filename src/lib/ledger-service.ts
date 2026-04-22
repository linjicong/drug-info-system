import { getSupabaseClient } from '@/storage/database/supabase-client';

function normalizeQueryText(value?: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

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

  const client = getSupabaseClient();
  let query = client
    .from('user_tracked_drugs')
    .select('*')
    .order('created_at', { ascending: false });

  // 通用关键词搜索（产品名称或生产企业）
  if (keyword) {
    query = query.or(`product_name.ilike.%${keyword}%,company_name.ilike.%${keyword}%`);
  }

  // 单独字段筛选
  if (productName) {
    query = query.ilike('product_name', `%${productName}%`);
  }
  if (companyName) {
    query = query.ilike('company_name', `%${companyName}%`);
  }
  if (nationalDrugCode) {
    query = query.ilike('national_drug_code', `%${nationalDrugCode}%`);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`查询监控药品失败: ${error.message}`);
  }

  const trackedRows = (data || []) as UserTrackedDrug[];
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

  if (productNames.length > 0) {
    const { data: byNameRows, error: byNameErr } = await client
      .from('merged_drug_info')
      .select('id,product_name,national_drug_code,company_name,min_pac_quantity,min_measure_unit')
      .in('product_name', productNames);
    if (byNameErr) {
      throw new Error(`查询匹配状态失败(名称): ${byNameErr.message}`);
    }
    upsertMergedRows(byNameRows as any[]);
  }

  if (drugCodes.length > 0) {
    const { data: byCodeRows, error: byCodeErr } = await client
      .from('merged_drug_info')
      .select('id,product_name,national_drug_code,company_name,min_pac_quantity,min_measure_unit')
      .in('national_drug_code', drugCodes);
    if (byCodeErr) {
      throw new Error(`查询匹配状态失败(编码): ${byCodeErr.message}`);
    }
    upsertMergedRows(byCodeRows as any[]);
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
  const client = getSupabaseClient();
  
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

  const { error } = await client.from('user_tracked_drugs').insert(records);
  if (error) {
    throw new Error(`插入监控药品失败: ${error.message}`);
  }

  return { success: true, count: records.length };
}

/**
 * 覆盖导入监控药品：先清空历史配置，再批量插入新数据
 */
export async function replaceTrackedDrugs(drugs: UserTrackedDrug[]) {
  const client = getSupabaseClient();

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

  const { data: existingRows, error: backupErr } = await client
    .from('user_tracked_drugs')
    .select('id,product_name,national_drug_code,company_name,min_pac_quantity,min_measure_unit');
  if (backupErr) {
    throw new Error(`覆盖导入失败: 读取历史配置失败 - ${backupErr.message}`);
  }

  const { error: deleteErr } = await client
    .from('user_tracked_drugs')
    .delete()
    .not('id', 'is', null);
  if (deleteErr) {
    throw new Error(`清空监控药品失败: ${deleteErr.message}`);
  }

  const backupRecords = (existingRows || []) as UserTrackedDrug[];
  const batchSize = 500;
  let inserted = 0;
  try {
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const { error: insertErr } = await client.from('user_tracked_drugs').insert(batch);
      if (insertErr) {
        throw new Error(`覆盖导入插入失败: ${insertErr.message}`);
      }
      inserted += batch.length;
    }
  } catch (insertError) {
    // 尝试补偿恢复，避免“先删后插失败”导致配置丢失
    if (backupRecords.length > 0) {
      for (let i = 0; i < backupRecords.length; i += batchSize) {
        const batch = backupRecords.slice(i, i + batchSize);
        const { error: restoreErr } = await client.from('user_tracked_drugs').insert(batch);
        if (restoreErr) {
          throw new Error(
            `覆盖导入失败且回滚失败: ${insertError instanceof Error ? insertError.message : String(insertError)}；回滚错误: ${restoreErr.message}`
          );
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
  const client = getSupabaseClient();
  const { error } = await client
    .from('user_tracked_drugs')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    throw new Error(`更新监控药品失败: ${error.message}`);
  }
  return true;
}

/**
 * 删除监控药品
 */
export async function deleteTrackedDrug(id: string) {
  const client = getSupabaseClient();
  const { error } = await client
    .from('user_tracked_drugs')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`删除监控药品失败: ${error.message}`);
  }
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
  
  const client = getSupabaseClient();
  let query = client
    .from('drug_daily_ledgers')
    .select('*', { count: 'exact' })
    .order('stat_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (productName) {
    query = query.ilike('product_name', `%${productName}%`);
  }
  if (nationalDrugCode) {
    query = query.ilike('national_drug_code', `%${nationalDrugCode}%`);
  }
  if (companyName) {
    query = query.ilike('company_name', `%${companyName}%`);
  }
  if (minPacQuantity) {
    query = query.eq('min_pac_quantity', minPacQuantity);
  }
  if (minMeasureUnit) {
    query = query.ilike('min_measure_unit', `%${minMeasureUnit}%`);
  }
  if (options?.startDate) {
    query = query.gte('stat_date', options.startDate);
  }
  if (options?.endDate) {
    query = query.lte('stat_date', options.endDate);
  }

  const { data, error, count } = await query.range(offset, offset + pageSize - 1);
  if (error) {
    throw new Error(`查询台账历史失败: ${error.message}`);
  }

  return {
    data: data as DrugDailyLedger[],
    total: count || 0,
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

  const client = getSupabaseClient();
  const productName = normalizeQueryText(filters?.productName);
  const nationalDrugCode = normalizeQueryText(filters?.nationalDrugCode);
  const companyName = normalizeQueryText(filters?.companyName);
  const minPacQuantity = normalizeQueryText(filters?.minPacQuantity);
  const minMeasureUnit = normalizeQueryText(filters?.minMeasureUnit);
  const allResults: DrugDailyLedger[] = [];

  // Supabase 默认单次最多返回 1000 条，如果数据量大需要分页获取
  const batchSize = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let query = client
      .from('drug_daily_ledgers')
      .select('*')
      .in('stat_date', dates)
      .order('product_name', { ascending: true })
      .order('stat_date', { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (productName) {
      query = query.ilike('product_name', `%${productName}%`);
    }
    if (nationalDrugCode) {
      query = query.ilike('national_drug_code', `%${nationalDrugCode}%`);
    }
    if (companyName) {
      query = query.ilike('company_name', `%${companyName}%`);
    }
    if (minPacQuantity) {
      query = query.eq('min_pac_quantity', minPacQuantity);
    }
    if (minMeasureUnit) {
      query = query.ilike('min_measure_unit', `%${minMeasureUnit}%`);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`批量查询台账历史失败: ${error.message}`);
    }

    if (data && data.length > 0) {
      allResults.push(...(data as DrugDailyLedger[]));
      offset += batchSize;
      hasMore = data.length === batchSize; // 如果返回数量等于批次大小，可能还有更多
    } else {
      hasMore = false;
    }
  }

  return allResults;
}

/**
 * 调度执行台账合并同步：
 * 将用户追踪的配置应用到 merged_drug_info（汇总表），
 * 生成今天的快照写入 drug_daily_ledgers。
 */
export async function executeLedgerSnapshot() {
  const client = getSupabaseClient();
  
  // 1. 获取所有用户追踪的药品配置
  const { data: trackData, error: trackErr } = await client
    .from('user_tracked_drugs')
    .select('*');
    
  if (trackErr) {
    throw new Error(`获取用户配置失败: ${trackErr.message}`);
  }
  const trackedDrugs = trackData as UserTrackedDrug[];
  if (!trackedDrugs || trackedDrugs.length === 0) {
    return { success: true, message: '没有需要监控的药品配置' };
  }

  // 获取今天的格式化日期字符串
  const today = new Date();
  const statDate = today.toISOString().split('T')[0];
  
  // 3. 开始映射：为每个追踪药品，去 merged_drug_info 获取最新数据
  // 注意：真实场景中可能合并表数据量达几万，如果要准确匹配，
  // 我们循环或进行批量 in 查询。这里根据产品名称和企业名称进行查寻。
  
  const ledgersToInsert: any[] = [];

  // 批量查询优化：收集所有追踪药品的关键字段，一次性查询 merged_drug_info，避免 N+1 问题
  const productNames = [...new Set(
    trackedDrugs.map(t => t.product_name?.trim()).filter(Boolean) as string[]
  )];
  const nationalDrugCodes = [...new Set(
    trackedDrugs.map(t => t.national_drug_code?.trim()).filter(Boolean) as string[]
  )];

  if (productNames.length === 0 && nationalDrugCodes.length === 0) {
    return { success: true, message: '没有有效的查询条件' };
  }

  const chunkArray = <T,>(items: T[], chunkSize: number): T[][] => {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += chunkSize) {
      chunks.push(items.slice(i, i + chunkSize));
    }
    return chunks;
  };

  // 避免 URI 过长：按字段分块查询并在内存去重
  const mergedRecordMap = new Map<string, any>();
  const conditionChunkSize = 60;
  const queryBatchSize = 1000;
  const valueChunks = [
    { field: 'product_name', chunks: chunkArray(productNames, conditionChunkSize) },
    { field: 'national_drug_code', chunks: chunkArray(nationalDrugCodes, conditionChunkSize) },
  ] as const;

  for (const { field, chunks } of valueChunks) {
    for (const values of chunks) {
      let queryOffset = 0;
      let hasMore = true;
      while (hasMore) {
        const { data: batchData, error: batchErr } = await client
          .from('merged_drug_info')
          .select('*')
          .in(field, values)
          .range(queryOffset, queryOffset + queryBatchSize - 1);

        if (batchErr) {
          console.warn(`[Ledger] 警告：批量查询 merged_drug_info 失败(${field}) - ${batchErr.message}`);
          break;
        }

        if (batchData && batchData.length > 0) {
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
    }
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
  await client
    .from('drug_daily_ledgers')
    .delete()
    .eq('stat_date', statDate);

  // 5. 插入最新历史记录快照
  const batchSize = 500;
  let savedCount = 0;
  for (let i = 0; i < ledgersToInsert.length; i += batchSize) {
    const batch = ledgersToInsert.slice(i, i + batchSize);
    const { error: insErr } = await client.from('drug_daily_ledgers').insert(batch);
    if (insErr) {
      throw new Error(`插入台账每日快照失败: ${insErr.message}`);
    }
    savedCount += batch.length;
  }

  return { success: true, message: `成功快照 ${savedCount} 条药品台账(${statDate})` };
}


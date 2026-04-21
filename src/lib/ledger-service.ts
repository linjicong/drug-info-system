import { getSupabaseClient } from '@/storage/database/supabase-client';

export interface UserTrackedDrug {
  id?: string;
  product_name: string;
  national_drug_code?: string;
  company_name?: string;
  min_pac_quantity?: string;
  min_measure_unit?: string;
  created_at?: string;
  updated_at?: string;
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
 */
export async function getTrackedDrugs(options?: {
  page?: number;
  pageSize?: number;
  searchKeyword?: string;
}) {
  const page = options?.page || 1;
  const pageSize = options?.pageSize || 20;
  const offset = (page - 1) * pageSize;
  const keyword = options?.searchKeyword ? decodeURIComponent(options.searchKeyword) : undefined;

  const client = getSupabaseClient();
  let query = client
    .from('user_tracked_drugs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (keyword) {
    query = query.or(`product_name.ilike.%${keyword}%,company_name.ilike.%${keyword}%`);
  }

  const { data, error, count } = await query.range(offset, offset + pageSize - 1);
  if (error) {
    throw new Error(`查询监控药品失败: ${error.message}`);
  }

  return {
    data: data as UserTrackedDrug[],
    total: count || 0,
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
  const productName = options?.productName ? decodeURIComponent(options.productName).trim() : undefined;
  const nationalDrugCode = options?.nationalDrugCode ? decodeURIComponent(options.nationalDrugCode).trim() : undefined;
  const companyName = options?.companyName ? decodeURIComponent(options.companyName).trim() : undefined;
  const minPacQuantity = options?.minPacQuantity ? decodeURIComponent(options.minPacQuantity).trim() : undefined;
  const minMeasureUnit = options?.minMeasureUnit ? decodeURIComponent(options.minMeasureUnit).trim() : undefined;
  
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
  const productName = filters?.productName ? decodeURIComponent(filters.productName).trim() : undefined;
  const nationalDrugCode = filters?.nationalDrugCode ? decodeURIComponent(filters.nationalDrugCode).trim() : undefined;
  const companyName = filters?.companyName ? decodeURIComponent(filters.companyName).trim() : undefined;
  const minPacQuantity = filters?.minPacQuantity ? decodeURIComponent(filters.minPacQuantity).trim() : undefined;
  const minMeasureUnit = filters?.minMeasureUnit ? decodeURIComponent(filters.minMeasureUnit).trim() : undefined;
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

  // 构建批量查询条件：按产品名称或医保编码匹配
  let batchQuery = client.from('merged_drug_info').select('*');
  const orConditions: string[] = [];
  if (productNames.length > 0) {
    orConditions.push(`product_name.in.(${productNames.map(n => `"${n}"`).join(',')})`);
  }
  if (nationalDrugCodes.length > 0) {
    orConditions.push(`national_drug_code.in.(${nationalDrugCodes.map(c => `"${c}"`).join(',')})`);
  }

  if (orConditions.length === 0) {
    return { success: true, message: '没有有效的查询条件' };
  }

  batchQuery = batchQuery.or(orConditions.join(','));

  // 分页获取所有匹配的合并表记录（Supabase 默认单次最多返回 1000 条）
  const allMergedRecords: any[] = [];
  const queryBatchSize = 1000;
  let queryOffset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: batchData, error: batchErr } = await batchQuery
      .range(queryOffset, queryOffset + queryBatchSize - 1);

    if (batchErr) {
      console.warn(`[Ledger] 警告：批量查询 merged_drug_info 失败 - ${batchErr.message}`);
      break;
    }

    if (batchData && batchData.length > 0) {
      allMergedRecords.push(...batchData);
      queryOffset += queryBatchSize;
      hasMore = batchData.length === queryBatchSize;
    } else {
      hasMore = false;
    }
  }

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


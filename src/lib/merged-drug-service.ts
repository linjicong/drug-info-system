/**
 * 整合药品数据服务
 * 负责从广东医保和广州采购平台源表抽取数据、合并去重，
 * 并将结果持久化到 merged_drug_info 表。
 * 同时提供合并数据的新表查询和导出服务。
 */

import { getSupabaseClient } from '@/storage/database/supabase-client';
import type { MergedDrugInfo, DrugSource } from '@/components/drug/types';
import {
  startMergeProgress,
  updateMergeProgress,
  completeMergeProgress,
  setMergeProgressError,
} from './merged-progress-manager';

// ─── 内部类型定义 ───────────────────────────────────────────────────

/** 广东医保数据库行类型（与 pubonln_drug_info 表字段对应） */
interface GdDrugRow {
  id: string;
  genname: string;
  drug_code?: string;
  dosform_name?: string;
  prodentp_name?: string;
  reg_spec_name?: string;
  convrat?: string;
  minpac_name?: string;
  minunt_name?: string;
  drug_select_type?: string;
  pubonln_time?: string;
  jyl_category?: string;
  pacmatl?: string;
  min_pac_pubonln_pric?: number;
}

/** 广州采购平台数据库行类型（与 drug_info 表字段对应） */
interface GzDrugRow {
  id: string;
  product_name: string;
  national_drug_code?: string;
  medicinemodel?: string;
  company_name_sc?: string;
  outlook?: string;
  factor?: number;
  unit?: string;
  min_unit?: string;
  source_type?: string;
  net_time?: string;
  medicare_type?: number;
  material_name?: string;
  bid_price?: number;
  min_unit_price?: number;
}

// ─── 工具函数 ─────────────────────────────────────────────────────

/**
 * 规范化字符串：去除首尾空白并转小写，用于去重 key 比较
 */
function normalize(value?: string | number | null): string {
  if (value === undefined || value === null) return '';
  return String(value).trim().toLowerCase();
}

/**
 * 将广州平台的 medicare_type 数字转为中文标签
 */
function formatMedicareType(type?: number): string | undefined {
  if (type === undefined || type === null) return undefined;
  const map: Record<number, string> = { 0: '非医保', 1: '甲类', 2: '乙类' };
  return map[type] ?? String(type);
}

/**
 * 生成五字段去重 key
 */
function buildDedupeKey(
  productName: string,
  drugCode: string,
  company: string,
  minQuantity: string,
  minUnit: string
): string {
  return [
    normalize(productName),
    normalize(drugCode),
    normalize(company),
    normalize(minQuantity),
    normalize(minUnit),
  ].join('|||');
}

/**
 * 将广东医保行映射为合并前中间结构
 */
function mapGdRow(row: GdDrugRow): Omit<MergedDrugInfo, 'id'> {
  return {
    source: 'gd_only' as DrugSource,
    product_name: row.genname || '',
    national_drug_code: row.drug_code || undefined,
    dosform: row.dosform_name || undefined,
    company_name: row.prodentp_name || undefined,
    spec: row.reg_spec_name || undefined,
    min_pac_quantity: row.convrat || undefined,
    min_pac_unit: row.minpac_name || undefined,
    min_measure_unit: row.minunt_name || undefined,
    drug_net_type: row.drug_select_type || undefined,
    net_time: row.pubonln_time || undefined,
    medicare_type_label: row.jyl_category || undefined,
    package_material: row.pacmatl || undefined,
    gd_price: row.min_pac_pubonln_pric ?? undefined,
  };
}

/**
 * 将广州采购平台行映射为合并前中间结构
 */
function mapGzRow(row: GzDrugRow): Omit<MergedDrugInfo, 'id'> {
  return {
    source: 'gz_only' as DrugSource,
    product_name: row.product_name || '',
    national_drug_code: row.national_drug_code || undefined,
    dosform: row.medicinemodel || undefined,
    company_name: row.company_name_sc || undefined,
    spec: row.outlook || undefined,
    min_pac_quantity: row.factor ?? undefined,
    min_pac_unit: row.unit || undefined,
    min_measure_unit: row.min_unit || undefined,
    drug_net_type: row.source_type || undefined,
    net_time: row.net_time || undefined,
    medicare_type_label: formatMedicareType(row.medicare_type),
    package_material: row.material_name || undefined,
    gz_bid_price: row.bid_price ?? undefined,
    gz_min_unit_price: row.min_unit_price ?? undefined,
  };
}

// ─── 核心同步与合并逻辑 ──────────────────────────────────────────────

/**
 * 提取全量广东医保数据
 */
async function fetchAllGdDrugs(): Promise<GdDrugRow[]> {
  const client = getSupabaseClient();
  let allData: GdDrugRow[] = [];
  let offset = 0;
  const batchSize = 1000;
  const selectFields = [
    'id', 'genname', 'drug_code', 'dosform_name', 'prodentp_name',
    'reg_spec_name', 'convrat', 'minpac_name', 'minunt_name',
    'drug_select_type', 'pubonln_time', 'jyl_category', 'pacmatl',
    'min_pac_pubonln_pric'
  ].join(',');

  while (true) {
    const { data, error } = await client
      .from('pubonln_drug_info')
      .select(selectFields)
      .range(offset, offset + batchSize - 1);
      
    if (error) throw error;
    if (!data || data.length === 0) break;
    
    allData = allData.concat(data as unknown as GdDrugRow[]);
    offset += batchSize;
    if (data.length < batchSize) break;
  }
  return allData;
}

/**
 * 提取全量广州采购平台数据
 */
async function fetchAllGzDrugs(): Promise<GzDrugRow[]> {
  const client = getSupabaseClient();
  let allData: GzDrugRow[] = [];
  let offset = 0;
  const batchSize = 1000;
  const selectFields = [
    'id', 'product_name', 'national_drug_code', 'medicinemodel', 'company_name_sc',
    'outlook', 'factor', 'unit', 'min_unit', 'source_type', 'net_time',
    'medicare_type', 'material_name', 'bid_price', 'min_unit_price'
  ].join(',');

  while (true) {
    const { data, error } = await client
      .from('drug_info')
      .select(selectFields)
      .range(offset, offset + batchSize - 1);
      
    if (error) throw error;
    if (!data || data.length === 0) break;
    
    allData = allData.concat(data as unknown as GzDrugRow[]);
    offset += batchSize;
    if (data.length < batchSize) break;
  }
  return allData;
}

/**
 * 加载两张表的数据并进行五字段联合去重合并
 * @param gdRows 广东医保数据行
 * @param gzRows 广州采购平台数据行
 */
function mergeAndDedupe(gdRows: GdDrugRow[], gzRows: GzDrugRow[]): Omit<MergedDrugInfo, 'id'>[] {
  const mergedMap = new Map<string, Omit<MergedDrugInfo, 'id'>>();

  for (const row of gdRows) {
    const key = buildDedupeKey(
      row.genname,
      row.drug_code || '',
      row.prodentp_name || '',
      row.convrat || '',
      row.minpac_name || ''
    );
    mergedMap.set(key, mapGdRow(row));
  }

  for (const row of gzRows) {
    const key = buildDedupeKey(
      row.product_name,
      row.national_drug_code || '',
      row.company_name_sc || '',
      row.factor !== undefined ? String(row.factor) : '',
      row.unit || ''
    );

    const existing = mergedMap.get(key);
    if (existing) {
      existing.source = 'both';
      existing.gz_bid_price = row.bid_price ?? undefined;
      existing.gz_min_unit_price = row.min_unit_price ?? undefined;
      if (!existing.dosform && row.medicinemodel) existing.dosform = row.medicinemodel;
      if (!existing.drug_net_type && row.source_type) existing.drug_net_type = row.source_type;
      if (!existing.net_time && row.net_time) existing.net_time = row.net_time;
      if (!existing.medicare_type_label && row.medicare_type !== undefined) {
        existing.medicare_type_label = formatMedicareType(row.medicare_type);
      }
      if (!existing.package_material && row.material_name) existing.package_material = row.material_name;
    } else {
      mergedMap.set(key, mapGzRow(row));
    }
  }

  return Array.from(mergedMap.values());
}

/**
 * 将本地合并且统一字段的数据，写入远程数据库的合并表 `merged_drug_info`
 */
export async function syncMergedDrugData(): Promise<{ success: boolean; message: string; error?: string }> {
  try {
    startMergeProgress();

    updateMergeProgress({ phase: '正在查询广东医保数据...' });
    const gdRows = await fetchAllGdDrugs();
    updateMergeProgress({ gdLoaded: gdRows.length });

    updateMergeProgress({ phase: '正在查询广州采购平台数据...' });
    const gzRows = await fetchAllGzDrugs();
    updateMergeProgress({ gzLoaded: gzRows.length });

    updateMergeProgress({ phase: '正在合并去重数据...' });
    const mergedData = mergeAndDedupe(gdRows, gzRows);
    
    // 生成插入记录（使用 crypto.randomUUID 生成 id，防止 edge runtime 冲突可使用内置能力，这里用简单时间戳加随机字符串作为折中保证无依赖）
    const recordsToInsert = mergedData.map(item => ({
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15) + Date.now().toString(36),
      source: item.source,
      product_name: item.product_name,
      national_drug_code: item.national_drug_code ?? null,
      dosform: item.dosform ?? null,
      company_name: item.company_name ?? null,
      spec: item.spec ?? null,
      min_pac_quantity: item.min_pac_quantity !== undefined ? String(item.min_pac_quantity) : null,
      min_pac_unit: item.min_pac_unit ?? null,
      min_measure_unit: item.min_measure_unit ?? null,
      drug_net_type: item.drug_net_type ?? null,
      net_time: item.net_time ?? null,
      medicare_type_label: item.medicare_type_label ?? null,
      package_material: item.package_material ?? null,
      gd_price: item.gd_price ?? null,
      gz_bid_price: item.gz_bid_price ?? null,
      gz_min_unit_price: item.gz_min_unit_price ?? null,
    }));
    
    updateMergeProgress({ mergedTotal: recordsToInsert.length });

    const client = getSupabaseClient();
    
    updateMergeProgress({ phase: '清空旧合并数据...' });
    const { error: delError } = await client.from('merged_drug_info').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (delError) {
      throw new Error(`清空数据失败: ${delError.message}`);
    }

    updateMergeProgress({ phase: '正在将合并数据写入新表...' });
    let savedCount = 0;
    const insBatchSize = 500;
    
    for (let i = 0; i < recordsToInsert.length; i += insBatchSize) {
      const batch = recordsToInsert.slice(i, i + insBatchSize);
      const { error: insError } = await client.from('merged_drug_info').insert(batch);
      
      if (insError) {
        throw new Error(`写入批次数据失败 (offset: ${i}): ${insError.message}`);
      }
      
      savedCount += batch.length;
      updateMergeProgress({ savedCount });
    }

    completeMergeProgress();
    return { success: true, message: '合并完成并已持久化到数据库' };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : '未知错误';
    console.error('[MergedDrugService] 同步失败:', error);
    setMergeProgressError(errorMsg);
    return { success: false, message: '合并同步失败', error: errorMsg };
  }
}

// ─── 新表查询与导出服务 ──────────────────────────────────────────────

/**
 * 查询持久化后的整合药品列表（从 merged_drug_info 表读）
 *
 * @param options 查询参数
 */
export async function getMergedDrugList(options?: {
  page?: number;
  pageSize?: number;
  searchKeyword?: string;
}): Promise<{ data: MergedDrugInfo[]; total: number }> {
  const page = options?.page || 1;
  const pageSize = options?.pageSize || 20;
  const offset = (page - 1) * pageSize;
  const keyword = options?.searchKeyword ? decodeURIComponent(options.searchKeyword) : undefined;

  const client = getSupabaseClient();

  let query = client
    .from('merged_drug_info')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (keyword) {
    query = query.or(
      `product_name.ilike.%${keyword}%,company_name.ilike.%${keyword}%`
    );
  }

  query = query.range(offset, offset + pageSize - 1);

  const { data, error, count } = await query;

  if (error) {
    console.error('[MergedDrugService] 查询合并数据失败:', error.message);
    throw new Error(`查询合并数据失败: ${error.message}`);
  }

  return {
    data: (data || []) as MergedDrugInfo[],
    total: count || 0,
  };
}

/**
 * 导出所有持久化整合药品数据（从 merged_drug_info 表读）
 */
export async function exportMergedDrugData(options?: {
  searchKeyword?: string;
}): Promise<MergedDrugInfo[]> {
  const client = getSupabaseClient();
  const keyword = options?.searchKeyword ? decodeURIComponent(options.searchKeyword) : undefined;
  
  let allData: MergedDrugInfo[] = [];
  let offset = 0;
  const batchSize = 1000;

  while (true) {
    let query = client
      .from('merged_drug_info')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + batchSize - 1);

    if (keyword) {
      query = query.or(
        `product_name.ilike.%${keyword}%,company_name.ilike.%${keyword}%`
      );
    }

    const { data, error } = await query;

    if (error) {
      console.error('[MergedDrugService] 导出合并数据失败:', error.message);
      throw new Error(`导出合并数据失败: ${error.message}`);
    }

    if (!data || data.length === 0) break;

    allData = allData.concat(data as MergedDrugInfo[]);
    offset += batchSize;
    if (data.length < batchSize) break;
  }

  console.log(`[MergedDrugService] 导出数据: ${allData.length} 条`);
  return allData;
}

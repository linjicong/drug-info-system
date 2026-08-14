/**
 * 整合药品数据服务
 * 负责从广东医保和广州采购平台源表抽取数据、合并去重，
 * 并将结果持久化到 drug_info_merged 表。
 * 同时提供合并数据的新表查询和导出服务。
 */

import { db } from '@/storage/database/db';
import { drugInfoMerged, drugInfoGz, drugInfoGd } from '@/storage/database/shared/schema';
import { and, asc, desc, eq, gt, like, or, type SQL } from 'drizzle-orm';
import type { MergedDrugInfo, DrugSource } from '@/components/drug/types';
import { getPagedList, fetchAllInBatches, createRowNormalizer } from './shared/db-query';
import { updateMergeProgress } from './merged-progress-manager';
import type { MergeProgressPatch } from './progress-patch';

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
  min_pac_pubonln_pric?: number | string;
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
  bid_price?: number | string;
  min_unit_price?: number | string;
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
  const map: Record<number, string> = { 0: '甲类', 1: '乙类', 2: '非医保' };
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
    // drizzle decimal 返回 string，转 number 保持与原 Supabase numeric 行为一致
    gd_price: row.min_pac_pubonln_pric != null ? Number(row.min_pac_pubonln_pric) : undefined,
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
    gz_bid_price: row.bid_price != null ? Number(row.bid_price) : undefined,
    gz_min_unit_price: row.min_unit_price != null ? Number(row.min_unit_price) : undefined,
  };
}

/**
 * 规整查询返回的合并行：decimal 字段转 number，保持前端类型一致
 */
export const normalizeMergedRow = createRowNormalizer<MergedDrugInfo>(
  ['gd_price', 'gz_bid_price', 'gz_min_unit_price'],
  { emptyValue: null },
);

// ─── 核心同步与合并逻辑 ──────────────────────────────────────────────

/**
 * 提取全量广东医保数据
 */
async function fetchAllGdDrugs(emitProgress: (patch: MergeProgressPatch) => void): Promise<GdDrugRow[]> {
  let allData: GdDrugRow[] = [];
  // keyset 分页（WHERE id > lastId）：OFFSET 深分页在 TiDB 上每页都要重扫前面所有行，
  // 4 万+行时整个查询阶段长达数分钟且进度无反馈，前端看起来像卡死
  let lastId = '';
  const batchSize = 1000;

  while (true) {
    const rows = await db
      .select({
        id: drugInfoGd.id,
        genname: drugInfoGd.genname,
        drug_code: drugInfoGd.drug_code,
        dosform_name: drugInfoGd.dosform_name,
        prodentp_name: drugInfoGd.prodentp_name,
        reg_spec_name: drugInfoGd.reg_spec_name,
        convrat: drugInfoGd.convrat,
        minpac_name: drugInfoGd.minpac_name,
        minunt_name: drugInfoGd.minunt_name,
        drug_select_type: drugInfoGd.drug_select_type,
        pubonln_time: drugInfoGd.pubonln_time,
        jyl_category: drugInfoGd.jyl_category,
        pacmatl: drugInfoGd.pacmatl,
        min_pac_pubonln_pric: drugInfoGd.min_pac_pubonln_pric,
      })
      .from(drugInfoGd)
      .where(gt(drugInfoGd.id, lastId))
      .orderBy(asc(drugInfoGd.id))
      .limit(batchSize);

    if (rows.length === 0) break;

    allData = allData.concat(rows as unknown as GdDrugRow[]);
    lastId = String(rows[rows.length - 1].id);
    // 每批回写进度，避免长查询期间前端数字纹丝不动
    emitProgress({ gdLoaded: allData.length });
    if (rows.length < batchSize) break;
  }
  return allData;
}

/**
 * 提取全量广州采购平台数据
 */
async function fetchAllGzDrugs(emitProgress: (patch: MergeProgressPatch) => void): Promise<GzDrugRow[]> {
  let allData: GzDrugRow[] = [];
  // 同 fetchAllGdDrugs：keyset 分页替代 OFFSET 深分页
  let lastId = '';
  const batchSize = 1000;

  while (true) {
    const rows = await db
      .select({
        id: drugInfoGz.id,
        product_name: drugInfoGz.product_name,
        national_drug_code: drugInfoGz.national_drug_code,
        medicinemodel: drugInfoGz.medicinemodel,
        company_name_sc: drugInfoGz.company_name_sc,
        outlook: drugInfoGz.outlook,
        factor: drugInfoGz.factor,
        unit: drugInfoGz.unit,
        min_unit: drugInfoGz.min_unit,
        source_type: drugInfoGz.source_type,
        net_time: drugInfoGz.net_time,
        medicare_type: drugInfoGz.medicare_type,
        material_name: drugInfoGz.material_name,
        bid_price: drugInfoGz.bid_price,
        min_unit_price: drugInfoGz.min_unit_price,
      })
      .from(drugInfoGz)
      .where(gt(drugInfoGz.id, lastId))
      .orderBy(asc(drugInfoGz.id))
      .limit(batchSize);

    if (rows.length === 0) break;

    allData = allData.concat(rows as unknown as GzDrugRow[]);
    lastId = String(rows[rows.length - 1].id);
    emitProgress({ gzLoaded: allData.length });
    if (rows.length < batchSize) break;
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
      existing.gz_bid_price = row.bid_price != null ? Number(row.bid_price) : undefined;
      existing.gz_min_unit_price = row.min_unit_price != null ? Number(row.min_unit_price) : undefined;
      // 对于判定为相同的行，除了保留广州特有的价格字段外，需要合并的其他共用字段均取广东医保数据（不进行回填）
    } else {
      mergedMap.set(key, mapGzRow(row));
    }
  }

  return Array.from(mergedMap.values());
}

/**
 * 构建合并数据查询的动态筛选条件
 */
function buildMergedConditions(
  options: {
    searchKeyword?: string;
    productName?: string;
    companyName?: string;
    source?: string;
    medicareTypeLabel?: string;
    nationalDrugCode?: string;
    minPacQuantity?: string;
    minMeasureUnit?: string;
  } | undefined,
  keyword?: string
): SQL | undefined {
  const conditions: SQL[] = [];

  if (keyword) {
    // MySQL 无 ILIKE，使用 LIKE（TiDB 默认 collation 对中文无影响；英文大小写敏感性依赖 collation）
    conditions.push(or(
      like(drugInfoMerged.product_name, `%${keyword}%`),
      like(drugInfoMerged.company_name, `%${keyword}%`)
    ) as SQL);
  }

  if (options?.productName) {
    conditions.push(like(drugInfoMerged.product_name, `%${decodeURIComponent(options.productName)}%`) as SQL);
  }

  if (options?.companyName) {
    conditions.push(like(drugInfoMerged.company_name, `%${options.companyName}%`) as SQL);
  }

  if (options?.source) {
    conditions.push(eq(drugInfoMerged.source, options.source) as SQL);
  }

  if (options?.medicareTypeLabel) {
    conditions.push(eq(drugInfoMerged.medicare_type_label, options.medicareTypeLabel) as SQL);
  }

  if (options?.nationalDrugCode) {
    conditions.push(like(drugInfoMerged.national_drug_code, `%${options.nationalDrugCode}%`) as SQL);
  }

  if (options?.minPacQuantity) {
    conditions.push(like(drugInfoMerged.min_pac_quantity, `%${decodeURIComponent(options.minPacQuantity)}%`) as SQL);
  }

  if (options?.minMeasureUnit) {
    conditions.push(like(drugInfoMerged.min_measure_unit, `%${decodeURIComponent(options.minMeasureUnit)}%`) as SQL);
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

/**
 * 将本地合并且统一字段的数据，写入远程数据库的合并表 `drug_info_merged`
 *
 * @param options.onProgress 进度补丁回调；缺省时回退写入内存进度 store（过渡期兼容）
 */
export async function syncMergedDrugData(
  options?: { onProgress?: (patch: MergeProgressPatch) => void }
): Promise<{ success: boolean; message: string; error?: string }> {
  const emitProgress = options?.onProgress ?? ((patch: MergeProgressPatch) => updateMergeProgress(patch));

  try {
    emitProgress({
      status: 'running',
      phase: '正在准备数据...',
      gdLoaded: 0,
      gzLoaded: 0,
      mergedTotal: 0,
      savedCount: 0,
      startTime: Date.now(),
      endTime: null,
      error: null,
    });

    emitProgress({ phase: '正在查询广东医保数据...' });
    const gdRows = await fetchAllGdDrugs(emitProgress);
    emitProgress({ gdLoaded: gdRows.length });

    emitProgress({ phase: '正在查询广州采购平台数据...' });
    const gzRows = await fetchAllGzDrugs(emitProgress);
    emitProgress({ gzLoaded: gzRows.length });

    emitProgress({ phase: '正在合并去重数据...' });
    const mergedData = mergeAndDedupe(gdRows, gzRows);

    // 生成插入记录（应用层生成 UUID，避免 MySQL 不支持 RETURNING 需回查）
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

    emitProgress({ mergedTotal: recordsToInsert.length });

    emitProgress({ phase: '清空旧合并数据...' });
    // 清空全表（等价于原 .neq('id', 全零UUID) 的清表语义）
    await db.delete(drugInfoMerged);

    emitProgress({ phase: '正在将合并数据写入新表...' });
    let savedCount = 0;
    const insBatchSize = 500;

    for (let i = 0; i < recordsToInsert.length; i += insBatchSize) {
      const batch = recordsToInsert.slice(i, i + insBatchSize);
      await db.insert(drugInfoMerged).values(batch as never);

      savedCount += batch.length;
      emitProgress({ savedCount });
    }

    emitProgress({ status: 'completed', phase: '合并完成', endTime: Date.now() });
    return { success: true, message: '合并完成并已持久化到数据库' };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : '未知错误';
    console.error('[MergedDrugService] 同步失败:', error);
    emitProgress({ status: 'error', phase: '合并失败', error: errorMsg, endTime: Date.now() });
    return { success: false, message: '合并同步失败', error: errorMsg };
  }
}

// ─── 新表查询与导出服务 ──────────────────────────────────────────────

/**
 * 查询持久化后的整合药品列表（从 drug_info_merged 表读）
 *
 * @param options 查询参数
 */
export async function getMergedDrugList(options?: {
  page?: number;
  pageSize?: number;
  searchKeyword?: string;
  productName?: string;
  companyName?: string;
  source?: string;
  medicareTypeLabel?: string;
  nationalDrugCode?: string;
  minPacQuantity?: string;
  minMeasureUnit?: string;
}): Promise<{ data: MergedDrugInfo[]; total: number }> {
  const page = options?.page || 1;
  const pageSize = options?.pageSize || 20;
  const keyword = options?.searchKeyword ? decodeURIComponent(options.searchKeyword) : undefined;

  return getPagedList<MergedDrugInfo>({
    table: drugInfoMerged,
    where: buildMergedConditions(options, keyword),
    orderBy: desc(drugInfoMerged.created_at),
    page,
    pageSize,
    normalizeRow: normalizeMergedRow,
  });
}

/**
 * 导出所有持久化整合药品数据（从 drug_info_merged 表读）
 */
export async function exportMergedDrugData(options?: {
  searchKeyword?: string;
  productName?: string;
  companyName?: string;
  source?: string;
  medicareTypeLabel?: string;
  nationalDrugCode?: string;
  minPacQuantity?: string;
  minMeasureUnit?: string;
}): Promise<MergedDrugInfo[]> {
  const keyword = options?.searchKeyword ? decodeURIComponent(options.searchKeyword) : undefined;

  const allData = await fetchAllInBatches<MergedDrugInfo>({
    table: drugInfoMerged,
    where: buildMergedConditions(options, keyword),
    orderBy: desc(drugInfoMerged.created_at),
    normalizeRow: normalizeMergedRow,
  });

  console.log(`[MergedDrugService] 导出数据: ${allData.length} 条`);
  return allData;
}

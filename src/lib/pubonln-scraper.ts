/**
 * 广东医保服务平台挂网药品信息抓取模块
 * API 端点通过环境变量 PUBONLN_API_URL 配置
 */

import { db } from '@/storage/database/db';
import { drugInfoGd } from '@/storage/database/shared/schema';
import { and, count, desc, isNotNull, like, or, type SQL } from 'drizzle-orm';
import https from 'https';
import { getPubonlnApiConfig, buildRequestOptions } from './api-config';
import { promisePool } from './concurrent-pool';
import {
  updateProgress,
  startProgress,
  completeProgress,
  setErrorProgress,
  resetProgress,
} from './progress-manager';

const PROGRESS_SOURCE = 'gd_pubonln' as const;

// 挂网药品信息接口 - 完整字段
export interface PubonlnDrugInfo {
  id?: string;
  // 药品ID
  drug_id?: number;
  // 全省交易状态
  gw_active?: string;
  // 注册名称（通用名）
  genname: string;
  // 商品名
  trade_name?: string;
  // 注册剂型
  reg_dosform_name?: string;
  // 剂型名称
  dosform_name?: string;
  // 注册规格
  reg_spec_name?: string;
  // 包装材质
  pacmatl?: string;
  // 规格属性
  specification_properties?: string;
  // 上市许可持有人
  listing_license_holder?: string;
  // 生产企业
  prodentp_name?: string;
  // 申报企业
  dcla_entp_name?: string;
  // 批准文号
  aprvno?: string;
  // 最小包装数量（转换比）
  convrat?: string;
  // 最小计量单位
  minunt_name?: string;
  // 最小包装单位
  minpac_name?: string;
  // 挂网价格(元)
  min_pac_pubonln_pric?: number;
  // 挂网时间
  pubonln_time?: string;
  // 药品分类
  drug_class?: string;
  // 政策属性
  policy_att?: string;
  // 政策类别
  drug_select_type?: string;
  // 质量层次
  quality_lv?: string;
  // 是否国家基药
  is_national_basic_drug?: string;
  // 是否短缺易短缺药品
  is_shortage_drug?: string;
  // 编号
  jyl_no?: string;
  // 甲乙类
  jyl_category?: string;
  // 失信等级
  dishonesty_lv?: string;
  // 是否修复
  dishonesty_stas?: string;
  // 价格风险提示
  price_risk?: string;
  // 国家医保代码
  drug_code?: string;
  // 招采系统ID
  zc_spt_id?: string;
  // 申报企业统一社会信用代码
  dcla_entp_uscc?: string;
  // 形成方式
  formation_mode?: string;
  // 是否暂停挂网
  stop_pubonln?: number;
  // 是否存在挂网价格
  exist_pubonln_pric?: number;
  // 备注
  remark?: string;
  created_at?: string;
  updated_at?: string;
}

// 抓取结果接口
export interface PubonlnScrapeResult {
  success: boolean;
  message: string;
  total?: number;
  newCount?: number;
  updateCount?: number;
  error?: string;
}

// API 返回数据接口
interface PubonlnApiResponse {
  code: number;
  message?: string;
  data: {
    records: PubonlnApiDrugItem[];
    total: number;
    size: number;
    current: number;
    pages: number;
  };
  success: boolean;
}

// API 药品项接口 - 完整字段映射
interface PubonlnApiDrugItem {
  drugId?: number;
  gwActive?: string;
  genname?: string;
  tradeName?: string;
  regDosformName?: string;
  dosformName?: string;
  regSpecName?: string;
  pacmatl?: string;
  specificationProperties?: string;
  listingLicenseHolder?: string;
  prodentpName?: string;
  dclaEntpName?: string;
  aprvno?: string;
  convrat?: string;
  minuntName?: string;
  minpacName?: string;
  minPacPubonlnPric?: number | string;
  pubonlnTime?: string;
  drugClass?: string;
  policyAtt?: string;
  drugSelectType?: string;
  qualityLv?: string;
  isNationalBasicDrug?: string;
  isShortageDrug?: string;
  jylNo?: string;
  jylCategory?: string;
  dishonestyLv?: string;
  dishonestyStas?: string;
  priceRisk?: string;
  drugCode?: string;
  zcSptId?: string;
  dclaEntpUscc?: string;
  formationMode?: string;
  stopPubonln?: number | string;
  existPubonlnPric?: number | string;
  remark?: string;
}

/**
 * 使用 Node.js https 模块发起请求
 */
function httpsPost(options: https.RequestOptions, postData: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      // 设置编码为 utf8，避免多字节字符被截断
      res.setEncoding('utf8');
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// 全局统计计数器
let globalNewCount = 0;
let globalTotalProcessed = 0;

/**
 * 规整查询返回行：decimal 字段转 number（drizzle decimal 返回 string，原 Supabase numeric 返回 number）
 */
export function normalizePubonlnRow(row: Record<string, unknown>): PubonlnDrugInfo {
  return {
    ...row,
    min_pac_pubonln_pric: row.min_pac_pubonln_pric != null ? Number(row.min_pac_pubonln_pric) : undefined,
  } as PubonlnDrugInfo;
}

/**
 * 构建挂网药品列表查询的动态筛选条件
 */
function buildPubonlnConditions(options?: {
  searchKeyword?: string;
  productName?: string;
  nationalDrugCode?: string;
  companyName?: string;
  minPacQuantity?: string;
  minMeasureUnit?: string;
}): SQL | undefined {
  const conditions: SQL[] = [];

  // 搜索条件 - 多字段搜索
  if (options?.searchKeyword) {
    const keyword = decodeURIComponent(options.searchKeyword);
    conditions.push(or(
      like(drugInfoGd.genname, `%${keyword}%`),
      like(drugInfoGd.trade_name, `%${keyword}%`),
      like(drugInfoGd.listing_license_holder, `%${keyword}%`),
      like(drugInfoGd.prodentp_name, `%${keyword}%`)
    ) as SQL);
  }

  if (options?.productName) {
    conditions.push(like(drugInfoGd.genname, `%${decodeURIComponent(options.productName)}%`) as SQL);
  }

  if (options?.companyName) {
    conditions.push(like(drugInfoGd.prodentp_name, `%${decodeURIComponent(options.companyName)}%`) as SQL);
  }

  if (options?.minPacQuantity) {
    conditions.push(like(drugInfoGd.convrat, `%${decodeURIComponent(options.minPacQuantity)}%`) as SQL);
  }

  if (options?.minMeasureUnit) {
    conditions.push(like(drugInfoGd.minunt_name, `%${decodeURIComponent(options.minMeasureUnit)}%`) as SQL);
  }

  // 国家医保代码筛选
  if (options?.nationalDrugCode) {
    conditions.push(like(drugInfoGd.drug_code, `%${decodeURIComponent(options.nationalDrugCode)}%`) as SQL);
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

/**
 * 清空挂网药品数据表
 */
async function clearPubonlnDrugTable(): Promise<void> {
  // 清空全表（等价于原 .neq('id', 全零UUID) 的清表语义）
  await db.delete(drugInfoGd);
  console.log('[PubonlnScraper] 已清空旧数据');
}

/**
 * 抓取广东医保服务平台挂网药品信息
 */
export async function scrapePubonlnDrugInfo(): Promise<PubonlnScrapeResult> {
  try {
    globalNewCount = 0;
    globalTotalProcessed = 0;
    resetProgress(PROGRESS_SOURCE);

    console.log('[PubonlnScraper] 开始抓取挂网药品信息...');

    const pageSize = 500;
    const pageConcurrency = 5;

    // 先初始化进度（临时总页数=1），让前端在首页抓取期间即可看到进度卡片
    startProgress(PROGRESS_SOURCE, 1);

    // 先尝试抓取第一页数据，验证接口可用并拿到总数
    // 若源站异常则不会把旧数据清空
    const firstPageData = await fetchPubonlnDrugPage(1, pageSize);
    const totalRecords = firstPageData.total;
    const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));

    console.log(`[PubonlnScraper] 总记录数: ${totalRecords}, 总页数: ${totalPages}`);

    // 拿到真实的总页数/总条数后同步一次进度
    updateProgress(PROGRESS_SOURCE, {
      totalPages,
      totalCount: totalRecords,
      currentPage: 0,
      processedCount: 0,
      newCount: 0,
      updateCount: 0,
    });

    // 第一页抓取成功后，再清空旧数据并写入第一页
    await clearPubonlnDrugTable();
    await savePubonlnDrugBatch(firstPageData.drugs);
    globalTotalProcessed += firstPageData.drugs.length;

    updateProgress(PROGRESS_SOURCE, {
      processedCount: globalTotalProcessed,
      newCount: globalNewCount,
      updateCount: 0,
      currentPage: 1,
      totalPages,
      totalCount: totalRecords,
    });

    if (totalPages <= 1) {
      console.log(`[PubonlnScraper] 抓取完成！共处理 ${globalTotalProcessed} 条，新增 ${globalNewCount} 条`);
      completeProgress(PROGRESS_SOURCE);
      return {
        success: true,
        message: `抓取完成，共处理 ${globalTotalProcessed} 条数据`,
        total: globalTotalProcessed,
        newCount: globalNewCount,
      };
    }

    const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);

    console.log(`[PubonlnScraper] 开始并发抓取剩余 ${remainingPages.length} 页，并发数: ${pageConcurrency}`);

    await promisePool(
      remainingPages,
      pageConcurrency,
      async (page) => {
        try {
          const pageData = await fetchPubonlnDrugPage(page, pageSize);

          if (pageData.drugs.length > 0) {
            await savePubonlnDrugBatch(pageData.drugs);
            globalTotalProcessed += pageData.drugs.length;

            updateProgress(PROGRESS_SOURCE, {
              processedCount: globalTotalProcessed,
              newCount: globalNewCount,
              updateCount: 0,
              currentPage: page,
            });

            console.log(`[PubonlnScraper] 第 ${page} 页完成，进度: ${globalTotalProcessed}/${totalRecords}`);
          }
        } catch (error) {
          console.error(`[PubonlnScraper] 第 ${page} 页抓取失败:`, error);
        }
      },
      (completed, total) => {
        console.log(`[PubonlnScraper] 页面进度: ${completed}/${total}`);
      }
    );

    console.log(`[PubonlnScraper] 抓取完成！共处理 ${globalTotalProcessed} 条，新增 ${globalNewCount} 条`);

    completeProgress(PROGRESS_SOURCE);

    return {
      success: true,
      message: `抓取完成，共处理 ${globalTotalProcessed} 条数据`,
      total: globalTotalProcessed,
      newCount: globalNewCount,
    };
  } catch (error) {
    console.error('[PubonlnScraper] 抓取错误:', error);
    const errorMsg = error instanceof Error ? error.message : '未知错误';

    setErrorProgress(PROGRESS_SOURCE, errorMsg);

    return {
      success: false,
      message: `抓取失败: ${errorMsg}`,
      error: errorMsg,
    };
  }
}

/**
 * 获取单页挂网药品数据
 */
async function fetchPubonlnDrugPage(
  current: number,
  size: number
): Promise<{ drugs: PubonlnDrugInfo[]; total: number }> {
  const postData = JSON.stringify({
    current,
    size,
    searchCount: true,
  });

  const config = getPubonlnApiConfig();
  const baseOptions = buildRequestOptions(config, 'POST', {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
  });
  const options: https.RequestOptions = {
    ...baseOptions,
    headers: {
      ...baseOptions.headers,
      'Content-Length': Buffer.byteLength(postData),
    },
  };

  try {
    const responseText = await httpsPost(options, postData);

    let data: PubonlnApiResponse;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error(
        `[PubonlnScraper] JSON 解析失败，响应内容: ${responseText.substring(0, 200)}`
      );
      throw new Error('Invalid JSON response');
    }

    if (!data.success || data.code !== 0) {
      throw new Error(data.message || 'API 返回错误');
    }

    // 解析药品列表 - 完整字段映射
    const drugs: PubonlnDrugInfo[] = (data.data?.records || []).map(
      (item: PubonlnApiDrugItem) => ({
        drug_id: item.drugId,
        gw_active: item.gwActive || undefined,
        genname: item.genname || '',
        trade_name: item.tradeName || undefined,
        reg_dosform_name: item.regDosformName || undefined,
        dosform_name: item.dosformName || undefined,
        reg_spec_name: item.regSpecName || undefined,
        pacmatl: item.pacmatl || undefined,
        specification_properties: item.specificationProperties || undefined,
        listing_license_holder: item.listingLicenseHolder || undefined,
        prodentp_name: item.prodentpName || undefined,
        dcla_entp_name: item.dclaEntpName || undefined,
        aprvno: item.aprvno || undefined,
        convrat: item.convrat || undefined,
        minunt_name: item.minuntName || undefined,
        minpac_name: item.minpacName || undefined,
        min_pac_pubonln_pric: parseNumber(item.minPacPubonlnPric),
        pubonln_time: item.pubonlnTime || undefined,
        drug_class: item.drugClass || undefined,
        policy_att: item.policyAtt || undefined,
        drug_select_type: item.drugSelectType || undefined,
        quality_lv: item.qualityLv || undefined,
        is_national_basic_drug: item.isNationalBasicDrug || undefined,
        is_shortage_drug: item.isShortageDrug || undefined,
        jyl_no: item.jylNo || undefined,
        jyl_category: item.jylCategory || undefined,
        dishonesty_lv: item.dishonestyLv || undefined,
        dishonesty_stas: item.dishonestyStas || undefined,
        price_risk: item.priceRisk || undefined,
        drug_code: item.drugCode || undefined,
        zc_spt_id: item.zcSptId || undefined,
        dcla_entp_uscc: item.dclaEntpUscc || undefined,
        formation_mode: item.formationMode || undefined,
        stop_pubonln: parseInteger(item.stopPubonln),
        exist_pubonln_pric: parseInteger(item.existPubonlnPric),
        remark: item.remark || undefined,
      })
    );

    return {
      drugs,
      total: data.data?.total || 0,
    };
  } catch (error) {
    console.error(`[PubonlnScraper] 第 ${current} 页抓取失败:`, error);
    throw error;
  }
}

/**
 * 解析数字 - 处理各种类型的输入
 */
function parseNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;

  // 如果是数字，直接返回
  if (typeof value === 'number') return value;

  // 如果是字符串，尝试解析
  if (typeof value === 'string') {
    // 清理字符串，移除可能的非数字字符（除了小数点和负号）
    const cleaned = value.replace(/[^\d.-]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? undefined : num;
  }

  // 如果是对象（例如 {68800 -4 false finite true}），尝试提取数字
  if (typeof value === 'object') {
    const objStr = JSON.stringify(value);
    const match = objStr.match(/(\d+)/);
    if (match) {
      const num = parseInt(match[1], 10);
      // 检查是否是金额（通常以分为单位，需要转换为元）
      if (num >= 100) {
        return num / 100; // 转换为元
      }
      return num;
    }
    return undefined;
  }

  return undefined;
}

/**
 * 解析整数
 */
function parseInteger(value: string | number | undefined): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number') return value;
  const num = parseInt(value, 10);
  return isNaN(num) ? undefined : num;
}

/**
 * 保存单页挂网药品数据到数据库
 */
async function savePubonlnDrugBatch(drugList: PubonlnDrugInfo[]): Promise<void> {
  if (drugList.length === 0) {
    return;
  }

  // 批量插入
  const recordsToInsert = drugList.map((drug) => ({
    ...drug,
    created_at: new Date(),
  }));

  try {
    await db.insert(drugInfoGd).values(recordsToInsert as never);
    globalNewCount += drugList.length;
  } catch (error) {
    console.error('[PubonlnScraper] 批量插入失败:', error);

    // 批量插入失败，尝试单条插入
    for (const drug of recordsToInsert) {
      try {
        await db.insert(drugInfoGd).values(drug as never);
        globalNewCount++;
      } catch (singleError) {
        console.error('[PubonlnScraper] 单条插入失败:', singleError instanceof Error ? singleError.message : singleError);
      }
    }
  }
}

/**
 * 查询挂网药品信息列表
 */
export async function getPubonlnDrugList(options?: {
  page?: number;
  pageSize?: number;
  searchKeyword?: string;
  productName?: string;
  nationalDrugCode?: string;
  companyName?: string;
  minPacQuantity?: string;
  minMeasureUnit?: string;
}): Promise<{ data: PubonlnDrugInfo[]; total: number }> {
  const page = options?.page || 1;
  const pageSize = options?.pageSize || 20;
  const offset = (page - 1) * pageSize;

  if (options?.searchKeyword) {
    console.log('[PubonlnScraper] 搜索关键词:', decodeURIComponent(options.searchKeyword));
  }

  const whereClause = buildPubonlnConditions(options);

  // 并行查询数据与总数
  const [dataRows, countRows] = await Promise.all([
    db
      .select()
      .from(drugInfoGd)
      .where(whereClause)
      .orderBy(desc(drugInfoGd.created_at))
      .offset(offset)
      .limit(pageSize),
    db
      .select({ count: count() })
      .from(drugInfoGd)
      .where(whereClause),
  ]);

  return {
    data: dataRows.map(row => normalizePubonlnRow(row as unknown as Record<string, unknown>)),
    total: Number(countRows[0]?.count ?? 0),
  };
}

/**
 * 导出挂网药品信息为 Excel 数据（获取所有数据）
 */
export async function exportPubonlnDrugData(options?: {
  searchKeyword?: string;
  productName?: string;
  nationalDrugCode?: string;
  companyName?: string;
  minPacQuantity?: string;
  minMeasureUnit?: string;
}): Promise<PubonlnDrugInfo[]> {
  const whereClause = buildPubonlnConditions(options);
  const allData: PubonlnDrugInfo[] = [];
  const batchSize = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const rows = await db
      .select()
      .from(drugInfoGd)
      .where(whereClause)
      .orderBy(desc(drugInfoGd.created_at))
      .offset(offset)
      .limit(batchSize);

    if (rows.length > 0) {
      allData.push(...rows.map(row => normalizePubonlnRow(row as unknown as Record<string, unknown>)));
      offset += batchSize;
      hasMore = rows.length === batchSize;
    } else {
      hasMore = false;
    }
  }

  console.log(`[PubonlnScraper] 导出数据: ${allData.length} 条`);
  return allData;
}

/**
 * 获取挂网药品统计信息
 */
export async function getPubonlnStatistics(): Promise<{
  total: number;
  lastUpdate: string | null;
}> {
  const countRows = await db.select({ count: count() }).from(drugInfoGd);
  const total = Number(countRows[0]?.count ?? 0);

  // 获取最后更新时间
  const lastRows = await db
    .select({ updated_at: drugInfoGd.updated_at })
    .from(drugInfoGd)
    .where(isNotNull(drugInfoGd.updated_at))
    .orderBy(desc(drugInfoGd.updated_at))
    .limit(1);

  return {
    total,
    lastUpdate: (lastRows[0]?.updated_at as unknown as string) ?? null,
  };
}

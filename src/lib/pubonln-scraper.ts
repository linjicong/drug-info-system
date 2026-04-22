/**
 * 广东医保服务平台挂网药品信息抓取模块
 * API 端点通过环境变量 PUBONLN_API_URL 配置
 */

import { getSupabaseClient } from '@/storage/database/supabase-client';
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
 * 清空挂网药品数据表
 */
async function clearPubonlnDrugTable(): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client
    .from('pubonln_drug_info')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  
  if (error) {
    console.error('[PubonlnScraper] 清空表失败:', error.message);
    throw error;
  }
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

    await clearPubonlnDrugTable();

    const pageSize = 500;
    const pageConcurrency = 5;

    const firstPageData = await fetchPubonlnDrugPage(1, pageSize);
    const totalRecords = firstPageData.total;
    const totalPages = Math.ceil(totalRecords / pageSize);
    
    console.log(`[PubonlnScraper] 总记录数: ${totalRecords}, 总页数: ${totalPages}`);
    
    startProgress(PROGRESS_SOURCE, totalPages);
    updateProgress(PROGRESS_SOURCE, { totalCount: totalRecords });

    await savePubonlnDrugBatch(firstPageData.drugs);
    globalTotalProcessed += firstPageData.drugs.length;
    
    updateProgress(PROGRESS_SOURCE, {
      processedCount: globalTotalProcessed,
      newCount: globalNewCount,
      updateCount: 0,
      currentPage: 1,
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
  const client = getSupabaseClient();

  if (drugList.length === 0) {
    return;
  }

  // 批量插入
  const recordsToInsert = drugList.map((drug) => ({
    ...drug,
    created_at: new Date().toISOString(),
  }));

  const { error: insertError, count } = await client
    .from('pubonln_drug_info')
    .insert(recordsToInsert as never, { count: 'exact' });

  if (insertError) {
    console.error('[PubonlnScraper] 批量插入失败:', insertError.message);

    // 批量插入失败，尝试单条插入
    for (const drug of recordsToInsert) {
      const { error } = await client
        .from('pubonln_drug_info')
        .insert(drug as never);

      if (!error) {
        globalNewCount++;
      } else {
        console.error('[PubonlnScraper] 单条插入失败:', error.message);
      }
    }
  } else {
    globalNewCount += count || recordsToInsert.length;
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
  const client = getSupabaseClient();
  const page = options?.page || 1;
  const pageSize = options?.pageSize || 20;
  const offset = (page - 1) * pageSize;

  let query = client
    .from('pubonln_drug_info')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  // 搜索条件 - 多字段搜索
  if (options?.searchKeyword) {
    const keyword = decodeURIComponent(options.searchKeyword);
    console.log('[PubonlnScraper] 搜索关键词:', keyword);
    
    query = query.or(
      `genname.ilike.%${keyword}%,trade_name.ilike.%${keyword}%,listing_license_holder.ilike.%${keyword}%,prodentp_name.ilike.%${keyword}%`
    );
  }

  if (options?.productName) {
    query = query.ilike('genname', `%${decodeURIComponent(options.productName)}%`);
  }

  if (options?.companyName) {
    query = query.ilike('prodentp_name', `%${decodeURIComponent(options.companyName)}%`);
  }

  if (options?.minPacQuantity) {
    query = query.ilike('convrat', `%${decodeURIComponent(options.minPacQuantity)}%`);
  }

  if (options?.minMeasureUnit) {
    query = query.ilike('minunt_name', `%${decodeURIComponent(options.minMeasureUnit)}%`);
  }

  // 国家医保代码筛选
  if (options?.nationalDrugCode) {
    query = query.ilike('drug_code', `%${decodeURIComponent(options.nationalDrugCode)}%`);
  }

  // 分页
  query = query.range(offset, offset + pageSize - 1);

  const { data, error, count } = await query;

  if (error) {
    console.error('[PubonlnScraper] 查询失败:', error);
    throw new Error(`查询失败: ${error.message}`);
  }

  return {
    data: (data || []) as PubonlnDrugInfo[],
    total: count || 0,
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
  const client = getSupabaseClient();
  const allData: PubonlnDrugInfo[] = [];
  const batchSize = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let query = client
      .from('pubonln_drug_info')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + batchSize - 1);

    if (options?.searchKeyword) {
      const keyword = decodeURIComponent(options.searchKeyword);
      query = query.or(
        `genname.ilike.%${keyword}%,trade_name.ilike.%${keyword}%,listing_license_holder.ilike.%${keyword}%,prodentp_name.ilike.%${keyword}%`
      );
    }

    if (options?.productName) {
      query = query.ilike('genname', `%${decodeURIComponent(options.productName)}%`);
    }

    if (options?.companyName) {
      query = query.ilike('prodentp_name', `%${decodeURIComponent(options.companyName)}%`);
    }

    if (options?.minPacQuantity) {
      query = query.ilike('convrat', `%${decodeURIComponent(options.minPacQuantity)}%`);
    }

    if (options?.minMeasureUnit) {
      query = query.ilike('minunt_name', `%${decodeURIComponent(options.minMeasureUnit)}%`);
    }

    if (options?.nationalDrugCode) {
      query = query.ilike('drug_code', `%${decodeURIComponent(options.nationalDrugCode)}%`);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`导出失败: ${error.message}`);
    }

    if (data && data.length > 0) {
      allData.push(...(data as PubonlnDrugInfo[]));
      offset += batchSize;

      if (data.length < batchSize) {
        hasMore = false;
      }
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
  const client = getSupabaseClient();

  const { count, error } = await client
    .from('pubonln_drug_info')
    .select('*', { count: 'exact', head: true });

  if (error) {
    throw new Error(`获取统计失败: ${error.message}`);
  }

  // 获取最后更新时间
  const { data: lastRecord } = await client
    .from('pubonln_drug_info')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    total: count || 0,
    lastUpdate: lastRecord?.updated_at || null,
  };
}

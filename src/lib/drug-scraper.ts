import { getSupabaseClient } from '@/storage/database/supabase-client';
import https from 'https';
import { getDrugApiConfig, buildRequestOptions } from './api-config';
import { updateProgress, startProgress, completeProgress, setErrorProgress, resetProgress } from './progress-manager';
import { batchFetchWithConcurrency } from './drug-detail-worker';
import { promisePool } from './concurrent-pool';

const PROGRESS_SOURCE = 'gz_drug' as const;

// 药品信息接口 - 完全匹配API返回字段（共23个API字段）
export interface DrugInfo {
  id?: string;
  // 商品ID（与procurecatalog_id组成复合唯一键）
  goods_id: string;
  // 药品通用名
  product_name: string;
  // 采购目录ID（与goods_id组成复合唯一键）
  procurecatalog_id: string;
  // 药品商品名
  goods_name?: string;
  // 生产企业
  company_name_sc?: string;
  // 剂型名称
  medicinemodel?: string;
  // 规格（包装单位）
  unit?: string;
  // 最小规格
  min_unit?: string;
  // 规格包装
  outlook?: string;
  // 规格ID
  unit_id?: string;
  // 数量
  factor?: number;
  // 规格包装单位数值
  outlook_unit?: number;
  // 包装单位参考价格(元)
  bid_price?: number;
  // 最小制剂单位参考价格(元)
  min_unit_price?: number;
  // 最高挂网价格(元)
  max_listing_price?: number;
  // 医保编码
  national_drug_code?: string;
  // 采购方式
  purchase_type?: number;
  // 甲乙类（0-非医保，1-甲类，2-乙类）
  medicare_type?: number;
  // 药品挂网类别
  source_type?: string;
  // 材料名称
  material_name?: string;
  // 隐藏价格标志
  hidden_price_flag?: number;
  // 活跃分区标志
  subarea_flag?: number;
  // 商品状态
  is_out_stock?: number;
  // 费率
  fs_rate?: number;
  // 挂网时间
  net_time?: string;
  // 价格形成时间
  price_formation_time?: string;
  // 系统字段
  created_at?: string;
  updated_at?: string;
}

// 抓取结果接口
export interface ScrapeResult {
  success: boolean;
  message: string;
  total?: number;
  newCount?: number;
  updateCount?: number;
  error?: string;
}

// API 返回数据接口
interface ApiResponse {
  total?: number;
  records?: number;
  rows?: ApiDrugItem[];
  page?: number;
}

// API 药品项接口 - 完全匹配API返回字段（共23个字段）
interface ApiDrugItem {
  // 商品ID
  goodsId?: number | string;
  // 药品通用名
  productName?: string;
  // 药品商品名
  goodsName?: string;
  // 生产企业
  companyNameSc?: string;
  // 剂型名称
  medicinemodel?: string;
  // 规格（包装单位）
  unit?: string;
  // 最小规格
  minUnit?: string;
  // 规格包装
  outlook?: string;
  // 规格ID
  unitId?: number | string;
  // 数量
  factor?: number;
  // 规格包装单位数值
  outlookUnit?: number | string;
  // 包装单位参考价格(元)
  bidPrice?: number | string;
  // 最小制剂单位参考价格(元)
  minUnitPrice?: number | string;
  // 最高挂网价格(元)
  maxListingPrice?: number | string;
  // 医保编码
  nationalDrugCode?: string;
  // 采购目录ID
  procurecatalogId?: number | string;
  // 采购方式
  purchaseType?: number;
  // 甲乙类（0-非医保，1-甲类，2-乙类）
  medicareType?: number;
  // 药品挂网类别
  sourceType?: string;
  // 材料名称
  materialName?: string;
  // 隐藏价格标志
  hiddenPriceFlag?: number;
  // 活跃分区标志
  subareaFlag?: number;
  // 商品状态
  isOutStock?: number;
  // 费率
  fsRate?: number | string;
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
let globalUpdateCount = 0;
let globalTotalProcessed = 0;

/**
 * 重置进度（供外部调用）
 */
export function resetScraperProgress(): void {
  globalNewCount = 0;
  globalUpdateCount = 0;
  globalTotalProcessed = 0;
  resetProgress(PROGRESS_SOURCE);
}

/**
 * 清空药品数据表
 */
async function clearDrugTable(): Promise<void> {
  const client = getSupabaseClient();
  
  // 直接删除所有记录
  const { error } = await client
    .from('drug_info')
    .delete()
    .not('id', 'is', null);
  
  if (error) {
    console.error('[DrugScraper] 清空表失败:', error.message);
    throw error;
  }
  console.log('[DrugScraper] 已清空旧数据');
}

/**
 * 抓取广州药品采购平台公示信息
 */
export async function scrapeDrugInfo(
  _targetUrl?: string,
  _customHeaders?: Record<string, string>
): Promise<ScrapeResult> {
  try {
    // 重置计数器
    globalNewCount = 0;
    globalUpdateCount = 0;
    globalTotalProcessed = 0;
    
    console.log('[DrugScraper] 开始抓取药品信息...');

    const pageSize = 1000;
    const maxPages = 50;
    const pageConcurrency = 3; // 并发抓取3页（避免服务器压力过大）

    // 初始化进度（先展示进度卡片，让前端立即有反馈）
    startProgress(PROGRESS_SOURCE, maxPages);

    // 先尝试抓取第一页数据，验证接口可用且确定总数
    // 这样在源站不可用时，不会把旧数据清空
    console.log('[DrugScraper] 正在获取第一页数据...');
    const firstPageData = await fetchDrugPage(1, pageSize);
    const totalRecords = firstPageData.total || 0;
    const totalPages = Math.min(Math.ceil(totalRecords / pageSize), maxPages);

    console.log(`[DrugScraper] 总记录数: ${totalRecords}, 总页数: ${totalPages}`);

    // 同步一次"首页抓取完成，正在获取详情"的进度，避免卡片一直停留在 0/50
    updateProgress(PROGRESS_SOURCE, {
      currentPage: 1,
      totalPages: totalPages,
      totalCount: totalRecords,
      processedCount: 0,
      newCount: 0,
      updateCount: 0,
    });

    // 获取第一页药品的详情时间（期间按完成量增量更新进度，避免用户看到"卡在 0"）
    // 使用全局 globalTotalProcessed 作为原子计数器，后续并发抓取共享递增，保持单调递增
    console.log(`[DrugScraper] 正在获取第 1 页药品的详情时间...`);
    const firstDetailTimes = await batchFetchDrugDetailTimes(
      firstPageData.drugs,
      () => {
        globalTotalProcessed += 1;
        if (globalTotalProcessed % 20 === 0) {
          updateProgress(PROGRESS_SOURCE, {
            processedCount: globalTotalProcessed,
          });
        }
      }
    );
    const firstDrugsWithDetails = firstPageData.drugs.map(drug => {
      const detail = firstDetailTimes.get(drug.procurecatalog_id) || {};
      return {
        ...drug,
        net_time: detail.net_time,
        price_formation_time: detail.price_formation_time,
      };
    });

    // 第一页抓取成功后，再清空旧数据并写入第一页
    // 这样在源站返回异常时，旧数据不会被误删
    await clearDrugTable();
    await saveDrugBatchToDatabase(firstDrugsWithDetails);

    // 首页详情已在 batchFetchDrugDetailTimes 回调中按条递增，这里做一次对齐性刷新
    updateProgress(PROGRESS_SOURCE, {
      currentPage: 1,
      totalPages: totalPages,
      totalCount: totalRecords,
      processedCount: globalTotalProcessed,
      newCount: globalNewCount,
      updateCount: globalUpdateCount,
    });

    // 如果只有一页，直接返回
    if (totalPages <= 1) {
      console.log(`[DrugScraper] 抓取完成！共处理 ${globalTotalProcessed} 条，新增 ${globalNewCount} 条，更新 ${globalUpdateCount} 条`);
      completeProgress(PROGRESS_SOURCE);
      return {
        success: true,
        message: `抓取完成，共处理 ${globalTotalProcessed} 条数据，新增 ${globalNewCount} 条，更新 ${globalUpdateCount} 条`,
        total: globalTotalProcessed,
        newCount: globalNewCount,
        updateCount: globalUpdateCount,
      };
    }

    // 生成剩余页面任务（从第2页开始）
    const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
    
    console.log(`[DrugScraper] 开始并发抓取剩余 ${remainingPages.length} 页，并发数: ${pageConcurrency}`);

    // 并发抓取剩余页面
    await promisePool(
      remainingPages,
      pageConcurrency,
      async (page) => {
        try {
          console.log(`[DrugScraper] 正在抓取第 ${page}/${totalPages} 页...`);

          const pageData = await fetchDrugPage(page, pageSize);

          if (pageData.drugs.length === 0) {
            return;
          }

          // 页面数据抓取成功后先更新一次进度（让用户看到新页正在进行）
          updateProgress(PROGRESS_SOURCE, {
            currentPage: page,
            totalPages,
            totalCount: totalRecords,
            processedCount: globalTotalProcessed,
            newCount: globalNewCount,
            updateCount: globalUpdateCount,
          });

          // 获取当前页药品的挂网时间和价格形成时间
          // 通过 onProgress 回调让 globalTotalProcessed 按条递增，前端进度平滑上升
          // 不更新 currentPage：多页并发时 currentPage 来回跳会闪烁，统一在页面完成时更新
          console.log(`[DrugScraper] 正在获取第 ${page} 页药品的详情时间...`);
          const detailTimes = await batchFetchDrugDetailTimes(
            pageData.drugs,
            () => {
              globalTotalProcessed += 1;
              if (globalTotalProcessed % 20 === 0) {
                updateProgress(PROGRESS_SOURCE, {
                  processedCount: globalTotalProcessed,
                });
              }
            }
          );
          
          // 合并详情时间到药品数据
          const drugsWithDetails = pageData.drugs.map(drug => {
            const detail = detailTimes.get(drug.procurecatalog_id) || {};
            return {
              ...drug,
              net_time: detail.net_time,
              price_formation_time: detail.price_formation_time,
            };
          });

          // 保存数据
          await saveDrugBatchToDatabase(drugsWithDetails);

          console.log(`[DrugScraper] 第 ${page} 页完成，进度: ${globalTotalProcessed}/${totalRecords} 条`);

          // 更新进度
          updateProgress(PROGRESS_SOURCE, {
            currentPage: page,
            totalPages: totalPages,
            totalCount: totalRecords,
            processedCount: globalTotalProcessed,
            newCount: globalNewCount,
            updateCount: globalUpdateCount,
          });
        } catch (error) {
          console.error(`[DrugScraper] 第 ${page} 页抓取失败:`, error);
        }
      },
      (completed, total) => {
        console.log(`[DrugScraper] 页面进度: ${completed}/${total}`);
      }
    );

    console.log(`[DrugScraper] 抓取完成！共处理 ${globalTotalProcessed} 条，新增 ${globalNewCount} 条，更新 ${globalUpdateCount} 条`);

    // 完成进度
    completeProgress(PROGRESS_SOURCE);

    return {
      success: true,
      message: `抓取完成，共处理 ${globalTotalProcessed} 条数据，新增 ${globalNewCount} 条，更新 ${globalUpdateCount} 条`,
      total: globalTotalProcessed,
      newCount: globalNewCount,
      updateCount: globalUpdateCount,
    };
  } catch (error) {
    console.error('[DrugScraper] 抓取错误:', error);
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
 * 获取单页药品数据
 */
async function fetchDrugPage(page: number, pageSize: number): Promise<{ drugs: DrugInfo[]; total: number }> {
  const postData = [
    'productName=',
    'goodsName=',
    'medicinemodel=',
    'companyNameSc=',
    'purchaseType=',
    'medicareType=',
    'factor=',
    'unitId=',
    'nationalDrugCode=',
    `_search=false`,
    `nd=${Date.now()}`,
    `rows=${pageSize}`,
    `page=${page}`,
    'sidx=',
    'sord=asc',
    'initializationState=',
  ].join('&');

  const config = getDrugApiConfig();
  const baseOptions = buildRequestOptions(config, 'POST', {
    Accept: 'application/json, text/javascript, */*; q=0.01',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
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

    let data: ApiResponse;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error(`[DrugScraper] JSON 解析失败，响应内容: ${responseText.substring(0, 200)}`);
      throw new Error('Invalid JSON response');
    }

    // 解析药品列表 - 直接映射API字段到数据库字段（snake_case）
    const drugs: DrugInfo[] = (data.rows || []).map((item: ApiDrugItem) => ({
      // 商品ID
      goods_id: item.goodsId?.toString() || '',
      // 药品通用名
      product_name: item.productName || '',
      // 采购目录ID - 唯一标识
      procurecatalog_id: item.procurecatalogId?.toString() || '',
      // 药品商品名
      goods_name: item.goodsName || undefined,
      // 生产企业
      company_name_sc: item.companyNameSc || undefined,
      // 剂型名称
      medicinemodel: item.medicinemodel || undefined,
      // 规格（包装单位）
      unit: item.unit || undefined,
      // 最小规格
      min_unit: item.minUnit || undefined,
      // 规格包装
      outlook: item.outlook || undefined,
      // 规格ID
      unit_id: item.unitId?.toString() || undefined,
      // 数量
      factor: item.factor || undefined,
      // 规格包装单位数值
      outlook_unit: parseNumber(item.outlookUnit),
      // 包装单位参考价格(元)
      bid_price: parseNumber(item.bidPrice),
      // 最小制剂单位参考价格(元)
      min_unit_price: parseNumber(item.minUnitPrice),
      // 最高挂网价格(元)
      max_listing_price: parseNumber(item.maxListingPrice),
      // 医保编码
      national_drug_code: item.nationalDrugCode || undefined,
      // 采购方式
      purchase_type: item.purchaseType || undefined,
      // 甲乙类（0-非医保，1-甲类，2-乙类）
      medicare_type: item.medicareType ?? 0,
      // 药品挂网类别
      source_type: item.sourceType || undefined,
      // 材料名称
      material_name: item.materialName || undefined,
      // 隐藏价格标志
      hidden_price_flag: item.hiddenPriceFlag ?? 0,
      // 活跃分区标志
      subarea_flag: item.subareaFlag ?? 0,
      // 商品状态
      is_out_stock: item.isOutStock ?? 0,
      // 费率
      fs_rate: parseNumber(item.fsRate),
    }));

    return {
      drugs,
      total: data.records || 0,  // records 是总记录数，total 是总页数
    };
  } catch (error) {
    console.error(`[DrugScraper] 第 ${page} 页抓取失败:`, error);
    throw error;
  }
}

/**
 * 批量获取药品详情时间（高并发）
 * @param drugs 药品任务列表
 * @param onProgress 每完成一项时的回调，用于向前端报告增量进度
 */
async function batchFetchDrugDetailTimes(
  drugs: DrugInfo[],
  onProgress?: (completed: number, total: number) => void
): Promise<Map<string, { net_time?: string; price_formation_time?: string }>> {
  // 使用200并发获取
  const tasks = drugs.map(d => ({ procurecatalog_id: d.procurecatalog_id }));
  return batchFetchWithConcurrency(tasks, 200, onProgress);
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
    // 提取第一个数字
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
 * 保存单页药品数据到数据库
 */
async function saveDrugBatchToDatabase(drugList: DrugInfo[]): Promise<void> {
  const client = getSupabaseClient();

  if (drugList.length === 0) {
    return;
  }

  // 准备插入的数据
  const recordsToInsert = drugList.map(drug => ({
    ...drug,
    created_at: new Date().toISOString(),
  }));

  console.log(`[DrugScraper] 准备插入 ${recordsToInsert.length} 条数据`);

  // 使用 Supabase 的 insert 方法
  const { data, error } = await client
    .from('drug_info')
    .insert(recordsToInsert);

  if (error) {
    console.error('[DrugScraper] 插入失败:', error.message);
    // 逐条插入作为备用方案
    let successCount = 0;
    for (const drug of recordsToInsert) {
      const { error: singleError } = await client
        .from('drug_info')
        .insert(drug);
      if (!singleError) {
        successCount++;
      }
    }
    globalNewCount += successCount;
    console.log(`[DrugScraper] 备用插入完成: ${successCount} 条`);
  } else {
    globalNewCount += drugList.length;
    console.log(`[DrugScraper] 批量插入成功: ${drugList.length} 条`);
  }
}

/**
 * 查询药品信息列表
 */
export async function getDrugList(options?: {
  page?: number;
  pageSize?: number;
  searchKeyword?: string;
  productName?: string;
  nationalDrugCode?: string;
  companyName?: string;
  minPacQuantity?: string;
  minMeasureUnit?: string;
}): Promise<{ data: DrugInfo[]; total: number }> {
  const client = getSupabaseClient();
  const page = options?.page || 1;
  const pageSize = options?.pageSize || 20;
  const offset = (page - 1) * pageSize;

  let query = client
    .from('drug_info')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  // 搜索条件 - 搜索商品名、药品名称、企业名称
  if (options?.searchKeyword) {
    const keyword = decodeURIComponent(options.searchKeyword);
    query = query.or(
      `product_name.ilike.%${keyword}%,goods_name.ilike.%${keyword}%,company_name_sc.ilike.%${keyword}%`
    );
  }

  if (options?.productName) {
    query = query.ilike('product_name', `%${decodeURIComponent(options.productName)}%`);
  }

  // 生产企业筛选
  if (options?.companyName) {
    query = query.ilike('company_name_sc', `%${decodeURIComponent(options.companyName)}%`);
  }

  // 医保编码筛选
  if (options?.nationalDrugCode) {
    query = query.ilike('national_drug_code', `%${decodeURIComponent(options.nationalDrugCode)}%`);
  }

  if (options?.minPacQuantity) {
    const quantityNumber = Number(options.minPacQuantity);
    if (!Number.isNaN(quantityNumber)) {
      query = query.eq('factor', quantityNumber);
    }
  }

  if (options?.minMeasureUnit) {
    query = query.ilike('min_unit', `%${decodeURIComponent(options.minMeasureUnit)}%`);
  }

  // 分页
  query = query.range(offset, offset + pageSize - 1);

  const { data, error, count } = await query;

  if (error) {
    throw new Error(`查询失败: ${error.message}`);
  }

  return {
    data: (data || []) as DrugInfo[],
    total: count || 0,
  };
}

/**
 * 导出药品信息为 Excel 数据（获取所有数据）
 */
export async function exportDrugData(options?: {
  searchKeyword?: string;
  productName?: string;
  nationalDrugCode?: string;
  companyName?: string;
  minPacQuantity?: string;
  minMeasureUnit?: string;
}): Promise<DrugInfo[]> {
  const client = getSupabaseClient();
  const allData: DrugInfo[] = [];
  const batchSize = 1000;
  let offset = 0;
  let hasMore = true;

  // 分批获取所有数据
  while (hasMore) {
    let query = client
      .from('drug_info')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + batchSize - 1);

    // 搜索条件
    if (options?.searchKeyword) {
      const keyword = decodeURIComponent(options.searchKeyword);
      query = query.or(
        `product_name.ilike.%${keyword}%,goods_name.ilike.%${keyword}%,company_name_sc.ilike.%${keyword}%`
      );
    }

    if (options?.productName) {
      query = query.ilike('product_name', `%${decodeURIComponent(options.productName)}%`);
    }

    if (options?.companyName) {
      query = query.ilike('company_name_sc', `%${decodeURIComponent(options.companyName)}%`);
    }

    if (options?.nationalDrugCode) {
      query = query.ilike('national_drug_code', `%${decodeURIComponent(options.nationalDrugCode)}%`);
    }

    if (options?.minPacQuantity) {
      const quantityNumber = Number(options.minPacQuantity);
      if (!Number.isNaN(quantityNumber)) {
        query = query.eq('factor', quantityNumber);
      }
    }

    if (options?.minMeasureUnit) {
      query = query.ilike('min_unit', `%${decodeURIComponent(options.minMeasureUnit)}%`);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`导出失败: ${error.message}`);
    }

    if (data && data.length > 0) {
      allData.push(...(data as DrugInfo[]));
      offset += batchSize;
      
      // 如果返回数据少于批次大小，说明没有更多了
      if (data.length < batchSize) {
        hasMore = false;
      }
    } else {
      hasMore = false;
    }
  }

  console.log(`[DrugScraper] 导出数据: ${allData.length} 条`);
  return allData;
}

/**
 * 获取统计信息
 */
export async function getStatistics(): Promise<{
  total: number;
  lastUpdate: string | null;
}> {
  const client = getSupabaseClient();

  const { count, error } = await client
    .from('drug_info')
    .select('*', { count: 'exact', head: true });

  if (error) {
    throw new Error(`获取统计失败: ${error.message}`);
  }

  // 获取最后更新时间
  const { data: lastRecord } = await client
    .from('drug_info')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    total: count || 0,
    lastUpdate: lastRecord?.updated_at || null,
  };
}

/**
 * 获取所有生产企业列表（用于筛选）
 */
export async function getManufacturers(): Promise<string[]> {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('drug_info')
    .select('company_name_sc')
    .not('company_name_sc', 'is', null);

  if (error) {
    throw new Error(`获取生产企业列表失败: ${error.message}`);
  }

  // 去重并排序
  const manufacturers = [...new Set(data?.map((d: { company_name_sc: string | null }) => d.company_name_sc).filter(Boolean))] as string[];
  return manufacturers.sort();
}

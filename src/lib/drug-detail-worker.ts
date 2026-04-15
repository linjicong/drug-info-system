import https from 'https';
import { getDrugDetailApiConfig, buildRequestOptions } from './api-config';

interface DetailTimeResult {
  procurecatalog_id: string;
  net_time?: string;
  price_formation_time?: string;
}

/**
 * 格式化时间戳为日期字符串
 */
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
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

/**
 * 获取单个药品的挂网时间和价格形成时间
 */
async function fetchDrugDetailTime(procurecatalogId: string): Promise<DetailTimeResult> {
  const postData = [
    `procurecatalogId=${procurecatalogId}`,
    '_search=false',
    `nd=${Date.now()}`,
    'rows=20',
    'page=1',
    'sidx=',
    'sord=asc',
  ].join('&');

  const config = getDrugDetailApiConfig();
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
    const data = JSON.parse(responseText);
    
    if (data.rows && data.rows.length > 0) {
      const row = data.rows[0];
      return {
        procurecatalog_id: procurecatalogId,
        net_time: row.netTime ? formatTimestamp(row.netTime) : undefined,
        price_formation_time: row.priceFormationTime ? formatTimestamp(row.priceFormationTime) : undefined,
      };
    }
    return { procurecatalog_id: procurecatalogId };
  } catch {
    return { procurecatalog_id: procurecatalogId };
  }
}

/**
 * 并发池 - 控制并发数量
 */
async function promisePool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (const item of items) {
    const promise = fn(item).then(result => {
      results.push(result);
    });

    const wrapped = promise.then(() => {
      executing.splice(executing.indexOf(wrapped), 1);
    });
    executing.push(wrapped);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

/**
 * 高并发批量获取药品详情时间
 * @param drugs 药品任务列表
 * @param concurrency 并发数，默认200
 */
export async function batchFetchWithConcurrency(
  drugs: { procurecatalog_id: string }[],
  concurrency: number = 200
): Promise<Map<string, { net_time?: string; price_formation_time?: string }>> {
  const result = new Map<string, { net_time?: string; price_formation_time?: string }>();
  
  if (drugs.length === 0) {
    return result;
  }

  console.log(`[DrugDetail] 开始获取 ${drugs.length} 条药品详情，并发数: ${concurrency}`);
  const startTime = Date.now();

  // 使用并发池获取
  const results = await promisePool(
    drugs,
    concurrency,
    async (drug) => fetchDrugDetailTime(drug.procurecatalog_id)
  );

  // 合并结果
  for (const detail of results) {
    result.set(detail.procurecatalog_id, {
      net_time: detail.net_time,
      price_formation_time: detail.price_formation_time,
    });
  }

  const elapsed = Date.now() - startTime;
  console.log(`[DrugDetail] 完成 ${results.length} 条详情获取，耗时: ${elapsed}ms`);

  return result;
}

export { fetchDrugDetailTime };

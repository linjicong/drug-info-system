import https from 'https';

interface ApiEndpointConfig {
  hostname: string;
  port: number;
  path: string;
  origin?: string;
  referer?: string;
}

/**
 * 将完整 URL 解析为 API 端点配置
 */
function parseApiUrl(url: string, defaults: Partial<ApiEndpointConfig> = {}): ApiEndpointConfig {
  try {
    const parsed = new URL(url);
    return {
      hostname: parsed.hostname,
      port: parseInt(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      origin: defaults.origin || parsed.origin,
      referer: defaults.referer,
    };
  } catch {
    throw new Error(`无效的 API URL: ${url}`);
  }
}

/**
 * 广东医保服务平台 - 挂网药品查询 API 配置
 */
export function getPubonlnApiConfig(): ApiEndpointConfig {
  const url = process.env.PUBONLN_API_URL || 'https://igi.hsa.gd.gov.cn/tps_local_bd/web/publicity/pubonlnPublicity/queryPubonlnPage';
  const referer = process.env.PUBONLN_API_REFERER || 'https://igi.hsa.gd.gov.cn/tps/tps_public/publicity/listPubonlnPublicityD';
  return parseApiUrl(url, { origin: new URL(url).origin, referer });
}

/**
 * 广州药品采购平台 - 药品公示查询 API 配置
 */
export function getDrugApiConfig(): ApiEndpointConfig {
  const url = process.env.DRUG_API_URL || 'https://gpo.gzggzy.cn/webPortal/publicity/getPublicityDrugpurProcurecatalogData.html';
  return parseApiUrl(url);
}

/**
 * 广州药品采购平台 - 药品详情查询 API 配置
 */
export function getDrugDetailApiConfig(): ApiEndpointConfig {
  const url = process.env.DRUG_DETAIL_API_URL || 'https://gpo.gzggzy.cn/webPortal/publicity/getNetAndPriceFormationDetailData.html';
  return parseApiUrl(url);
}

/**
 * 构建 https.RequestOptions
 */
export function buildRequestOptions(
  config: ApiEndpointConfig,
  method: string,
  extraHeaders: Record<string, string> = {},
): https.RequestOptions {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    ...extraHeaders,
  };

  if (config.origin) {
    headers['Origin'] = config.origin;
  }
  if (config.referer) {
    headers['Referer'] = config.referer;
  }

  return {
    hostname: config.hostname,
    port: config.port,
    path: config.path,
    method,
    headers,
  };
}

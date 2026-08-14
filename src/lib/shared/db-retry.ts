/**
 * 数据库写操作重试工具。
 *
 * 背景：scrape-runner 在国内 self-hosted runner 上执行，写 TiDB Serverless
 * 走海外 HTTP Data API，长链路偶发 ETIMEDOUT / fetch failed 等瞬时网络错误。
 * 批量插入需要分块 + 指数退避重试，避免单次大请求失败导致整页数据丢失。
 */

/** 单次重试的基础等待时间（毫秒），实际等待 = base * 2^attempt */
const RETRY_BASE_DELAY_MS = 1000;

/**
 * 判断错误是否为瞬时网络错误（值得重试）。
 * 同时沿错误链检查 cause（undici 的 fetch failed 会把 ETIMEDOUT 放在 cause 里）。
 */
export function isTransientDbError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    if (current instanceof Error) {
      const message = current.message || '';
      const code = (current as NodeJS.ErrnoException).code || '';
      if (
        /fetch failed|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network socket disconnected/i.test(
          message
        ) ||
        ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_SOCKET'].includes(code)
      ) {
        return true;
      }
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}

/**
 * 带指数退避的重试包装。仅在错误为瞬时网络错误时重试，其余错误直接抛出。
 *
 * @param fn 要执行的操作
 * @param attempts 总尝试次数（含首次），默认 3
 * @param label 日志标签
 */
export async function withDbRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  label = 'DB 操作'
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const remaining = attempt + 1 < attempts;
      if (!isTransientDbError(error) || !remaining) {
        throw error;
      }
      const delay = RETRY_BASE_DELAY_MS * 2 ** attempt;
      console.warn(`[${label}] 瞬时错误，${delay}ms 后重试（第 ${attempt + 2}/${attempts} 次）:`, errorMessage(error));
      await sleep(delay);
    }
  }
  throw lastError;
}

/** 将数组按固定大小分块 */
export function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 通用并发池工具
 * 控制异步任务的并发数量
 */

/**
 * 并发池 - 控制并发数量执行任务
 * @param items 待处理的任务列表
 * @param concurrency 并发数
 * @param fn 处理单个任务的函数
 * @param onProgress 进度回调（可选）
 * @returns 所有任务的结果
 */
export async function promisePool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
  onProgress?: (completed: number, total: number) => void
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];
  let completed = 0;

  for (const item of items) {
    const promise = fn(item)
      .then(result => {
        results.push(result);
        completed++;
        if (onProgress) {
          onProgress(completed, items.length);
        }
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
 * 批量并发执行 - 按批次执行，每批次内并发
 * @param items 待处理的任务列表
 * @param batchSize 每批次大小
 * @param concurrency 每批次内并发数
 * @param fn 处理单个任务的函数
 * @param onBatchComplete 每批次完成回调
 */
export async function batchWithConcurrency<T, R>(
  items: T[],
  batchSize: number,
  concurrency: number,
  fn: (item: T) => Promise<R>,
  onBatchComplete?: (batchIndex: number, completedInBatch: number) => void
): Promise<R[]> {
  const results: R[] = [];
  const totalBatches = Math.ceil(items.length / batchSize);

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchIndex = Math.floor(i / batchSize) + 1;

    const batchResults = await promisePool(batch, concurrency, fn);
    results.push(...batchResults);

    if (onBatchComplete) {
      onBatchComplete(batchIndex, batchResults.length);
    }
  }

  return results;
}

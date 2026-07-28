import { promisePool } from '../concurrent-pool';
import {
  completeProgress,
  setErrorProgress,
  type ProgressSource,
} from '../progress-manager';

/** 抓取结果基本形状（gz / pubonln 共同字段） */
interface ScrapeResultShape {
  success: boolean;
  message: string;
  error?: string;
}

/**
 * 抓取策略：各 scraper 提供差异步骤，编排骨架由 runScrape 统一
 */
export interface ScrapeStrategy<R extends ScrapeResultShape> {
  /** 日志前缀，如 '[DrugScraper]' */
  logPrefix: string;
  /** 进度源 */
  source: ProgressSource;
  /** 页并发数 */
  pageConcurrency: number;
  /** 第 1 步：重置计数器并初始化进度 */
  init(): void;
  /** 第 2 步：抓取首页（验证接口可用且确定总数，此步失败不清旧表） */
  fetchFirstPage(): Promise<{ totalRecords: number; totalPages: number }>;
  /** 第 3 步：首页数据落库（清空旧数据在本步内、首页抓取成功之后才执行） */
  persistFirstPage(totalRecords: number, totalPages: number): Promise<void>;
  /** 第 5 步：处理单个后续页（抓取+入库+进度更新），异常由骨架捕获仅记日志 */
  processPage(page: number, totalPages: number, totalRecords: number): Promise<void>;
  /** 完成日志（单页短路与全部完成两处共用） */
  logCompletion(): void;
  /** 构建成功结果 */
  buildSuccess(): R;
}

/**
 * 抓取编排骨架（模板方法）：
 * 1. 初始化 → 2. 抓首页 → 3. 首页落库（含清表） → 4. 单页短路 →
 * 5. 并发抓剩余页 → 6. 完成进度 → 7. 统一错误处理
 * 关键语义：首页抓取失败直接进入 catch，旧数据不会被清空
 */
export async function runScrape<R extends ScrapeResultShape>(
  strategy: ScrapeStrategy<R>
): Promise<R> {
  const { logPrefix, source, pageConcurrency } = strategy;

  try {
    strategy.init();

    const { totalRecords, totalPages } = await strategy.fetchFirstPage();

    console.log(`${logPrefix} 总记录数: ${totalRecords}, 总页数: ${totalPages}`);

    // 首页抓取成功后，才在 persistFirstPage 内清空旧数据并写入第一页
    await strategy.persistFirstPage(totalRecords, totalPages);

    // 如果只有一页，直接返回
    if (totalPages <= 1) {
      strategy.logCompletion();
      completeProgress(source);
      return strategy.buildSuccess();
    }

    // 生成剩余页面任务（从第2页开始）
    const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);

    console.log(`${logPrefix} 开始并发抓取剩余 ${remainingPages.length} 页，并发数: ${pageConcurrency}`);

    // 并发抓取剩余页面
    await promisePool(
      remainingPages,
      pageConcurrency,
      async (page) => {
        try {
          await strategy.processPage(page, totalPages, totalRecords);
        } catch (error) {
          console.error(`${logPrefix} 第 ${page} 页抓取失败:`, error);
        }
      },
      (completed, total) => {
        console.log(`${logPrefix} 页面进度: ${completed}/${total}`);
      }
    );

    strategy.logCompletion();

    // 完成进度
    completeProgress(source);

    return strategy.buildSuccess();
  } catch (error) {
    console.error(`${logPrefix} 抓取错误:`, error);
    const errorMsg = error instanceof Error ? error.message : '未知错误';
    setErrorProgress(source, errorMsg);
    return {
      success: false,
      message: `抓取失败: ${errorMsg}`,
      error: errorMsg,
    } as R;
  }
}

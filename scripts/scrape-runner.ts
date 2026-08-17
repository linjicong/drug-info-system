/**
 * GitHub Actions 抓取任务 runner 入口（替代 Vercel 进程内 fire-and-forget 执行）
 *
 * 流程（design §5.2）：
 * 1. 对目标源做僵尸清扫（running 超 30 分钟 → 置 idle + 残留日志标 failed）
 * 2. 逐源 CAS 认领锁（UPDATE idle→running，affectedRows=1 才成功）
 * 3. 认领后确定任务：优先认领最早的 queued 日志；否则 enabled 且 next_run_at 到期则建 scheduled 日志；否则释放锁跳过
 * 4. runScrapeJob 执行（60s 心跳 + 进度补丁节流 2s 写 task_progress + 日志回写 + finally 释放锁）
 *
 * 用法：tsx --env-file=.env scripts/scrape-runner.ts [all|gz_drug|gd_pubonln|merged_drug|ledger]
 */
import {
  sweepStaleRunning,
  claimSourceLock,
  claimQueuedLog,
  runScrapeJob,
  getUnifiedSchedulerConfig,
  createScrapeLog,
  setRunningStatus,
  type DataSource,
} from '../src/lib/unified-scheduler';
import { buildSinks } from '../src/lib/scrape-job-sinks';

const ALL_SOURCES: DataSource[] = ['gz_drug', 'gd_pubonln', 'merged_drug', 'ledger'];

/**
 * 处理单个源：CAS 认领 → 确定任务（queued 优先 / 定时到期）→ 执行；无任务则释放锁跳过
 */
async function processSource(source: DataSource): Promise<void> {
  const claimed = await claimSourceLock(source);
  if (!claimed) {
    console.log(`⏭️ [${source}] 锁被占用（其他任务运行中），跳过`);
    return;
  }

  // runScrapeJob 内部 finally 会释放锁；未进入执行阶段的路径由此处释放
  let jobStarted = false;
  let drain: (() => Promise<void>) | null = null;
  try {
    const queued = await claimQueuedLog(source);
    let logId: number | null;

    if (queued) {
      logId = queued.logId;
      console.log(`📋 [${source}] 认领 queued 日志 #${queued.logId}（${queued.scrapeType}）`);
    } else {
      const config = await getUnifiedSchedulerConfig(source);
      const nextRunAt = config?.next_run_at ? new Date(config.next_run_at as unknown as string).getTime() : NaN;
      const due = Boolean(config?.enabled && Number.isFinite(nextRunAt) && nextRunAt <= Date.now());
      if (!due) {
        console.log(`💤 [${source}] 无排队任务且未到定时时间，跳过`);
        return;
      }
      logId = await createScrapeLog(source, 'scheduled');
      console.log(`⏰ [${source}] 定时到期，创建日志 #${logId}`);
    }

    const built = buildSinks(source);
    drain = built.drain;
    jobStarted = true;
    await runScrapeJob(source, logId, built.sinks);
    console.log(`✅ [${source}] 任务执行结束`);
  } finally {
    // 等待进度写入链全部落库（含终态），避免 process.exit 截断最后一次写库
    if (jobStarted && drain) {
      await drain();
    }
    if (!jobStarted) {
      await setRunningStatus(source, 'idle');
    }
  }
}

async function main(): Promise<void> {
  const arg = process.argv[2] ?? 'all';
  const sources = arg === 'all'
    ? ALL_SOURCES
    : ALL_SOURCES.filter(source => source === arg);

  if (sources.length === 0) {
    console.error(`❌ 未知数据源: ${arg}（可选: all / ${ALL_SOURCES.join(' / ')}）`);
    process.exit(1);
  }

  console.log(`🚀 scrape-runner 启动，目标源: ${sources.join(', ')}`);

  // 第 1 步：僵尸清扫（所有目标源）
  for (const source of sources) {
    const swept = await sweepStaleRunning(source);
    if (swept > 0) {
      console.log(`🧹 [${source}] 已清扫 ${swept} 个僵尸运行状态`);
    }
  }

  // 第 2 步：逐源认领并执行（串行，避免同一 runner 内并发争抢 DB）
  for (const source of sources) {
    await processSource(source);
  }

  console.log('✅ scrape-runner 结束');
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('❌ scrape-runner 执行失败:', error);
    process.exit(1);
  });

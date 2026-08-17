/**
 * 桌面版进程内本地 runner（替代 GitHub Actions runner）
 *
 * 与 scripts/scrape-runner.ts 执行相同的认领流程，但作为常驻循环运行在
 * Next.js 服务进程内（由 src/instrumentation.ts 在 RUN_LOCAL_RUNNER=1 时启动）：
 * 1. 对所有源做僵尸清扫（running 超 30 分钟 → 置 idle + 残留日志标 failed）
 * 2. 逐源 CAS 认领锁（UPDATE idle→running，affectedRows=1 才成功）
 * 3. 认领后确定任务：优先认领最早的 queued 日志；否则 enabled 且 next_run_at 到期则建 scheduled 日志；否则释放锁跳过
 * 4. runScrapeJob 执行（60s 心跳 + 进度补丁节流 2s 写 task_progress + 日志回写 + finally 释放锁）
 *
 * 桌面环境无函数超时限制，长任务可直接在本地进程内跑完；
 * 本机为境内住宅 IP，抓取政府平台不受 CloudWAF 海外出口拦截。
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
} from './unified-scheduler';
import { buildSinks } from './scrape-job-sinks';

const ALL_SOURCES: DataSource[] = ['gz_drug', 'gd_pubonln', 'merged_drug', 'ledger'];

/** 轮询间隔：保证 UI 手动触发后延迟可接受；空闲时每轮仅几次轻量 DB 查询 */
const DEFAULT_INTERVAL_MS = 15_000;

/** globalThis 单例标记：防止 dev 热重启或多次 register() 重复启动循环 */
const RUNNER_KEY = Symbol.for('drug-info.localRunner.started');

/**
 * 处理单个源：CAS 认领 → 确定任务（queued 优先 / 定时到期）→ 执行；无任务则释放锁跳过
 */
async function processSource(source: DataSource): Promise<void> {
  const claimed = await claimSourceLock(source);
  if (!claimed) {
    console.log(`[LocalRunner] ⏭️ [${source}] 锁被占用（其他任务运行中），跳过`);
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
      console.log(`[LocalRunner] 📋 [${source}] 认领 queued 日志 #${queued.logId}（${queued.scrapeType}）`);
    } else {
      const config = await getUnifiedSchedulerConfig(source);
      const nextRunAt = config?.next_run_at ? new Date(config.next_run_at as unknown as string).getTime() : NaN;
      const due = Boolean(config?.enabled && Number.isFinite(nextRunAt) && nextRunAt <= Date.now());
      if (!due) {
        return;
      }
      logId = await createScrapeLog(source, 'scheduled');
      console.log(`[LocalRunner] ⏰ [${source}] 定时到期，创建日志 #${logId}`);
    }

    const built = buildSinks(source);
    drain = built.drain;
    jobStarted = true;
    await runScrapeJob(source, logId, built.sinks);
    console.log(`[LocalRunner] ✅ [${source}] 任务执行结束`);
  } finally {
    // 等待进度写入链全部落库（含终态）
    if (jobStarted && drain) {
      await drain();
    }
    if (!jobStarted) {
      await setRunningStatus(source, 'idle');
    }
  }
}

/** 单轮巡检：僵尸清扫 + 逐源串行认领执行 */
async function tick(): Promise<void> {
  for (const source of ALL_SOURCES) {
    const swept = await sweepStaleRunning(source);
    if (swept > 0) {
      console.log(`[LocalRunner] 🧹 [${source}] 已清扫 ${swept} 个僵尸运行状态`);
    }
  }

  for (const source of ALL_SOURCES) {
    await processSource(source);
  }
}

/**
 * 启动本地 runner 常驻循环（幂等，重复调用直接返回）。
 * 重入保护：上一轮未结束时跳过本轮，避免长任务期间重复认领。
 */
export function startLocalRunner(): void {
  const globalFlag = globalThis as Record<symbol, boolean | undefined>;
  if (globalFlag[RUNNER_KEY]) {
    console.log('[LocalRunner] 已在运行，跳过重复启动');
    return;
  }
  globalFlag[RUNNER_KEY] = true;

  const intervalMs = Number(process.env.LOCAL_RUNNER_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  console.log(`[LocalRunner] 🚀 本地 runner 启动，巡检间隔 ${intervalMs / 1000}s`);

  let ticking = false;
  const loop = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await tick();
    } catch (error) {
      // 常驻循环不能因单轮异常崩溃，只记日志等下一轮
      console.error('[LocalRunner] 本轮巡检失败:', error);
    } finally {
      ticking = false;
    }
  };

  // 启动后立即跑一轮，之后按间隔巡检
  void loop();
  const timer = setInterval(() => void loop(), intervalMs);
  timer.unref?.();
}

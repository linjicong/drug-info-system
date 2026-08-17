/**
 * Next.js instrumentation 钩子：服务进程启动时执行一次
 *
 * 桌面版专用：仅当 RUN_LOCAL_RUNNER=1（由 Electron 主进程注入）时
 * 启动进程内本地 runner，替代 GitHub Actions 认领抓取任务。
 * Vercel / 容器部署不设置该变量，行为完全不受影响。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.RUN_LOCAL_RUNNER === '1') {
    const { startLocalRunner } = await import('@/lib/local-runner');
    startLocalRunner();
  }
}

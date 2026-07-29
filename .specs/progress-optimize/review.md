# Review — progress-optimize（commit ce4023f + 修复 71e2010）

审查方式：CodeReview 子代理逐提交全量 diff + 工作区交叉验证（2026-07-28）

## 结论：0 CRITICAL / 0 HIGH / 1 MEDIUM（已修复）/ 1 LOW — 可发布

## 等价性验证（全部通过）

- finally 复位语义：成功路径 return 前 finally 先执行，与原"先复位再 return"时序
  等价；失败路径原始 error 照常 rethrow 外层 500。同时修复两个原有缺陷：
  ① 成功路径回写抛错跳过复位导致卡死；② 失败路径回写抛错掩盖原始 error
- merged 后台链：.then 异常由 .catch 接住，.catch/.finally 内部 await 全部
  try/catch 包裹，链条最终必然 fulfilled，无未处理 rejection
- updated_at 判定：setRunningStatus('running') 刷新 updated_at 作为计时起点；
  运行中其他写入只会延后自愈（保守方向）；Number.isFinite 守卫解析失败退回 409

## MEDIUM（已在 71e2010 修复）

**cron 定时链路未接入僵尸自愈**：/api/cron/trigger 在 executeScrapeTask 之前直接
判断 running_status === 'running' 提前 skip，进程崩溃遗留僵尸后定时链路每次 skip、
永远无法自愈。修复：该检查改为 canStartScrape（自带 30 分钟自愈），响应形状不变。
验证：build/tsc/vitest 15/15 全绿。

## LOW（不阻塞，择机处理）

1. **僵尸阈值 30 分钟依赖"单次抓取快于阈值"的隐式约定**：若未来抓取超 30 分钟，
   第二次触发会复位仍在运行的任务形成双跑。长期方案：判定改用最新 scrape_log
   (status='running') 的 start_time，或抓取中周期性心跳刷新 updated_at。

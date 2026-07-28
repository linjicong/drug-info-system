# progress-optimize — 进度轮询降频 + 抓取状态防卡死

## 需求（用户原话拆解）

1. 前端每 5 秒调用一次查询进度（当前 1 秒）
2. 后端回调把进度存到本地缓存 —— 现状已满足：进度经 `createProgressStore` 存
   `globalThis` 内存，抓取回调实时写入，本条零改动
3. 出现异常要处理抓取状态，避免 `running_status` 卡死导致下次不能再点抓取

## 变更清单

| 文件 | 改动 |
|------|------|
| `components/drug/hooks/use-progress-polling.ts` | 默认 `intervalMs` 1000 → 5000 |
| `app/merged/page.tsx` | 调度器探针 `runningIntervalMs` 1000 → 5000 |
| `lib/merged-progress-manager.ts` | 头注释同步（1 秒 → 5 秒轮询） |
| `lib/api/route-factories.ts` | `createFetchHandler`：`setRunningStatus('idle')` 移入 `finally` 强制复位；日志/结果回写各自 try/catch 兜底 |
| `app/api/merged/[[...action]]/route.ts` | `triggerSync` 后台链：`.catch` 回写日志兜底；`.finally` 中 finalize 与复位各自 try/catch |
| `lib/unified-scheduler.ts` | `canStartScrape` 增加僵尸状态自愈：`running` 且 `updated_at` 距今超 30 分钟 → 自动复位 idle 并放行（覆盖进程崩溃/实例回收场景） |

## 验收（GWT）

- Given 手动触发抓取，When 前端展示进度卡，Then 进度接口调用频率为每 5 秒一次。
- Given 抓取过程中日志/结果回写 DB 抛错，When 请求结束，Then `running_status`
  仍被复位为 idle，再次点击抓取返回正常（非 409）。
- Given 进程在抓取中途崩溃遗留 `running` 状态，When 30 分钟后再次点击抓取，
  Then 系统自动复位并正常启动新抓取。
- Given 正常运行中的抓取（updated_at 在 30 分钟内），When 再次点击抓取，
  Then 仍返回 409「已有抓取任务正在运行中」（防重逻辑不受影响）。

## 风险

- 僵尸判定阈值 30 分钟须大于最长单次抓取时长（当前全量抓取约 10~20 分钟），
  若未来抓取耗时增长需同步调大 `STALE_RUNNING_TIMEOUT_MS`。

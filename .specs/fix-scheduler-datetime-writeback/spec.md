# Spec — fix-scheduler-datetime-writeback（hotfix）

## 问题（用户报告）

药品汇总表（merged）的状态回写有问题：手动合并完成后，调度卡片的
「上次执行时间/状态」不更新。

## 根因

`scheduler_config` 的 `next_run_at` / `last_run_at` / `updated_at` 为 drizzle
`datetime()` 列（date 模式），驱动层 `mapToDriverValue` 直接调用
`value.toISOString()`。而 `finalizeScrapeRun` 与 `updateUnifiedSchedulerConfig`
通过 `Record<string, unknown>` 绕过类型检查传入 **ISO 字符串**，运行时抛
`value.toISOString is not a function`，整条 update 失败：

1. 手动合并：错误被 `.finally` 兜底吞掉（仅打日志）→ last_run_at/status 永不更新
2. cron 定时：finalize 抛错进 `executeScrapeTask` catch → 成功日志被改写为 failed
3. POST /api/*/scheduler 配置更新 → 500

（`setRunningStatus`/`updateScrapeLog` 一直传 Date 对象，不受影响。）

## 变更清单

| 文件 | 变更 |
|------|------|
| src/lib/unified-scheduler.ts | finalizeScrapeRun / updateUnifiedSchedulerConfig 的 datetime 字段改传 Date 对象 |
| src/lib/__tests__/unified-scheduler.test.ts | update.set 捕获 mock + 2 个回归用例（字段必须为 Date 实例） |

## 验收（GWT）

- Given 手动合并完成，When 前端刷新 scheduler，Then lastRunAt/lastRunStatus 为本次结果
- Given cron 触发 merged 同步成功，When 查看抓取历史，Then 日志 status=success 不被改写
- Given POST scheduler 配置 enabled=true，When 更新，Then 200 且 next_run_at 推进

## 风险/回滚

改动仅数据写入类型，无业务逻辑变化；回滚 revert 单提交即可。

# Verification: actions-scrape-runner

验证时间：2026-08-13 20:15 (+08:00) ｜ trace_id: sc-20260813-5d98fbea

## 概要

| 级别 | 状态 | 详情 |
|------|------|------|
| Scope | standard | 并发 + 公共 API + 跨模块改动，不允许降档 |
| 1. 静态检查 | PASS | 本次变更 17 个文件 eslint 0 errors 0 warnings；tsc 0 errors。仓库存量 lint 错误（ledger-service 8 处 no-explicit-any、ledger/gz/pubonln 页面 9 处）为历史债务且 git diff 未触及，列 CI 补跑项 |
| 2. 单元测试 | PASS | 4 files / 46 passed, 0 failed, 0 skipped（review 修复后重跑，非复用） |
| 3. 构建 | PASS | `pnpm build` Compiled successfully in 13.2s，TypeScript 通过，11 静态页 + 5 动态 API 路由，0 warning；路由表确认 cron/trigger 已不存在 |
| 4. 集成测试 | PASS | 真实 TiDB + 真实源站全链路：`pnpm scrape:runner all` 依次执行 gz_drug（45126 条/183s）→ gd_pubonln（44016 条/78s）→ merged_drug（55127 条/297s），ledger 未到点正确跳过 |
| 5. 边界情况 | PASS | 空（无 queued 回退定时判定）/ 错误路径（任务抛错标 failed 且释放锁、写库失败不传播）/ 并发（CAS 认领失败跳过、409 互斥）/ 驱动形状（rowsAffected 与 affectedRows 各一例） |
| 6. E2E 验证 | N/A（理由见下） | 前端组件零改动，plan E2E 规划定义为上线后走查；本地集成验证已覆盖数据链路 |

## Level 4 集成验证证据（真实 DB 查询，2026-08-13 20:08 UTC+8）

`scheduler_config`：四源 `running_status` 全部回到 `idle`，三源 `last_run_status=success` 且 `next_run_at` 推进 1 小时。

`scrape_log`：#533389 gz_drug / #533390 gd_pubonln / #533391 merged_drug，均 `scheduled + success`，`end_time` 完整。

`task_progress`：三行终态 `completed`，counters 完整（gz 45126 / pubonln 44016 / merged 55127），`end_time` 非空——**review HIGH 修复（drain 等待写入链落库）的直接证据**：进程退出前终态进度行已持久化。

## Level 6 N/A 理由（与 plan E2E 验证规划一致）

1. 前端组件零改动（data-testid 表 N/A，沿用现有 DOM），无新增 UI 行为可断言；
2. 仓库无 Playwright 设施，plan 将 Critical Path 定义为**上线后**走查（含 Actions dispatch 试跑、次日四定时日志观察），依赖部署完成这一外部前置条件；
3. 进度展示契约不变已由 Level 2（task-progress-repo 12 例逐字段断言）+ Level 4（真实进度行落库）双重覆盖。

## Spec 需求 → 验证级别映射

| 需求 | 验证方式 | 状态 |
|------|---------|------|
| 1. Actions 定时执行四源 | Level 4（runner 真实执行三源 + ledger 到期判定跳过） | PASS |
| 2. 手动触发入队、立即返回 | Level 2（route-factories 7 例） | PASS |
| 3. 并发互斥不变 | Level 2 + Level 5（CAS/409 用例） | PASS |
| 4. 进度展示契约不变 | Level 2（12 例）+ Level 4（真实行落库） | PASS |
| 5. 僵尸自愈继续生效 | Level 2（sweepStaleRunning 用例） | PASS |
| 6. 下线 Vercel 执行与 Cron | Level 3（构建路由表无 cron）+ Level 1（无残留引用） | PASS |

## CI 补跑项 / 遗留

- 仓库存量 lint 错误（17 处，均非本次引入）：建议独立清理任务处理；本次验证以"本次变更文件零 error 零 warning"为口径。
- GitHub runner 出口访问政府平台源站：本地出口已验证可达，Actions 出口需上线后 dispatch 试跑确认（plan 风险表 HIGH）。
- Level 6 Critical Path 5 条：上线后按 plan 走查（含次日四定时日志观察）。

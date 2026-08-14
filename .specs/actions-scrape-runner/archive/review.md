# Code Review: actions-scrape-runner

## 概要
- 审查文件数: 14（核心实现 6 + 路由 4 + workflow/配置/文档 4）
- 发现问题: 4 (CRITICAL: 0, HIGH: 1, MEDIUM: 1, LOW: 2)
- 命中维度: 正确性 / 性能 / Spec 合规 / 安全
- 结论: **PASS**（HIGH 与 MEDIUM 均已在本次审查中修复并全量回归通过）

## 问题列表

### CRITICAL
（无）

### HIGH
| # | 维度 | 文件 | 行 | 问题 | 建议修复 |
|---|------|------|-----|------|----------|
| 1 | 正确性 | scripts/scrape-runner.ts | processSource/main | 进度写入链（chain）为 fire-and-forget promise，终态写库后 `main()` 立即 `process.exit(0)`，可能截断最后一次 task_progress 写入，前端进度卡 running 直到 5 分钟读侧降级 | **已修复**：createDbSink 增加 `drain()`（刷出未到期节流快照并 await 写入链），processSource finally 中 jobStarted 时先 drain 再退出 |

### MEDIUM
| # | 维度 | 文件 | 行 | 问题 | 建议 |
|---|------|------|-----|------|------|
| 1 | 正确性 | src/lib/unified-scheduler.ts | runScrapeJob catch | 业务函数以异常方式失败（非返回 failure result）时，catch 分支未向 sinks 发出终态 error 补丁，进度行停留 running 等待读侧降级 | **已修复**：catch 分支按 sink 类型补发 `{status:'error', error, endTime}` 终态补丁 |

### LOW
| # | 维度 | 文件 | 行 | 备注 |
|---|------|------|-----|------|
| 1 | 架构 | src/app/api/*/\route.ts | 入队接口 | 重复点击手动触发会写入多条 queued 日志，runner 逐周期各执行一次；design §7 已声明接受该语义 |
| 2 | 可读性 | scripts/scrape-runner.ts | processSource | `config?.next_run_at as unknown as string` 双重断言源于 drizzle datetime 类型推断，可接受但后续可收敛为统一日期工具 |

## Spec 合规
| 需求 | 实现位置 | 测试位置 | 状态 |
|------|---------|---------|------|
| 1. Actions 定时执行四源 | .github/workflows/scrape-runner.yml + scripts/scrape-runner.ts + runScrapeJob | T5 本地试跑（merged 日志 #503389 success 全链路） | ✓ 已覆盖 |
| 2. 手动触发入队、立即返回 | src/lib/api/route-factories.ts(createFetchHandler) + merged triggerSync + ledger manualTrigger | route-factories.test.ts（7 例） | ✓ 已覆盖 |
| 3. 并发互斥（409 + Actions 跳过 running） | canStartScrape + claimSourceLock（CAS） | unified-scheduler.test.ts | ✓ 已覆盖 |
| 4. 进度展示契约不变 | task-progress-repo.ts(fetchProgressFromDb/mergeProgressFromDb 逐字段映射 + 5 分钟心跳降级) | task-progress-repo.test.ts（12 例） | ✓ 已覆盖 |
| 5. 僵尸自愈 30 分钟继续生效 | sweepStaleRunning + STALE_RUNNING_TIMEOUT_MS | unified-scheduler.test.ts | ✓ 已覆盖 |
| 6. 下线 Vercel 执行与 Cron | 删 cron/trigger、vercel.json crons 清空、ledger 入口入队化 | —（删除类变更，ts-check 无残留引用） | ✓ 已覆盖 |

## 测试覆盖
| 测试类型 | 状态 | 备注 |
|----------|------|------|
| 正常路径 | ✓ | 入队成功 / 认领执行 / 进度读取映射 |
| 错误路径 | ✓ | 入队失败 500 / 409 互斥 / 任务抛错标 failed 且释放锁 / 写库异常不传播 |
| 边界情况 | ✓ | 两种驱动 affectedRows 形状 / 僵尸清扫 / 心跳降级 / queued 为空回退定时判定 |
| 集成验证 | ✓ | T5 本地试跑 merged_drug 全链路 DB 验证（log success + task_progress completed + 锁回 idle） |

## What's done well
- 进度读取侧的 5 分钟心跳降级（`degradedIfStale`）与 runner 侧 30 分钟僵尸清扫形成双保险：即使 Actions 进程被 SIGKILL，用户也能在 5 分钟内看到明确错误而不是永久转圈。
- `getAffectedRows` 同时兼容 `rowsAffected`（HTTP 驱动）与 `affectedRows`（mysql2 回退）两种形状，并各配一条单测，把一次真实踩坑固化成了回归防线。
- createDbSink 的"补丁合并进累加器 → 节流整体快照写库"设计避免了部分补丁覆盖旧字段，终态立即写 + 非终态节流 2s 的分层策略在 T5 试跑中验证了 DB 写入频率可控。

## 建议人工跟进
- GitHub runner 出口 IP 访问政府平台源站（gz/pubonln）是否被拦为本次最大外部风险（plan 风险表 HIGH），需在放开 schedule 前用 workflow_dispatch 试跑确认。
- 观察期后物理删除 @deprecated 的内存 progress store 与 executeScrapeTask（T10 已标注）。

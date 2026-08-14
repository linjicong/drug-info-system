# Plan: 抓取/同步执行体迁移至 GitHub Actions

## Spec 引用
- 路径: `.specs/actions-scrape-runner/spec.md`

## Design 引用
- 路径: `.specs/actions-scrape-runner/design.md`(已通过 Gate B 人工评审)

## 代码库上下文

### 现有模式
- 后台任务生命周期骨架:`unified-scheduler.executeScrapeTask`(`src/lib/unified-scheduler.ts:379`)——canStart → setRunning → createLog → try/catch/finally(idle 复位)。本 feature 将其重构为共享 `runScrapeJob`。
- 手动触发双层结构:`route-factories.createFetchHandler`(`src/lib/api/route-factories.ts:141`)负责 gz/pubonln;merged 在 `src/app/api/merged/[[...action]]/route.ts:258` 独立实现 `triggerSync`。两处都要改为入队语义。
- 一次性 DDL 脚本惯例:`scripts/add-prefix-index.ts`(原生 SQL + tsx + `--env-file=.env`)。
- 进度 store:`src/lib/shared/progress-store.ts` globalThis 工厂;`progress-manager.ts`(gz/pubonln)与 `merged-progress-manager.ts`(merged)为两种契约。

### 依赖图谱
- `scripts/scrape-runner.ts` → `unified-scheduler` + 四个服务函数(`drug-scraper.scrapeDrugInfo`、`pubonln-scraper.scrapePubonlnDrugInfo`、`merged-drug-service.syncMergedDrugData`、`ledger-service.executeLedgerSnapshot`)+ 新 task-progress repo。
- API 路由 → `unified-scheduler`(canStartScrape/createScrapeLog)+ 新 repo(读进度)。
- 前端 hooks(`use-progress-polling`/`use-scheduler`)→ 仅消费 API 响应,不直接改。
- DB 连接:`src/storage/database/db.ts` 仅依赖单一 `DATABASE_URL` env——Actions Secrets 只需配一个变量。

### 约定与风格
- 包管理 pnpm;脚本用 tsx + `--env-file=.env`(见 package.json scripts)。
- 测试:vitest,镜像目录 `src/lib/__tests__`、`src/lib/api/route-factories.test.ts`;mock db 的模式见 `unified-scheduler.test.ts`。
- datetime 列写入必须用 Date 对象(9b821ea 修复教训);时间戳语义为 UTC 墙钟。
- API 错误响应统一走 `src/lib/api/responses.ts` 的 `jsonError`。

### 配置上下文
- Next.js 16 App Router + catch-all 动态路由(`[[...action]]`)+ `createModuleRoute` 分发;`vercel.json` crons 待删;`drizzle.config.ts` 存在但不走 push(手工脚本建表)。

### 边界约束
- `scrape_log.status` 为 varchar,新值 `queued` 无 DDL;`scheduler_config` 不加列。
- 前端响应契约逐字段不变(FetchProgress / MergeProgress / SchedulerConfig)。
- ledger 路由(`src/app/api/ledger/[[...action]]/route.ts`)是否有手动快照触发入口需在 T8 审计确认。

### 技术栈规范
- `references/nodejs-patterns.md`(脚本/日志/错误处理)、`references/api-patterns.md`(响应格式与状态码)、`references/mysql-patterns.md`(DDL/CAS UPDATE)。

## 阶段

### 阶段 1: 数据层(task_progress)
**复杂度:** Medium

- [ ] T1: 新增 task_progress 表定义与建表脚本
  - 输入: design §3.1 表结构;`schema.ts`、`scripts/add-prefix-index.ts` 惯例
  - 输出: `schema.ts` 增 `taskProgress` 定义;`scripts/create-task-progress-table.ts`(CREATE TABLE IF NOT EXISTS);本地对 TiDB 执行成功
  - 复杂度: Low
  - Blocked-by: 无

- [ ] T2: task-progress 仓储层 `src/lib/task-progress-repo.ts`
  - 输入: T1 表定义;FetchProgress/MergeProgress 契约(`progress-manager.ts`、`merged-progress-manager.ts`)
  - 输出: `upsertProgress(source, patch)`(写 JSON counters + updated_at 心跳)、`getProgress(source)`(datetime→毫秒时间戳、running 且心跳超 5 分钟降级 error、无记录返回 idle 默认)、`resetProgress(source)`;单测(mock db)覆盖三种读取分支与降级逻辑
  - 复杂度: Medium
  - Blocked-by: T1

### 阶段 2: 任务执行核心
**复杂度:** High

- [ ] T3: 业务函数进度解耦(onProgress 注入)
  - 输入: `syncMergedDrugData`、`scrapeDrugInfo`、`scrapePubonlnDrugInfo`、`executeLedgerSnapshot`
  - 输出: 四函数各增可选参数 `onProgress?: (patch: Record<string, unknown>) => void`,内部对 progress-manager 的直接调用全部改为 onProgress(默认 no-op);现有单测不回归;merged-drug-service 的进度调用点(约 10 处)逐一替换
  - 复杂度: Medium
  - Blocked-by: 无

- [ ] T4: 共享生命周期 `runScrapeJob` + CAS 认领 + 僵尸清扫 + 心跳
  - 输入: T2 repo;`executeScrapeTask` 现有骨架;design §5.2/§5.4
  - 输出: `unified-scheduler.ts` 新增 `sweepStaleRunning(source)`(30 分钟僵尸置 idle + running 日志标 failed)、`claimSourceLock(source)`(原子 UPDATE idle→running,返回是否成功)、`runScrapeJob(source, logId, progressSink)`(心跳 60s + 执行 + 日志回写 + finalize + finally 释放);`executeScrapeTask` 改为基于这三者的薄封装(保持 cron trigger 删除前的过渡兼容);单测覆盖:CAS 失败不执行、僵尸清扫条件、心跳定时刷新、finally 释放
  - 复杂度: High
  - Blocked-by: T2, T3

- [ ] T5: Runner 入口 `scripts/scrape-runner.ts`
  - 输入: T4 全部;design §5.2 主流程
  - 输出: CLI 接受 `source` 入参(all/四源之一);流程 = 僵尸清扫 → 逐源认领 → 认领后查 queued 日志(最早一条,改 running)或 enabled+next_run_at 到期(建 scheduled 日志)→ runScrapeJob → 无任务释放锁;全程 console 结构化日志;`tsx --env-file=.env scripts/scrape-runner.ts merged_drug` 本地可跑通(试跑 merged 一次,作为 Level 4 集成验证)
  - 复杂度: Medium
  - Blocked-by: T4

### 阶段 3: API 路由改造
**复杂度:** Medium

- [ ] T6: gz/pubonln 手动触发改入队 + 进度读 DB
  - 输入: T2、T4;`createFetchHandler`、`createProgressHandlers`
  - 输出: `createFetchHandler` 重写为 canStartScrape → createScrapeLog('queued') → 立即返回(不再 setRunningStatus/后台 promise);`createProgressHandlers` 的 getFn/resetFn 改接 repo(异步化);`route-factories.test.ts` 更新(409 语义、queued 插入、不再调用 run);gz/pubonln route.ts 适配新工厂签名
  - 复杂度: Medium
  - Blocked-by: T2, T4

- [ ] T7: merged 路由 triggerSync 入队化 + 进度读 DB
  - 输入: T2、T4;`merged/[[...action]]/route.ts`
  - 输出: `triggerSync` 同 T6 语义;`getSyncProgress/resetSyncProgress` 改读 repo;移除对 `startMergeProgress` 的调用;响应结构不变
  - 复杂度: Medium
  - Blocked-by: T2, T4

- [ ] T8: 下线旧触发通道 + ledger 入口审计
  - 输入: T5;`cron/trigger/route.ts`、`vercel.json`、`ledger` 路由
  - 输出: 删除 `src/app/api/cron/trigger/`(含 route.test.ts);`vercel.json` crons 清空;审计 ledger 路由——若存在手动快照触发则同 T6 入队化,否则记录 N/A;`unified-scheduler.test.ts` 中 executeScrapeTask 相关用例随封装重构同步更新
  - 复杂度: Low
  - Blocked-by: T5

### 阶段 4: CI 与清理
**复杂度:** Low

- [ ] T9: 新增 `.github/workflows/scrape-runner.yml`
  - 输入: T5;design §5.1
  - 输出: schedule `*/5 * * * *`(先注释禁用,上线步骤 5 再放开)+ workflow_dispatch(source choice)+ concurrency 排队 + pnpm setup 缓存 + `DATABASE_URL` 从 Secrets 注入 + timeout-minutes 45
  - 复杂度: Low
  - Blocked-by: T5

- [ ] T10: 清理废弃文件与死代码
  - 输入: 全部前置
  - 输出: 删除 `.github/workflows/cloudbase-cron.yml`;progress-manager/merged-progress-manager/progress-store 保留但标注 `@deprecated`(被 T3 解耦后无调用方;物理删除留待观察期后);README/DEPLOY 文档中 cron 说明更新指向 Actions
  - 复杂度: Low
  - Blocked-by: T6, T7, T9

## Spec 需求映射

| Spec 需求 | 任务 |
|-----------|------|
| 1. Actions 定时执行四源 | T4, T5, T9 |
| 2. 手动触发入队 | T6, T7, T5 |
| 3. 并发互斥 | T4(CAS), T6/T7(409) |
| 4. 进度展示契约不变 | T1, T2, T3, T6, T7 |
| 5. 日志完整闭环 | T4, T5, T8(僵尸标 failed) |
| 6. 下线 Vercel 执行与 Cron | T8, T9, T10 |

## 风险

| 风险 | 严重度 | 缓解 |
|------|--------|------|
| GitHub runner 出口访问政府平台 API(gz/pubonln 抓取源站)被拦 | HIGH | T5 完成后先 dispatch 试跑 gz_drug/pubonln;被拦则升级讨论代理方案,merged/ledger 不依赖外网可先行上线 |
| @tidbcloud/serverless HTTP 驱动在 Actions Node 环境行为差异 | MEDIUM | T5 本地验证与 Actions 试跑用同一脚本;首步先跑只读 inspect |
| 新旧双通道窗口期重复触发 | MEDIUM | 严格按 design §8 顺序:T8(删 vercel crons)与 T9(schedule 注释)同 PR 合并,先部署后试跑再放开 |
| 进度降级误判(心跳 5 分钟阈值)误伤慢批次 | LOW | merged 每批回写进度天然 <2s 一次;阈值仅在"running+无心跳"时生效 |
| 现有测试大面积红 | LOW | T6/T8 同步更新既有断言,每任务完成即跑 `pnpm test` |

## E2E 验证规划

### Critical Path(上线后人工/Agent 浏览器走查,前端代码未改,验证链路贯通)
1. merged 页点击"合并同步" → toast 提示已入队 → 进度卡出现 running(5 分钟内)→ 完成后数据表刷新、toast 成功
2. gz 页点击"手动抓取" → 同上;完成后"最新数据时间"更新
3. 任务执行中再次点击按钮 → 收到 409 文案「已有抓取任务正在运行中」
4. GitHub Actions 页手动 dispatch `source=merged_drug` → job 成功 → DB 日志 success(spec 场景 1)
5. 观察次日四个定时任务日志均为 success(spec 场景 5)

### data-testid 表
N/A —— 前端组件零改动,沿用现有 DOM 结构定位;不新增 testid。

### Level 4 集成验证(本地/CI 脚本)
- `tsx --env-file=.env scripts/scrape-runner.ts merged_drug` 全链路跑通(认领→执行→回写→释放)
- 构造僵尸态(running + updated_at 过期)后运行 runner,验证清扫与认领(spec 场景 4)

## 验证命令
- `pnpm test`(vitest 全量)
- `pnpm ts-check`(tsc)
- `pnpm lint`

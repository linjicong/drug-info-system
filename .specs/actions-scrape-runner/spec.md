# Spec: 抓取/同步执行体迁移至 GitHub Actions(actions-scrape-runner)

> Feature ID: `actions-scrape-runner`
> 创建时间: 2026-08-13
> 负责人: @user

## 问题陈述

项目从云托管(常驻容器)迁移到 Vercel(serverless)后,所有抓取/合并任务仍沿用"HTTP 响应立即返回 + 后台 promise 异步执行"的模式(该模式依赖常驻容器进程不死的假设)。Vercel 函数在响应返回后即冻结/回收实例,后台任务必然中途被杀,导致:

1. `scheduler_config.running_status` 永久卡在 `running`,后续所有 `/api/*/sync` 请求返回 409「已有抓取任务正在运行中」;
2. `scrape_log` 留下大量 `status='running'` 且无 `end_time` 的死记录(已观测到 2026-07-29、2026-08-13 两次);
3. Vercel Cron 定时链路(gz_drug / gd_pubonln / merged_drug / ledger)自 7-30 后无一成功;
4. 30 分钟僵尸自愈后再次触发,再次被杀,形成"永久卡死"循环。

不改的后果:四个数据源的定时抓取全部失效,汇总表数据停留在 7-30,系统实际已停止更新。

## 需求

### 功能性需求

1. **Actions 定时执行四个数据源**
   - 描述:GitHub Actions 按现有四个数据源的原定时刻表,在 runner 上直连 TiDB 执行对应任务(gz_drug 抓取、gd_pubonln 抓取、merged_drug 合并同步、ledger 快照)。
   - 可测试标准:workflow_dispatch 手动触发任一 source,`scrape_log` 出现对应 `status='success'` 记录,且 `scheduler_config.running_status` 回到 `idle`、`last_run_at/last_run_status/next_run_at` 同步更新。

2. **手动触发入口保留,原语义不变**
   - 描述:页面"手动抓取/合并"按钮与 API(`/api/gz/sync`、`/api/pubonln/sync`、`/api/merged/sync`)保留。请求进入后写一条 `scrape_type='manual'` 的待执行记录(入队),由 Actions 轮询认领执行;API 立即返回成功,不再在 Vercel 函数内执行任务本体。
   - 可测试标准:POST 任一 sync 接口立即(≤3s)返回 `{success:true}`;数据库出现 `status='running'`、`scrape_type='manual'` 的日志记录;任务被 Actions 认领后在 1 个轮询周期内开始执行。

3. **并发互斥语义不变**
   - 描述:同一 source 同时只允许一个任务执行。已有任务运行时,新手动请求仍返回 409「已有抓取任务正在运行中」;Actions 轮询跳过正在运行的 source。
   - 可测试标准:构造某 source `running_status='running'` 且 `updated_at` 新鲜,POST sync 返回 409;30 分钟僵尸自愈逻辑继续生效。

4. **进度/状态展示逻辑不变**
   - 描述:前端现有进度轮询接口(`/api/*/sync/progress`)、调度器配置接口(`/api/*/scheduler`)保持现有响应结构与交互;执行体在 Actions 期间,进度数据通过数据库可见的字段(阶段、计数、起止时间)对外暴露,前端无需结构性重构。
   - 可测试标准:任务执行期间前端可展示 running 状态与最终 completed/error 结果;刷新页面后状态与服务端一致。

5. **执行日志完整闭环**
   - 描述:无论成功、失败还是进程级异常,`scrape_log` 均不得永久停留在 `running`:成功/失败写 `end_time` 与统计;Actions job 崩溃由下一次轮询的僵尸自愈兜底标记。
   - 可测试标准:模拟任务中途抛错,日志为 `failed` 且 `error_message` 非空。

6. **下线 Vercel 内任务执行与 Vercel Cron**
   - 描述:移除/停用 `vercel.json` 中四条 cron 及 `/api/cron/trigger` 触发任务本体的职责(接口可保留为仅状态探测或彻底移除,见设计阶段);避免双通道重复触发。
   - 可测试标准:部署后 Vercel 侧不再产生新的 `scrape_type='scheduled'` 记录;所有定时记录来源于 Actions。

### 非功能性需求

- **可靠性**:单数据源任务执行时间上限按 30 分钟计(Actions job timeout 设为 30~45 分钟);任务失败不影响其它 source。
- **安全**:TiDB 连接串仅存于 GitHub Secrets;API 排队接口不得泄露数据库凭据。
- **可观测性**:Actions 执行日志可在 GitHub 页面查看;`scrape_log.error_message` 记录失败原因。
- **时区一致性**:沿用现状——数据库时间戳按 UTC 墙钟写入(驱动层序列化 `new Date()` 为 UTC),Actions 侧写入保持一致。

## 约束

### 技术约束

- 包管理器仅允许 pnpm;Actions 中安装依赖用 `pnpm install`。
- 执行逻辑复用现有 `src/lib` 服务(scrapeDrugInfo / scrapePubonlnDrugInfo / syncMergedDrugData / executeLedgerSnapshot)与 `unified-scheduler`,不在 Actions 脚本中重写业务逻辑。
- 数据库为 TiDB Serverless,Actions runner 需可通过公网连接(与现有 migrate/inspect 脚本同路径)。
- 现有 `.github/workflows/cloudbase-cron.yml`(HTTP 触发器)将被新 workflow 取代或改造。
- 前端组件(`use-progress-polling` / `use-scheduler` 及各页面)响应契约不变,避免大范围 UI 返工。

### 业务约束

- 定时时刻表与现状一致(UTC 18:00 / 18:30 / 20:00 / 22:00)。
- 迁移期间不得中断查询类接口(列表、导出、台账查询)。

## 验收标准

### 场景 1:Actions 定时合并同步成功

- **Given** `merged_drug` 的 `running_status='idle'`,Actions workflow 配置就绪
- **When** workflow_dispatch 以 `source=merged_drug` 触发
- **Then** `drug_info_merged` 被重新全量写入(行数 > 0,`synced_at` 更新)
  - And `scrape_log` 最新一条 `source='merged_drug'` 为 `success`,`end_time` 非空
  - And `scheduler_config` 中 `merged_drug` 回到 `idle`,`last_run_status='success'`

### 场景 2:手动触发走排队链路

- **Given** 站点已部署新版,`gz_drug` 空闲
- **When** 页面点击手动抓取(POST /api/gz/sync)
- **Then** API 在 3 秒内返回 `{success:true}`
  - And `scrape_log` 出现 `scrape_type='manual'`、`status='running'` 的新记录
  - And Actions 轮询在下一周期认领并执行,结束后日志为 `success/failed` 且 `running_status` 回 `idle`
  - And 前端最终展示完成/失败结果(与现有交互一致)

### 场景 3:并发互斥不被破坏

- **Given** 某 source 存在执行中的任务(`running_status='running'` 且 `updated_at` 距今 < 30 分钟)
- **When** 再次 POST 该 source 的 sync 接口
- **Then** 返回 409,消息为「已有抓取任务正在运行中」
  - And 数据库不产生第二条 `running` 日志

### 场景 4:僵尸状态自愈仍然生效

- **Given** 某 source `running_status='running'` 且 `updated_at` 距今超过 30 分钟(模拟 Actions runner 崩溃)
- **When** Actions 轮询或任一 sync 请求到达
- **Then** 状态被自动复位为 `idle`
  - And 卡住的 `scrape_log` 记录被标记 `failed` 并写明原因
  - And 新任务可以正常启动

### 场景 5:Vercel 侧不再执行任务本体

- **Given** 新版部署到 Vercel
- **When** 观察连续 24 小时的 `scrape_log`
- **Then** 所有 `scheduled` 记录均来自 Actions 触发(可通过日志备注/来源字段区分)
  - And Vercel Cron(vercel.json crons)不再产生执行记录

## 范围外

- 不重构四个数据源的业务抓取/合并算法本身(分页、去重逻辑保持)。
- 不改动查询/导出/台账类接口行为。
- 不做实时逐批进度条的完整还原(以现有接口契约可用的最小改造为准,细粒度进度若成本高则降级)。
- 不迁移数据库、不变更表结构之外的必要新表除外(如需排队/心跳表,在设计阶段定义)。
- 不改变 GitHub Actions 仓库之外的 CI(如 CloudBase 部署链路残留文件清理不在本期硬要求内)。

## 依赖

- 上游:GitHub 仓库 Settings Secrets 需配置 TiDB 连接相关环境变量(与 `.env` 中 DATABASE 配置同源)。
- 下游:前端三个页面(gz / pubonln / merged)与 ledger 页的进度卡片行为;`unified-scheduler` 被 Actions 脚本与 API 共同依赖。

## 风险与假设

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| TiDB Serverless 对 Actions runner IP 的连接限制/限流 | 中 | 任务失败 | 复用现有 migrate 脚本已验证的连接方式;失败重试一次 |
| 排队认领出现双实例竞争(轮询重叠) | 低 | 重复执行 | 认领用原子 UPDATE(running_status idle→running CAS)保证唯一性 |
| 进度展示降级导致用户以为卡死 | 中 | 体验下降 | 阶段/计数写入 DB 供轮询读取;前端文案保持 |
| 迁移期间新旧双通道并存导致重复触发 | 中 | 数据竞争 | 上线步骤中先停用 vercel.json crons 再启用 Actions workflow |
| Actions cron 分钟级漂移/排队延迟 | 低 | 手动任务等待变长 | 轮询间隔控制在 1 分钟内;文档说明 |

### 复杂度阈值命中说明

本 spec 命中:跨模块改动(API 路由 + lib + workflow + 前端)、API 接口行为变更、可能新增表、涉及并发协调。技术方案、回滚方案与依赖关系将在 `design.md` 阶段给出。

### 回滚预案(摘要)

- 保留旧触发链路代码一个版本周期:回滚时恢复 `vercel.json` crons + 旧路由逻辑即可回到"云托管语义"的降级状态(仍会卡死,但非本改造引入);
- 新增表/字段采用可空增量式设计,回滚无需 schema 逆向操作。

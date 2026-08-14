# Design: 抓取/同步执行体迁移至 GitHub Actions

> Feature ID: `actions-scrape-runner`
> 输入: `.specs/actions-scrape-runner/spec.md`
> 状态: 待人工评审(Gate B)

## 1. 总体架构

```
┌─────────────┐   POST /api/{gz,pubonln,merged}/sync   ┌──────────────┐
│  前端页面    │ ─────────────────────────────────────▶ │ Vercel API    │
│ (交互不变)   │                                        │ 只做入队+状态 │
└──────┬──────┘                                        └──────┬───────┘
       │ GET /api/*/progress, /api/*/scheduler                │ 写
       ▼                                                      ▼
┌─────────────┐                                        ┌──────────────┐
│ 响应契约不变 │ ◀──── 读 ────────────────────────────  │    TiDB      │
└─────────────┘                                        │ scheduler_cfg│
                                                       │ scrape_log   │
       ┌──────────────────────────────────────────────▶│ task_progress│
       │  每 5 分钟 cron + workflow_dispatch            └──────┬───────┘
┌──────┴──────────────┐                                        │
│ GitHub Actions      │  pnpm tsx scripts/scrape-runner.ts     │
│ scrape-runner.yml   │ ──────────────────────────────────────▶│
│ (直连 TiDB 执行)     │  认领(CAS) → 执行 → 回写日志/进度/状态    │
└─────────────────────┘
```

核心思想:**Vercel 只做"入队与读状态",一行业务任务都不跑;所有执行发生在 Actions runner 的长驻进程里**。任务执行逻辑(`scrapeDrugInfo` / `scrapePubonlnDrugInfo` / `syncMergedDrugData` / `executeLedgerSnapshot`)与 `unified-scheduler` 完全复用,不重写。

## 2. 备选方案对比

| 方案 | 结论 | 理由 |
|------|------|------|
| A. Vercel 请求内同步执行 + maxDuration | 否决 | 用户已选 Actions 路线;Pro 300s 对 8 分钟的合并任务余量不足,且阻塞请求 |
| B. **Actions 轮询执行(本方案)** | ✅ 采纳 | 无超时限制,复用现有业务代码,故障可观测(GitHub 日志) |
| C. 自建常驻 worker(云主机/Docker) | 否决 | 引入新的运维面,与"部署在 Vercel"的轻运维目标冲突 |
| D. Vercel `after()` + waitUntil | 否决 | 仍受 maxDuration 约束,本质等同方案 A |

## 3. 数据模型变更

### 3.1 新表 `task_progress`(跨进程进度的唯一来源)

| 列 | 类型 | 说明 |
|----|------|------|
| source | varchar(50) PK | gz_drug / gd_pubonln / merged_drug / ledger |
| status | varchar(20) | idle / running / completed / error |
| phase | varchar(100) | 当前阶段描述 |
| counters | text(JSON) | 各源计数器快照,结构见下 |
| start_time | datetime | 任务开始(UTC 墙钟,与现有一致) |
| end_time | datetime | 任务结束 |
| error | text | 错误信息 |
| updated_at | datetime | 心跳/节流写入时间 |

counters JSON 按源区分,兼容现有两种进度契约:

```jsonc
// gz_drug / gd_pubonln(对应 FetchProgress)
{ "currentPage": 12, "totalPages": 40, "processedCount": 1200,
  "totalCount": 4000, "newCount": 3, "updateCount": 1 }
// merged_drug(对应 MergeProgress)
{ "gdLoaded": 40000, "gzLoaded": 12000, "mergedTotal": 50000, "savedCount": 24500 }
// ledger
{ "tracked": 12, "done": 12 }
```

建表方式:沿用项目惯例,`schema.ts` 加 drizzle 定义 + 一次性 tsx 建表脚本(与 `add-prefix-index.ts` 同模式),不引入 drizzle-kit push。

### 3.2 `scrape_log` 新增状态值 `queued`

- 现有枚举 `running/success/failed` 为 varchar,无需 DDL,仅新增取值。
- 语义:**manual 请求入队时插入 `queued`**;runner 认领后改 `running`,结束改 `success/failed`。
- 目的:区分"排队中(未开始,无进程)"与"执行中(进程活着)",使崩溃恢复可判定——`running` 且 `updated_at`(scheduler_config 心跳)过期 = 僵尸;`queued` 永远可被认领。

### 3.3 `scheduler_config` 不变表结构

`running_status` 继续作为互斥锁;`updated_at` 由 runner 执行期间每 60s 心跳刷新(见 §5 崩溃恢复)。

## 4. API 契约变更(Vercel 侧)

### 4.1 `POST /api/{gz,pubonln}/fetch`、`POST /api/merged/sync`(入队语义)

```
现状:canStartScrape → setRunningStatus('running') → 后台 promise 执行(会死)
改后:canStartScrape → 插入 scrape_log(status='queued', scrape_type='manual') → 立即返回 {success:true, message:'任务已加入执行队列'}
```

- 409 语义不变:running 且未过期 →「已有抓取任务正在运行中」。
- **不再调用** `setRunningStatus('running')`:锁由 runner 认领时原子置位,避免"API 置锁后无进程执行"的新僵尸形态。
- 响应体字段不变(`{success, message}`),前端无感。

### 4.2 `GET /api/{gz,pubonln}/progress`、`GET /api/merged/sync/progress`

响应 JSON 结构**逐字段不变**(FetchProgress / MergeProgress),数据源从 globalThis 内存改为读 `task_progress`:

- status=running 但 `updated_at` 距今 > 5 分钟 → 降级返回 `error`(runner 心跳丢失);
- 无记录 → 返回 idle 默认值(与现状一致)。
- 时间字段换算:DB datetime(UTC 墙钟)→ 毫秒时间戳,与内存版 `Date.now()` 契约一致。

`DELETE .../progress`(重置)保留,改为清空该 source 的 `task_progress` 行。

### 4.3 `/api/*/scheduler`、查询/导出类接口

不变。`scheduler` 返回的 `isRunning/runningStatus` 继续读 `scheduler_config`,语义天然兼容。

### 4.4 `/api/cron/trigger` 与 vercel.json crons

- 删除 `vercel.json` 中四条 crons;
- 删除 `src/app/api/cron/trigger/` 路由及其测试(职责完全由 Actions 接管,保留会造成双通道触发风险)。

## 5. GitHub Actions 侧

### 5.1 Workflow: `.github/workflows/scrape-runner.yml`

```yaml
on:
  schedule: [{ cron: '*/5 * * * *' }]   # 手动任务最长等待 5 分钟
  workflow_dispatch:
    inputs: { source: { type: choice, options: [all, gz_drug, gd_pubonln, merged_drug, ledger] } }
concurrency: { group: scrape-runner, cancel-in-progress: false }  # 重叠时排队不取消
jobs:
  run:
    timeout-minutes: 45
    steps: checkout → pnpm setup/install(缓存) →
      pnpm tsx scripts/scrape-runner.ts $SOURCE   # env: TiDB 连接(仓库 Secrets)
```

- 复用/改造 `cloudbase-cron.yml`:该文件删除(其职责是 HTTP 触发,已无被调方)。
- GitHub cron 有分钟级漂移,与 spec 风险表一致;定时任务"准点性"由 §5.3 的到期判定吸收。

### 5.2 Runner 主流程 `scripts/scrape-runner.ts`

```
1. 僵尸清扫:对 4 个 source,running 且 updated_at 超 30 分钟 →
   置 idle + 把该 source status='running' 的 scrape_log 标 failed(原因:进程异常终止)
2. 对每个 source(按入参过滤):
   a. CAS 认领:UPDATE scheduler_config
        SET running_status='running', updated_at=NOW()
        WHERE source=? AND running_status='idle'      ← affectedRows=1 才算认领成功
      (30 分钟僵尸自愈并入第 1 步,此处不再二次判定)
   b. 确定任务与日志:
      - 存在 queued 日志(最早的 manual)→ 认领它(改 running),scrape_type 沿用 manual
      - 否则 config.enabled 且 next_run_at 到期 → createScrapeLog('scheduled')
      - 否则 → 释放锁(idle),跳过
   c. 启动心跳协程:每 60s 刷 scheduler_config.updated_at
   d. 执行对应任务函数;进度回调写 task_progress(节流 2s)
   e. 结束:写日志 success/failed + finalizeScrapeRun + setRunningStatus('idle')
      (finally 保证释放,复用现有 executeScrapeTask 的结构)
```

实现方式:把 `executeScrapeTask` 重构为可注入版本(认领结果外部传入、进度汇编写入 DB),API 侧不再调用它;或 runner 直接复制其骨架调用四个服务函数——design 决定**重构为共享函数 `runScrapeJob(source, logId, progressSink)`**,API 与 runner 共用,避免两套生命周期代码。

### 5.3 定时调度判定

`scheduler_config.enabled + next_run_at` 继续生效(页面上的"定时同步开关/间隔"配置不改语义):runner 每 5 分钟扫一次,到期即执行,`finalizeScrapeRun` 推进 `next_run_at`。现有四源 `next_run_at` 均已过期,上线后首个周期即补跑一次,符合预期(数据已停在 7-30)。

### 5.4 崩溃恢复矩阵

| 崩溃点 | 残留 | 恢复机制 | 恢复时延 |
|--------|------|----------|----------|
| 认领后、执行前 runner 死 | running_status=running, 日志 running | 心跳停 → 30 分钟僵尸清扫 | ≤35 分钟 |
| 执行中途 runner 死 | 同上 | 同上 | ≤35 分钟 |
| queued 后 Actions 停摆 | 日志 queued | 下次 runner 周期认领;长期停摆由用户查 GitHub | ≤5 分钟(正常) |
| 心跳写失败但任务活着 | updated_at 停更 | 误判为僵尸→被清扫时任务仍在跑 | 阈值 30min > 最长任务,概率极低 |

## 6. 进度回写适配

现有三个进度写入方(`progress-manager` gz/pubonln、`merged-progress-manager`、ledger 内联)改为接受 **progressSink** 注入:

- Vercel 进程内:无写入方了(任务不再本地跑),内存 store 代码保留但不再被调用,标记 deprecated;
- Runner 进程内:sink = 写 `task_progress`(节流 2s,结束/错误立即写)。
- `syncMergedDrugData` 等函数内部对 progress-manager 的直接 import 调用改为可选参数 `onProgress?: (patch) => void`,默认空操作——**业务函数与存储解耦**,单测可 mock。

## 7. 安全

- TiDB 连接串(HOST/PORT/USER/PASSWORD/DB,与 `.env` 变量同名)配置为 GitHub **Secrets**,workflow 以 env 注入,不落盘不打印;
- `/api/cron/trigger` 删除后,`CRON_SECRET` 仅保留于配置读取展示(scheduler 接口现状返回 cronSecret 字段,本期不动);
- queued 入队接口无鉴权(与现状手动按钮一致,内网工具属性),不新增暴露面。

## 8. 上线步骤(顺序关键,防双通道)

1. 建 `task_progress` 表(一次性脚本);
2. 合并代码:路由入队化 + progress 读 DB + runner 脚本 + 新 workflow(**schedule 先注释禁用**);
3. 配置 GitHub Secrets;部署 Vercel(vercel.json crons 已随代码删除);
4. workflow_dispatch 单源试跑 merged_drug,验证 spec 场景 1;
5. 启用 schedule;观察一个完整周期(24h)四源日志均 success;
6. 删除 `cloudbase-cron.yml`、内存 progress store 死代码清理(可并入本 PR 或跟进)。

回滚:revert 代码即恢复 vercel.json crons + 旧路由(回到"卡死但可用"的旧态);`task_progress` 表与 queued 日志为增量数据,无需清理。

## 9. 风险与取舍备忘

- 手动任务最长等待 ≈5 分钟(GitHub cron 粒度限制)——用户已确认接受"原逻辑不变",等待期前端显示 queued→running 过渡;
- `drug_info_merged` 全量 DELETE+INSERT 的非原子窗口在 runner 长进程下依然存在(秒级),与现状一致,不在本期处理;
- GitHub Actions 免费额度:4 源 × 每日 1 次 + 每 5 分钟空扫(每次 <30s 无任务即退出),月耗量可忽略。

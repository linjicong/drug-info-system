# Plan: 用户功能使用埋点（Usage Tracking）

## Spec 引用

- 路径: `.specs/usage-tracking/spec.md`

## Design 引用

- 路径: `.specs/usage-tracking/design.md`（已评审，含数据模型与接口契约）

## 代码库上下文

### 现有模式

- 表定义：`src/storage/database/shared/schema.ts`（drizzle mysqlTable，snake_case 字段，索引在第三个参数定义）。参考 `scrapeLog` 表（serial 主键 + 索引模式）。
- 服务端路由：`src/app/api/<module>/[[...action]]/route.ts` + `createModuleRoute` 分发表；或简单 `route.ts` 直接导出方法（参考 `src/app/api/heartbeat/route.ts` 模式）。
- 前端 hooks：`src/components/drug/hooks/use-drug-query.ts`（handleSearch / handleExport）、`use-drug-module.ts`（handleFetch）、`use-scheduler.ts`（updateSchedulerConfig）——操作成功返回后追加埋点调用。
- 页面：`src/app/page.tsx`、`gz/page.tsx`、`pubonln/page.tsx`、`merged/page.tsx`（经 DrugModulePageLayout 用同一套 hooks）、`ledger/track/page.tsx`、`ledger/history/page.tsx`（独立实现）。
- 根布局：`src/app/layout.tsx`（服务端组件，需包裹 client 子组件挂 RouteTracker）。

### 依赖图谱

- `usage-tracker.ts`（NEW）→ 无依赖（纯客户端工具，不依赖 React）。
- `RouteTracker.tsx`（NEW）→ 依赖 usage-tracker.ts。
- `route.ts`（NEW）→ 依赖 `@/storage/database/db` 与 `@/storage/database/shared/schema`。
- 各 hooks / 页面 → 依赖 usage-tracker.ts。

### 约定与风格

- datetime 列必须传 `Date` 对象（drizzle mysql 驱动 `toISOString()`），本项目已有多处注释强调。
- API 错误响应统一 `{ error: string }`（createModuleRoute / jsonError 风格）；成功 `{ success: true, ... }`。
- 前端埋点调用为 fire-and-forget，不进入业务 try/catch。

### 配置上下文

- `drizzle.config.ts`：dialect=mysql，schema 指向 shared/schema.ts，out=./drizzle。建表命令 `pnpm drizzle-kit push`。
- package.json scripts 需确认（dev / build / lint / typecheck 命令，build 阶段探测）。

### 边界约束

- 不修改任何现有业务 API 的请求/响应结构（spec 范围外）。
- 新增表 `usage_events` 字段、类型、索引以 design 数据模型为准。
- 上报接口契约以 design 接口契约为准（X-User-Id header、单条/批量、50 条上限、400 错误码）。

### 技术栈

Next.js 16 + React 19 + TypeScript + drizzle-orm(mysql) + TiDB + Tailwind 4。

## 阶段

### 阶段 1: Schema（数据模型）

**复杂度:** Low

- [ ] 任务 1: 在 `schema.ts` 新增 `usageEvents` 表定义
  - 输入: design.md 数据模型（字段/类型/索引）；现有 schema.ts 风格
  - 输出: `src/storage/database/shared/schema.ts` 增加 usageEvents 表 + bigint 导入
  - Blocked-by: 无

- [ ] 任务 2: 执行 `pnpm drizzle-kit push` 同步 TiDB 并验证表结构
  - 输入: 任务 1 的 schema 变更；本地 .env 的 DATABASE_URL
  - 输出: TiDB 中新建 `usage_events` 表；`SHOW CREATE TABLE usage_events` 验证索引
  - Blocked-by: 任务 1

### 阶段 2: API（上报接口）

**复杂度:** Medium

- [ ] 任务 3: 新建 `src/app/api/track/route.ts`
  - 输入: design 接口契约（header 校验、字段校验规则、批量上限、响应格式）；现有 route 风格
  - 输出: POST /api/track 接口，含 X-User-Id 校验、body 单条/批量归一化、event_type 枚举校验、长度校验、批量 insert、`{ success, count }` / `{ error }` 响应
  - Blocked-by: 任务 1

- [ ] 任务 4: 本地接口验证（curl 单条 / 批量 / 非法 JSON / 缺 header / 非法 event_type / 超长字段）
  - 输入: 任务 3 接口；本地 dev server
  - 输出: 各场景响应码与数据库落库结果符合契约（200 写入、400 不写入）
  - Blocked-by: 任务 3

### 阶段 3: 前端工具（统一埋点入口）

**复杂度:** Medium

- [ ] 任务 5: 新建 `src/lib/usage-tracker.ts`
  - 输入: design 前端 API 设计（getOrCreateUserId / trackEvent / trackPageView / flushNow；队列 ≤10 条或 5s 触发；sendBeacon Blob 主路径 + fetch keepalive 兜底；失败静默丢弃）
  - 输出: 客户端埋点工具模块（localStorage key: `usage_user_id`；crypto.randomUUID；模块级队列与定时器）
  - Blocked-by: 任务 3（接口地址确定，实际调用点验证在任务 4 后）

- [ ] 任务 6: 新建 `src/components/RouteTracker.tsx`
  - 输入: usage-tracker.ts；usePathname 行为（首次挂载触发）
  - 输出: client 组件，useEffect 监听 pathname，调用 trackPageView()
  - Blocked-by: 任务 5

- [ ] 任务 7: 修改 `src/app/layout.tsx` 挂载 `<RouteTracker />`
  - 输入: 任务 6 组件
  - 输出: 根布局渲染 RouteTracker，全部页面自动 page_view 埋点
  - Blocked-by: 任务 6

### 阶段 4: UI 接入（各操作点埋点）

**复杂度:** Medium

- [ ] 任务 8: `use-drug-query.ts` 埋点
  - 输入: design 事件命名表（search_query / export_data）；handleSearch、handleExport 实现
  - 输出: handleSearch 成功后 trackEvent(search_query, detail=查询条件)；handleExport 成功后 trackEvent(export_data, detail=导出类型)；翻页不埋
  - Blocked-by: 任务 5

- [ ] 任务 9: `use-drug-module.ts` 埋点
  - 输入: design 事件命名表（scrape_trigger）
  - 输出: handleFetch 成功后 trackEvent(scrape_trigger, fetch_start, detail.source=模块数据源)
  - Blocked-by: 任务 5

- [ ] 任务 10: `use-scheduler.ts` 埋点
  - 输入: design 事件命名表（scrape_trigger / config_update）
  - 输出: updateSchedulerConfig 成功后 trackEvent(scrape_trigger, config_update, detail=变更内容)
  - Blocked-by: 任务 5

- [ ] 任务 11: `ledger/history/page.tsx` 埋点
  - 输入: design 事件命名表；该页 handleSearch、周导出、manual-trigger 实现（line 146 / 274 / 479 附近）
  - 输出: 查询成功埋 search_query；周导出成功埋 export_data(export_weekly)；manual-trigger 成功埋 scrape_trigger(snapshot_trigger)
  - Blocked-by: 任务 5

- [ ] 任务 12: `ledger/track/page.tsx` 埋点
  - 输入: design 事件命名表；该页 add/update（line 137）、delete（line 160）、import（line 210）实现
  - 输出: 新增/修改成功埋 ledger_operate(ledger_add / ledger_update)；删除成功埋 ledger_remove；批量导入成功埋 ledger_import（detail 含数量）
  - Blocked-by: 任务 5

### 阶段 5: 构建与验证

**复杂度:** Medium

- [ ] 任务 13: 类型检查 + lint + 生产构建
  - 输入: 全部改动；项目 scripts（首次用 `&&` 链探测命令）
  - 输出: `tsc` / `next lint` / `next build` 全通过
  - Blocked-by: 任务 2, 4, 7, 8, 9, 10, 11, 12

- [ ] 任务 14: 浏览器 E2E 验证（page_view 自动上报 + 操作埋点落库）
  - 输入: dev server；任务 13 通过
  - 输出: 访问各页面产生 page_view 记录；在 gz/merged 页执行搜索与导出后产生对应记录；ledger/track 增删后产生 ledger_operate 记录
  - Blocked-by: 任务 13

## 风险

| 风险 | 严重度 | 缓解 |
|------|--------|------|
| drizzle-kit push 对 TiDB 的 bigint autoincrement 语法兼容问题 | Medium | TiDB 兼容 MySQL AUTO_INCREMENT；push 后立即 SHOW CREATE TABLE 验证；失败则用原生 SQL 建表脚本兜底 |
| sendBeacon 对 Blob payload 的支持差异导致上报丢失 | Low | 使用标准 Blob(JSON, text/json) 用法；fetch keepalive 兜底；失败静默不阻塞业务 |
| 多个页面/组件埋点遗漏（ledger 页独立实现） | Medium | 任务 11/12 独立拆分，review 阶段对照 spec 需求 3-6 逐条核对 |
| 查询条件 detail 记录量过大（大关键词/多筛选字段） | Low | 服务端 4000 字符上限校验；前端只记录关键字段 |
| 埋点接口被批量刷数据 | Low | 单次 50 条上限 + 字段长度校验（design 决策 5） |

## E2E 验证规划

### Critical Path（必跑）

1. 清空 localStorage 访问首页 → 等待 6s → 数据库出现 `page_view` / `/` 记录，localStorage 出现 `usage_user_id`
2. 导航到 `/gz` → 数据库出现 `page_view` /gz 记录且 user_id 与首次一致
3. 在 `/gz` 输入关键词点击查询 → 数据库出现 `search_query` 记录（detail 含关键词）
4. 在 `/gz` 点击导出 Excel（有数据时）→ 数据库出现 `export_data` 记录
5. 在 `/ledger/track` 新增一条追踪药品 → 数据库出现 `ledger_operate`(ledger_add) 记录；删除后出现 ledger_remove
6. 在 `/ledger/history` 点击"手动生成快照" → 数据库出现 `scrape_trigger` 记录

### data-testid 表

无新增 UI 元素（埋点为隐式行为，不改变现有界面）。验证通过数据库记录 + 现有页面元素操作完成，不需要新增 testid。

### 6B 补充场景（接口级）

- curl 非法 body（缺 event_type / 超长字段 / 空数组）→ 400 且不落库
- curl 批量 3 条 → 200 且 count=3
- 断网（停 dev server）状态下执行查询 → 页面正常返回，无报错

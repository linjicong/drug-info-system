# Design: 用户功能使用埋点（Usage Tracking）

## Spec 引用

- 路径: `.specs/usage-tracking/spec.md`
- trace_id: `sc-20260818-595026a2`

## 方案概述

新增 `usage_events` 数据表 + 统一上报接口 `POST /api/track` + 前端客户端工具 `src/lib/usage-tracker.ts`。前端通过 localStorage 生成匿名用户 ID，在各功能操作点（搜索/导出/抓取/台账操作）成功后调用统一 API 上报；页面访问通过根布局内的路由监听组件自动上报。上报为异步批量 + sendBeacon，失败静默，对业务零侵入。仅入库，不提供统计页面。

## 架构设计

```
┌──────────────────────────── 前端（client） ───────────────────────────┐
│ 各页面/组件（gz / pubonln / merged / ledger/track / ledger/history）  │
│   │ 操作成功点调用                                                   │
│   ▼                                                                  │
│ src/lib/usage-tracker.ts (NEW)                                       │
│   ├─ getOrCreateUserId(): localStorage 读写匿名 UUID                 │
│   ├─ trackEvent(): 入内存队列（≤10条 或 5s 触发批量发送）             │
│   ├─ trackPageView(): 便捷方法（由 RouteTracker 组件调用）            │
│   └─ flush(): sendBeacon(JSON Blob) 主路径 / fetch keepalive 兜底    │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ POST /api/track（header: X-User-Id）
                               ▼
┌──────────────────────────── 服务端 ──────────────────────────────────┐
│ src/app/api/track/route.ts (NEW)  [force-dynamic]                    │
│   1. 校验 header X-User-Id（必填，≤64 字符）                          │
│   2. 解析 body（单对象或数组），逐条校验字段与长度                    │
│   3. 批量 insert 到 usage_events（drizzle db.insert().values()）      │
│   4. 返回 { success, count }                                         │
└──────────────────────────────┬───────────────────────────────────────┘
                               ▼
                    usage_events 表（TiDB）
```

### 组件职责

| 组件 | 状态 | 职责 |
|------|------|------|
| `src/storage/database/shared/schema.ts` | MOD | 新增 `usageEvents` 表定义 |
| `src/lib/usage-tracker.ts` | NEW | 前端埋点统一入口：ID 管理、事件缓冲、上报发送 |
| `src/components/RouteTracker.tsx` | NEW | client 组件，`usePathname()` 监听路由变化自动上报 page_view |
| `src/app/layout.tsx` | MOD | 挂载 `<RouteTracker />` |
| `src/app/api/track/route.ts` | NEW | 埋点上报接口（单条/批量） |
| `src/components/drug/hooks/use-drug-query.ts` | MOD | `handleSearch` 成功后埋 search_query；`handleExport` 成功后埋 export_data |
| `src/components/drug/hooks/use-drug-module.ts` | MOD | `handleFetch` 成功后埋 scrape_trigger(action=start) |
| `src/components/drug/hooks/use-scheduler.ts` | MOD | `updateSchedulerConfig` 成功后埋 scrape_trigger(action=config_update) |
| `src/app/ledger/history/page.tsx` | MOD | `handleSearch` 成功后埋 search_query；周导出成功后埋 export_data；manual-trigger 成功后埋 scrape_trigger |
| `src/app/ledger/track/page.tsx` | MOD | 新增/修改追踪药品成功后埋 ledger_operate(action=add/update)；删除成功埋 action=remove；批量导入成功埋 action=import |

### 数据流向

页面操作 → 业务 API 成功返回 → 埋点调用（同步无 await 或 fire-and-forget）→ 队列缓冲 → 批量上报 → TiDB 落库。

## 技术决策

### 决策 1: 用户识别方式
- 选项 A：localStorage 存 UUID（`crypto.randomUUID()`），通过请求 header `X-User-Id` 传递
- 选项 B：服务端按 IP 识别（spec 已排除，隐私问题）
- 选项 C：前端生成 ID 放 body（与事件数据耦合）
- **决定**：选项 A。UUID 用 `crypto.randomUUID()`（现代浏览器 + Electron 均支持），header 传递使 body 只含事件数据、批量结构干净。localStorage 清除导致 ID 重置属可接受误差（spec 风险表已声明）。

### 决策 2: 页面访问埋点实现
- 选项 A：根布局挂 `<RouteTracker />` client 组件，`usePathname()` + `useEffect` 上报（一处代码覆盖全部现有与未来页面）
- 选项 B：每个页面手动 `useEffect` 上报（6 个页面各写一遍，易遗漏）
- **决定**：选项 A。零侵入、覆盖完整。注意 `useEffect` 首次挂载也会触发上报，正好覆盖首次访问场景（spec 场景 1）。搜索参数变化不触发（usePathname 不含 query），避免查询词泄漏进 page_view。

### 决策 3: 上报传输方式
- 选项 A：`fetch(..., { keepalive: true })` 统一主路径（支持自定义 header、同源可靠、页面隐藏/卸载时尽力完成）
- 选项 B：`navigator.sendBeacon(url, Blob)` 主路径 + fetch keepalive 兜底
- 选项 C：仅 `fetch` POST（页面关闭瞬间可能丢失）
- **决定**：选项 A（build 阶段调整）。`navigator.sendBeacon` **无法携带自定义 header**（X-User-Id 必须经 header 传递，见决策 1），且无 fallback 到 header 的途径；fetch keepalive 在同源场景下同样具备页面卸载尽力发送的能力，且支持自定义 header。权衡后统一使用 fetch keepalive（Chrome 单请求体 ≤64KB 限制，前端单批上限 10 条 × 常规 detail < 1KB，远低于上限）。

### 决策 4: 事件表主键
- 选项 A：`bigint autoincrement`（写入频繁场景最轻量，TiDB 支持 AUTO_INCREMENT）
- 选项 B：`varchar(36) UUID`（与现有表一致，但每次插入多一次 UUID 生成）
- **决定**：选项 A。埋点表只写多读少，自增 ID 更紧凑高效；不需要跨库合并场景，UUID 无必要。

### 决策 5: 上报接口无鉴权
- 无备选。系统为公开访问站点，现有业务 API（查询/导出/抓取）均无鉴权；埋点数据非敏感。防滥用靠：批量上限 50 条/次 + 字段长度校验 + detail JSON 大小限制。与现有 API 安全水位保持一致（spec 风险表已声明）。

## 数据模型

### 新增表 `usage_events`

```ts
export const usageEvents = mysqlTable(
  "usage_events",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    // 匿名用户 ID（localStorage UUID，经 X-User-Id header 传递）
    user_id: varchar("user_id", { length: 64 }).notNull(),
    // 事件类型：page_view / search_query / export_data / scrape_trigger / ledger_operate
    event_type: varchar("event_type", { length: 30 }).notNull(),
    // 具体动作名，如：view_home / search_merged / export_excel / fetch_start / config_update / ledger_add
    event_name: varchar("event_name", { length: 100 }).notNull(),
    // 事件发生页面路径，如 /gz、/merged
    page_path: varchar("page_path", { length: 200 }).notNull(),
    // 附加信息 JSON 字符串（查询条件、数据源、动作类型等）
    detail: text("detail"),
    // 事件时间（服务端落库时间）
    created_at: datetime("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("idx_usage_events_event_type").on(table.event_type),
    index("idx_usage_events_created_at").on(table.created_at),
    index("idx_usage_events_user_id").on(table.user_id),
  ]
);
```

- 新增导入：`bigint` 需从 `drizzle-orm/mysql-core` 补充导入（现有 import 无 bigint）。
- 索引策略：按 spec 非功能需求支撑 `event_type` / `created_at` / `user_id` 三类查询；不为 `detail` 建索引（JSON 自由字段，SQL 分析用 `LIKE` 即可）。

### 迁移与回滚

- **迁移**：修改 `schema.ts` 后执行 `pnpm drizzle-kit push`（项目既有流程，TiDB 兼容 mysql dialect）。
- **回滚**：新表无历史数据，直接执行 `DROP TABLE usage_events` 即可；前端移除埋点调用、删除 `usage-tracker.ts` / `RouteTracker.tsx` / `route.ts` 即完全回滚，无数据迁移风险。

## 接口契约

### `POST /api/track`

**请求**（Content-Type: application/json）：

```
Header: X-User-Id: <匿名 UUID，必填，≤64 字符>
Body（单条或批量数组，二选一）：
  { "event_type": "search_query", "event_name": "search_merged", "page_path": "/merged", "detail": { "keyword": "阿莫西林", "page": 1 } }
  或
  [ { ...同上... }, { ...同上... } ]
```

字段校验规则：

| 字段 | 必填 | 约束 |
|------|------|------|
| `event_type` | 是 | ∈ { page_view, search_query, export_data, scrape_trigger, ledger_operate } |
| `event_name` | 是 | 字符串，≤100 字符 |
| `page_path` | 是 | 字符串，≤200 字符，须以 `/` 开头 |
| `detail` | 否 | 对象，JSON 序列化后 ≤4000 字符 |

**响应**：

- `200`：`{ "success": true, "count": 3 }`（count 为实际写入条数）
- `400`：`{ "error": "<具体原因>" }` — 非法 JSON / X-User-Id 缺失或超长 / event_type 非法 / 字段缺失或超长 / 批量超过 50 条 / detail 超长
- `405`：非 POST 方法（复用 `createModuleRoute` 或直接导出 POST 方法）

**行为约定**：

- 单条对象与数组统一归一化处理；空数组返回 400。
- 写入使用单次 `db.insert().values(rows)` 批量插入。
- 服务端不做用户维度的频率限制（spec 范围外），但批量上限与长度校验防止明显滥用。

### 前端 API（`src/lib/usage-tracker.ts`，client-only）

```ts
getOrCreateUserId(): string                       // localStorage 读/生成 UUID（key: usage_user_id）
trackEvent(e: { event_type: UsageEventType; event_name: string; page_path: string; detail?: Record<string, unknown> }): void
trackPageView(): void                             // 取 window.location.pathname 上报 page_view
flushNow(): void                                  // 立即发送缓冲队列（fetch keepalive）
```

- 模块内部维护 `pending: UsageEvent[]` 队列与 5s 定时器；队列 ≥10 条或定时器到期触发发送。
- 发送失败（fetch 非 2xx / 网络异常）**静默丢弃**（仅 console.warn），不重试、不抛错（spec 需求 8）。
- `trackPageView` 由 `RouteTracker` 调用；不依赖 React 上下文，页面组件可直接调用。
- 页面 `visibilitychange` 至 hidden 时主动 flush，覆盖切后台/关闭场景。

### 埋点事件命名规范（event_type / event_name / detail）

| 场景 | event_type | event_name | detail 内容 |
|------|-----------|------------|-------------|
| 页面访问 | `page_view` | `view_<页面>` | 无（path 在 page_path） |
| 查询搜索 | `search_query` | `search_gz` / `search_pubonln` / `search_merged` / `search_ledger_history` | 查询条件（关键词、筛选字段、页码=1） |
| 导出 | `export_data` | `export_excel` / `export_weekly` / `download_template` | 来源页 + 导出类型 |
| 抓取/同步触发 | `scrape_trigger` | `fetch_start` / `sync_start` / `config_update` / `snapshot_trigger` | source（gz_drug 等）、action、配置变更内容 |
| 台账操作 | `ledger_operate` | `ledger_add` / `ledger_update` / `ledger_remove` / `ledger_import` | 动作 + 数量（批量导入条数） |

## 安全与性能考量

- **输入校验**：所有字段在服务端独立校验（不信任前端），长度上限防注入与滥用；detail 仅存 JSON 字符串，不解析执行。
- **隐私**：不记录 IP / UA / Cookie；header 仅传递匿名 UUID，服务端日志默认不打印 body。
- **性能**：前端批量缓冲（≤10 条/5s 周期）将上报频率压到每用户每分钟数次量级；单请求 50 条上限控制单次写入体积；批量 insert 单语句完成。
- **对业务零侵入**：埋点调用全部 fire-and-forget（不 await），业务函数 try 块不包含埋点，埋点自身 try/catch 包裹（sendBeacon/fetch 异常静默吞掉）。
- **失败容忍**：网络错误 / 接口 5xx / sendBeacon 返回 false → 丢弃当前批次，不阻塞、不重试堆积。

## 范围外（设计层面不解决的）

- 不设计统计/报表页（spec 范围外）。
- 不做数据清理/归档任务（spec 范围外）。
- 不做采样率/灰度控制；不记录 IP 等识别数据（spec 范围外）。
- 埋点接入不覆盖未来新增页面（RouteTracker 自动覆盖页面访问；操作类埋点需新页面接入时手动补调用——由 review 检查清单提醒）。
- 不引入第三方埋点 SDK / 分析平台。

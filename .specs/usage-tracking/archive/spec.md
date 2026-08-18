# Spec: 用户功能使用埋点（Usage Tracking）

- **feature-id**: `usage-tracking`
- **trace_id**: `sc-20260818-595026a2`
- **flow_type**: standard
- **日期**: 2026-08-18
- **入口**: zy-spec（探索模式，无 Jira / 蓝湖）

## 问题陈述（Problem）

系统目前没有任何用户行为记录能力：不知道哪些功能（广州/广东/汇总查询/台账）被使用、使用频率如何、导出和抓取等关键操作发生过多少次。由于缺乏使用数据，无法判断功能价值、发现低使用率模块、评估运维操作频率。

不改的后果：所有功能决策只能靠猜测；无法量化各数据源查询/导出/抓取的热度；无法为后续优化（如低频功能下线、高频功能增强）提供依据。

## 需求（Requirements）

### 功能性需求

1. **匿名用户识别**
   - 描述：浏览器首次访问时在 localStorage 生成全局唯一匿名 ID（UUID），后续所有埋点上报携带该 ID，用于去重统计独立用户。
   - 可测试标准：首次访问页面后 localStorage 存在 `usage_user_id`，且为合法 UUID；刷新后 ID 不变。

2. **页面访问埋点**
   - 描述：记录用户访问各功能页面（首页 `/`、广州 `/gz`、广东 `/pubonln`、汇总 `/merged`、台账追踪 `/ledger/track`、台账历史 `/ledger/history`）的行为，记录页面路径。
   - 可测试标准：访问上述任一页面后，数据库新增一条 `event_type=page_view` 的记录，`page_path` 与访问路径一致，`user_id` 为当前浏览器匿名 ID。

3. **查询搜索埋点**
   - 描述：记录用户在任意查询页（gz / pubonln / merged / ledger/history）执行筛选/搜索查询的行为，附带查询条件概要（分页、关键词、筛选字段值）。
   - 可测试标准：在查询页执行一次搜索后，数据库新增一条 `event_type=search_query` 记录，`detail` 中包含本次查询条件；翻页不重复计数。

4. **数据导出埋点**
   - 描述：记录 Excel 导出、模板下载等数据导出行为，记录导出类型（如 `excel`、`template`）与所在页面。
   - 可测试标准：点击任一页面导出按钮且导出成功后，数据库新增一条 `event_type=export_data` 记录，`detail` 含导出类型与页面对应来源。

5. **抓取与同步埋点**
   - 描述：记录用户手动触发抓取/合并同步、更新调度器配置（启用/停用/改间隔）等运维操作，记录数据源（gz_drug / gd_pubonln / merged_drug / ledger）与动作。
   - 可测试标准：手动触发一次抓取后，数据库新增一条 `event_type=scrape_trigger` 记录，`detail` 含数据源与动作类型。

6. **台账操作埋点**
   - 描述：记录台账追踪药品的添加、删除、模板导入、查看台账详情等操作。
   - 可测试标准：在台账追踪页添加一条追踪药品后，数据库新增一条 `event_type=ledger_operate` 记录，`detail` 含操作动作（add / remove / import / view）。

7. **埋点上报接口**
   - 描述：提供统一的上报 API `POST /api/track`，接收单条或批量事件（数组），异步落库；对前端上报失败静默处理，不影响业务功能。
   - 可测试标准：
     - 以合法 JSON 调用接口，返回 200 `{success:true}`，数据库出现对应记录；
     - 批量数组调用一次写入多条记录；
     - 非法 JSON / 缺少必填字段返回 4xx，不写入数据。

8. **埋点对业务零侵入**
   - 描述：埋点上报失败（网络错误、接口 5xx）时，不得抛出影响用户当前操作流程的异常；埋点逻辑不改变任何业务接口的返回数据。
   - 可测试标准：断网状态下执行查询/导出，业务功能正常完成，页面无报错提示。

### 非功能性需求

- **性能**：上报接口为异步写入，单条写入对业务接口无额外延迟；前端上报不阻塞主流程（使用 `navigator.sendBeacon` / 空闲批量发送）。
- **安全**：不记录 IP、Cookie、任何个人身份信息；匿名 ID 仅为随机 UUID，不可反查用户。
- **可维护性**：事件类型与字段集中定义（常量枚举），新增埋点无需改表结构（`detail` 为 JSON 自由字段）。
- **数据量**：埋点表只增不删（永久保留，用户确认），表设计需带索引支撑按 `event_type` / `created_at` / `user_id` 查询。

## 约束（Constraints）

### 技术约束

- 数据库为 TiDB（drizzle-orm mysql dialect），schema 定义在 `src/storage/database/shared/schema.ts`，建表走 `pnpm drizzle-kit push`。
- 项目为 Next.js 16 App Router + React 19，前端组件在 `src/components/`，工具库在 `src/lib/`。
- datetime 列（date 模式）必须传 `Date` 对象（drizzle 驱动层调 `toISOString()`，传字符串会抛错），遵循现有代码约定。
- 埋点表字段名遵循现有 snake_case 风格。
- 服务端上报接口应复用 `withDbRetry` 容错模式（如适用）。

### 业务约束

- 用户已确认：不提供统计查看页面，数据仅入库，后续用 SQL 分析。
- 用户已确认：数据永久保留，不做自动清理。
- 用户已确认：匿名 ID 方案（localStorage），不使用 IP 识别。

## 验收标准（Acceptance Criteria）

### 场景 1：首次访问生成匿名 ID
- **Given** 浏览器无任何本系统 localStorage 数据，访问首页 `/`
- **When** 页面加载完成
- **Then** localStorage 中出现 `usage_user_id` 且为合法 UUID，并成功上报一条 `page_view` 记录（page_path=`/`）

### 场景 2：匿名 ID 复用
- **Given** 浏览器已存在 `usage_user_id=U1`
- **When** 刷新页面或跳转到 `/gz`
- **Then** 后续所有上报记录 `user_id` 均为 U1，无新 ID 生成

### 场景 3：查询与导出埋点
- **Given** 用户在 `/merged` 页面输入关键词并点击查询
- **When** 查询结果返回后点击"导出 Excel"
- **Then** 数据库分别新增 `search_query` 与 `export_data` 两条记录，`detail` 分别包含查询条件与导出类型，`page_path` 均为 `/merged`

### 场景 4：抓取触发埋点
- **Given** 用户在 `/gz` 页面点击"立即抓取"
- **When** 抓取任务成功入队（接口返回 200）
- **Then** 数据库新增一条 `scrape_trigger` 记录，`detail.source= gz_drug`，`detail.action=start`

### 场景 5：批量上报
- **Given** 前端一次性提交 3 条事件数组 `[{...},{...},{...}]`
- **When** 调用 `POST /api/track`
- **Then** 返回 200，数据库新增 3 条记录

### 场景 6：非法上报被拒绝
- **Given** 请求体为非法 JSON，或 `event_type` 不在枚举内
- **When** 调用 `POST /api/track`
- **Then** 返回 400/422，数据库无新增记录

### 场景 7：上报失败不影响业务
- **Given** 网络断开（埋点接口不可达）
- **When** 用户执行一次查询
- **Then** 查询正常完成返回数据，页面无报错提示

## 范围外（Out of Scope）

- 不提供埋点统计/报表页面（用户确认仅入库）。
- 不做数据自动清理/归档（用户确认永久保留）。
- 不记录 IP 地址、User-Agent、Cookie、设备信息等个人识别数据。
- 不改动现有业务 API 的请求/响应结构（只新增独立上报接口）。
- 不做灰度/采样率控制（所有访问全量记录）。
- 不接入第三方分析平台（GA / 腾讯分析等），全部自建。
- 不记录服务端定时任务（Cron/runner）自身的执行作为"用户行为"（已有 scrape_log 覆盖）。

## 复杂度阈值声明

命中：数据库 Schema 变更、API 接口变更、跨模块改动（lib + api + 多个页面组件）。技术方案与回滚方案在 design 阶段产出（见 `.specs/usage-tracking/design.md`）。

## 依赖（Dependencies）

- 上游：`src/storage/database/shared/schema.ts`（新增 `usage_events` 表）；`drizzle.config.ts` 已指向该 schema，`pnpm drizzle-kit push` 同步 TiDB。
- 下游：新增 `src/lib/usage-tracker.ts`（前端工具）、`src/app/api/track/route.ts`（上报接口）、各页面/组件接入埋点调用。
- 无外部服务依赖。

## 风险与假设（Risks & Assumptions）

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 埋点数据量持续增长（永久保留） | 高 | 表膨胀、查询变慢 | 按 event_type/created_at 建索引；仅入库不统计页，查询压力小 |
| sendBeacon 在部分浏览器对 JSON 支持差异 | 低 | 上报丢失 | 使用 Blob 类型 payload（sendBeacon 标准用法），fallback fetch keepalive |
| 批量上报接口被滥用（刷数据） | 中 | 数据失真、资源消耗 | 接口限单次批量上限（如 50 条），字段长度校验 |
| 页面组件多，埋点遗漏 | 中 | 覆盖不全 | 集中在 `usage-tracker.ts` 提供统一 API，逐页面接入时 review 检查清单 |
| 匿名 ID 被用户清除 localStorage | 低 | 同一用户被计为多用户 | 属可接受误差（行业惯例），spec 明确该限制 |

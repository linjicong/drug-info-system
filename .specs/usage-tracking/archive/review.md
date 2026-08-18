# Code Review: 用户功能使用埋点（usage-tracking）

## 概要
- 审查文件数: 10（schema.ts / track/route.ts / usage-tracker.ts / RouteTracker.tsx / layout.tsx / use-drug-query.ts / use-drug-module.ts / use-scheduler.ts / ledger/history / ledger/track / create-usage-events-table.ts）
- 发现问题: 2 (CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 2)
- 命中维度: 正确性 / 可读性 / 架构 / 安全 / 性能 / Spec 合规
- 结论: **PASS**

## 问题列表

### CRITICAL
（无）

### HIGH
（无）

### MEDIUM
（无）

### LOW

| # | 维度 | 文件 | 行 | 备注 |
|---|------|------|-----|------|
| 1 | 可维护性 | use-drug-module.ts:56 | `isSyncAction = fetchApi.includes('/sync')` 当前无触发路径（useDrugModule 仅 gz/pubonln 使用，fetchApi 均不含 `/sync`）。属防御性设计，保留即可；若未来 merged 引入同步入口需复用该模式 |
| 2 | 可维护性 | use-drug-query.ts:42-43 | `modulePath/moduleKey` 由 drugsApi 格式约定（`/api/<module>`）推导，已注释说明；若未来出现带子路径的模块（如 `/api/merged/drugs`）需同步调整推导或改显式传参 |

## Spec 合规

| 需求 | 实现位置 | 测试/验证位置 | 状态 |
|------|---------|--------------|------|
| 1. 匿名用户识别 | src/lib/usage-tracker.ts:48 getOrCreateUserId | E2E 场景 1/2（UUID 生成、刷新复用） | ✓ 已覆盖 |
| 2. 页面访问埋点 | src/components/RouteTracker.tsx + layout.tsx:56 | E2E 4 页面 page_view 落库（view_home/gz/ledger_history/ledger_track） | ✓ 已覆盖 |
| 3. 查询搜索埋点 | use-drug-query.ts:149、ledger/history/page.tsx:152 | 接口 7 场景 curl + 代码审查 | ✓ 已覆盖 |
| 4. 数据导出埋点 | use-drug-query.ts:130、ledger/history:235/484、ledger/track:270 | 同上 | ✓ 已覆盖 |
| 5. 抓取与同步埋点 | use-drug-module.ts:123、use-scheduler.ts:124、ledger/history:511 | 同上 | ✓ 已覆盖 |
| 6. 台账操作埋点 | ledger/track:151/173/237/270 | 同上 | ✓ 已覆盖（spec 提及的 view 动作——页面无"查看详情"功能，不适用） |
| 7. 埋点上报接口 | src/app/api/track/route.ts | 任务 4：单条/批量/非法 JSON/缺 header/非法 event_type/超长 detail/超长 user_id 共 7 场景 | ✓ 已覆盖 |
| 8. 对业务零侵入 | usage-tracker.ts 队列 + 失败静默 + fire-and-forget | E2E 浏览器无 console error；埋点在业务 try/catch 外 | ✓ 已覆盖 |

## 测试覆盖

| 测试类型 | 状态 | 备注 |
|----------|------|------|
| 正常路径 | ✓ | curl 单条/批量 + E2E 页面访问全链路 |
| 错误路径 | ✓ | 非法 JSON / 缺 header / 非法 event_type / 批量超限校验 |
| 边界情况 | ✓ | 超长 detail（>4000）/ 超长 user_id（>64）/ 首次访问 / 跨页 ID 复用 |

## What's done well
- 埋点全部挂在操作**成功点**且位于业务 try/catch 之外（fire-and-forget），上报失败不影响业务流，需求 8 的实现方式干净利落。
- TiDB 建表坑（drizzle 驱动下列内 KEY 不生效）用 `CREATE INDEX IF NOT EXISTS` 幂等方案解决，并把背景与绕行原因完整记录在脚本头注释，后人不会再踩。
- sendBeacon 无法携带自定义 header 的架构偏差，在 build 阶段发现后立即回写 design.md 决策 3 留痕，spec/design/实现三处一致。
- 接口 7 场景 curl 验证覆盖了校验边界（长度/枚举/批量），E2E 验证了匿名 ID 生命周期（首次生成 → 跨页复用），证据链完整。

## 建议人工跟进（可选）
- 既有 lint 债务 17 项（no-explicit-any / no-assign-module-variable 等，分布在 ledger-service.ts、gz/pubonln/page.tsx 等非本次改动文件），已确认非本次改动引入（git diff 本次仅 87 行纯新增）。建议单独建 issue 清理，避免后续每次构建的 lint 噪音。
- /api/track 为无鉴权公开接口，spec 风险表已通过单次批量上限（50 条）与字段长度校验缓解刷量；若未来部署公网域名，可考虑加简单限流。

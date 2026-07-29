# Spec — API 路由按页面合并（api-route-merge）

- **Trace ID**: sc-20260728-4e480e24
- **flow_type**: lightweight（延续 refactor-extract-duplicates 的收尾优化，方案已经用户两轮确认）
- **需求来源**: 用户口头（zy-spec 入口）

## 需求

`src/app/api` 下 22 个 route.ts 文件太多，合并为"每个页面一个"。用户已确认：
1. 采用**重设计 URL** 方案（optional catch-all 路由，一页一文件）
2. ledger 模块一并合并

## 约束

- `/api/cron/trigger` 与 `/api/heartbeat` 为**外部契约**（GitHub Actions cron / vercel.json / 部署健康检查），路径与行为不动
- 除 URL 前缀变化外，各端点的响应 JSON 形状、状态码（400/401/404/405/409/500）、缓存头、Excel 文件名规则**保持不变**
- ledger 系列 URL 实际不变（原本就在 `/api/ledger/*` 下，catch-all 覆盖同路径）
- 前端调用点同步更新（gz/pubonln/merged 三个 page.tsx；ledger 两页无需改）

## URL 映射（GWT 摘要）

| 旧 URL | 新 URL | 方法 |
|--------|--------|------|
| /api/drugs | /api/gz | GET |
| /api/drugs/export | /api/gz/export | GET |
| /api/drugs/fetch | /api/gz/fetch | POST |
| /api/drugs/progress | /api/gz/progress | GET/DELETE（POST 405）|
| /api/scheduler | /api/gz/scheduler | GET/POST |
| /api/pubonln/drugs[...] | /api/pubonln[...] | 同 gz（progress 无自带 POST）|
| /api/pubonln/scheduler | /api/pubonln/scheduler | GET/POST |
| /api/merged/drugs | /api/merged | GET |
| /api/merged/drugs/export | /api/merged/export | GET |
| /api/merged/drugs/scheduler | /api/merged/scheduler | GET/POST |
| /api/merged/drugs/sync | /api/merged/sync | POST |
| /api/merged/drugs/sync/progress | /api/merged/sync/progress | GET/DELETE（POST 405）|
| /api/ledger/*（5 条）| 不变 | 不变 |

- Given 任意新 URL + 原查询参数，When 请求，Then 响应与旧端点逐字段一致
- Given 模块下未知子路径，When 请求，Then 404 `{ error: '接口不存在' }`
- Given 已知子路径 + 不支持的方法，When 请求，Then 405

## 设计与任务（plan 合并记录）

1. `src/lib/api/module-route.ts` — `createModuleRoute(分发表)`：按 `[[...action]]` join('/') 查表分发，404/405 兜底，导出 GET/POST/PUT/DELETE
2. 4 个 catch-all 路由：`api/{gz,pubonln,merged,ledger}/[[...action]]/route.ts`，逻辑从旧 route.ts 原样搬迁（merged scheduler 保留内联实现与"定时同步"文案；ledger 各 handler 原样搬迁）
3. 删除 20 个旧 route.ts（保留 cron/trigger、heartbeat）
4. 前端 3 个 page.tsx 更新 URL 常量
5. 验证：tsc + vitest + build + 四页面手动回归；单独 commit

## 风险

- catch-all 与旧静态路由共存会路由冲突 → 同一 commit 内删旧建新
- 405 提示文案由分发器统一生成，与个别旧端点的文案略有差异（语义一致，可接受）

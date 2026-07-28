# Verification: 部署到腾讯云 CloudBase 云托管

- feature-id: `deploy-cloudbase` | trace_id: `sc-20260728-7ae25420`
- flow_type: standard | scope: 部署基建配置

## 六级验证

### Level 1: 静态检查 — ✅ PASS
- `pnpm ts-check`（tsc）：**PASS**，无类型错误。
- workflow YAML：`yaml.safe_load` 校验 **PASS**。
- `pnpm lint`：存在 17 error / 18 warning，**全部位于存量业务文件**（`src/lib/*`、`src/app/*/page.tsx`、`scripts/*`）与 spec-coding 脚手架，**无一处在本次改动文件**（`next.config.ts` / `.env.example` / `Dockerfile` / workflow）。判定：本次变更未引入 lint 问题；存量问题不在本 feature 范围内。

### Level 2: 单元测试 — N/A
- 本 feature 为部署配置（无业务逻辑函数），无单元可测点。项目现有 vitest 用例不受影响（未改任何 `src/**`）。

### Level 3: 构建 — ✅ PASS（核心验收）
- `pnpm build`：**成功**，29 条路由全部编译（22 个 API 动态路由 + 7 个页面）。
- 产物核验：
  - `.next/standalone/server.js` ✅ 存在
  - `.next/standalone/node_modules` ✅ 存在（精简依赖）
  - `.next/static` ✅ 存在
  - `public` ✅ 存在
- 对应 spec 验收标准 1：**满足**。

### Level 4: 集成 — ⚠️ 运行时验证（本机无 Docker，指导人工/CI 执行）
- `docker` CLI 本机不可用（`command not found`）。
- Dockerfile 已静态核验：三阶段结构、显式 COPY static+public、HOSTNAME/PORT、非 root 用户均正确。
- 待部署环境执行（命令见 `DEPLOY-CLOUDBASE.md`）：
  - `docker build -t drug-info-system .` → 应成功
  - `docker run -e DATABASE_URL=... -p 3000:3000` → `curl localhost:3000` 返回 200（验收标准 2）
  - `curl localhost:3000/api/heartbeat` → `success: true`（验收标准 3，验证 TiDB 连通）
- 判定：本机不具备条件，非代码缺陷；已提供可复现命令与排查表。

### Level 5: 边界 — ✅ 已覆盖（设计/文档层面）
- 无 `DATABASE_URL`：`db.ts` 懒初始化，构建不失败，运行时首次访问抛明确错误（文档已列排查）。
- 静态资源缺失场景：Dockerfile 显式 COPY 已防护（HIGH 风险闭环）。
- cron secret 不匹配：接口返回 401（文档排查表已列）。
- cron→source 映射兜底：非预期 schedule 走 `workflow_dispatch` input。

### Level 6: E2E — N/A
- 部署基建配置，无新增 UI 交互入口（plan 已声明 SKIP，理由成立）。应用页面功能未改动，沿用现有回归。

## 验收标准对照

| # | 标准 | 结果 |
|---|------|------|
| 1 | standalone 产出可独立启动 server.js | ✅ PASS（Level 3） |
| 2 | 容器监听 $PORT 首页 200 | ⚠️ 运行时验证（无本机 Docker） |
| 3 | 配 DATABASE_URL 后 API 连通 TiDB | ⚠️ 运行时验证 |
| 4 | GitHub Actions cron 触发 200 | ⚠️ 部署后验证（需公网域名） |
| 5 | .dockerignore 排除无关内容 | ✅ PASS（静态核验） |

## 结论

- 可静态/构建验证的项目（Level 1/3/5 + 标准 1、5）**全部 PASS**。
- 运行时项目（Level 4 + 标准 2/3/4）因本机无 Docker 环境、且需部署后公网域名，标注为**部署时人工/CI 验证**，已提供完整可复现命令（`DEPLOY-CLOUDBASE.md`）。此为环境限制，非代码缺陷。
- **无 FAIL 项**，可进入 `/zy-ship`。

# Spec: 部署到腾讯云 CloudBase 云托管

- **feature-id**: `deploy-cloudbase`
- **trace_id**: `sc-20260728-7ae25420`
- **flow_type**: standard
- **分支**: `master-cloudbase`（基于 `master-vercel`）
- **日期**: 2026-07-28

## 问题陈述（Problem）

项目当前部署在 Vercel（分支 `master-vercel`）。尝试用 **CloudBase 静态网站托管** 部署后访问返回 **404**。

根因：本项目是**全栈 Next.js 16 应用**，不是纯静态站点：

- `src/app/api/` 下有 22 个 `route.ts`（药品抓取、导出、调度器、心跳、Cron 触发等），是服务端代码，必须运行在 Node 运行时。
- 通过 `@tidbcloud/serverless` + `drizzle-orm` 直连 TiDB，页面为动态 SSR。
- `next.config.ts` 未配置静态导出，`next build` 产出的是 `.next/` 服务端构建产物，没有可托管的静态 HTML。

静态网站托管仅为 CDN + 对象存储，只能返回预生成静态文件，找不到对应文件即返回 404。

## 目标（Who / Why / Success）

- **Who**: 项目维护者（部署与运维）。
- **Why**: 让全栈 Next.js 应用在腾讯云 CloudBase **云托管（容器服务）** 上正常运行，页面与 API 均可访问。
- **Success（可测试的验收标准）**:
  1. **GIVEN** 项目开启 Next `standalone` 输出，**WHEN** 执行 `next build`，**THEN** 生成 `.next/standalone/server.js` 可独立启动。
  2. **GIVEN** 提供 `Dockerfile`，**WHEN** 构建镜像并以 `PORT` 环境变量启动容器，**THEN** 容器监听 `0.0.0.0:$PORT` 且首页返回 200。
  3. **GIVEN** 容器内配置了 `DATABASE_URL`，**WHEN** 访问 `/api/heartbeat` 或首页数据接口，**THEN** 能连上 TiDB 并返回数据（非 500）。
  4. **GIVEN** 部署得到公网域名，**WHEN** GitHub Actions 定时以 `Authorization: Bearer $CRON_SECRET` GET 调用 `/api/cron/trigger?source=<src>`，**THEN** 返回 200 且任务被触发/合理跳过。
  5. **GIVEN** `.dockerignore` 存在，**WHEN** 构建镜像，**THEN** 不包含 `node_modules`、`.git`、`.specs`、`.claude`、`docs` 等无关内容。

## 范围内（In Scope）

- 修改 `next.config.ts`：加 `output: 'standalone'`。
- 新增 `Dockerfile`（多阶段，pnpm + Node 20 Alpine）。
- 新增 `.dockerignore`。
- 新增 GitHub Actions workflow：定时调用 4 个 Cron 触发接口替代 Vercel Cron。
- 补充 `.env.example` / 部署说明文档：CloudBase 云托管环境变量与定时任务配置清单。

## 范围外（Out of Scope）

- 不改任何业务逻辑、API 行为、数据库 schema。
- 不删除 `vercel.json`，保留 Vercel 兼容（两边均可部署）。
- 不做 CloudBase 控制台的实际点击操作（需人工在控制台完成镜像/服务/环境变量/域名配置）。
- 不涉及静态托管方案（已确认不可行）。
- 迁移脚本（`scripts/migrate-*`）不打入运行镜像。

## 关键约束（Constraints）

- 运行时依赖 `DATABASE_URL`（TiDB 连接串）、`CRON_SECRET`；`db.ts` 已做懒初始化，构建期无需 `DATABASE_URL`。
- CloudBase 云托管通过 `PORT` 环境变量注入监听端口，容器须监听 `0.0.0.0`。
- 包管理器锁定 pnpm 9（`preinstall` 用 only-allow 强制），镜像内需启用 corepack。
- Node 版本对齐 Next 16 要求（Node ≥ 20）。

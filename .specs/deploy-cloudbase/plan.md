# Plan: 部署到腾讯云 CloudBase 云托管

## Spec 引用
- 路径: `.specs/deploy-cloudbase/spec.md`

## Design 引用
- 路径: `.specs/deploy-cloudbase/design.md`

## 代码库上下文

### 现有模式
- `next.config.ts:1-7` —— 当前为空配置（仅类型注解），直接加字段即可。
- `db.ts:24-30` —— Proxy 懒初始化，构建期不读 `DATABASE_URL`，Dockerfile builder 阶段无需提供该变量。
- `api-config.ts:33-51` —— 抓取 API 均有 hardcode 默认值，`PUBONLN_API_URL` 等环境变量可选，容器不配也能跑。
- `cron/trigger/route.ts:19,50` —— 鉴权支持 `Authorization: Bearer` 与 `?secret=` 双通道。

### 依赖图谱
- 包管理：`pnpm@9.0.0`（`packageManager` 锁定），锁文件 `pnpm-lock.yaml` 存在，有 `.npmrc`，**无** workspace。
- 运行时：`@tidbcloud/serverless` 走 HTTP，无原生模块编译需求 → alpine 安全。
- `engines.pnpm >=9`，无 `node` 约束；Next 16 要求 Node ≥ 20。

### 约定与风格
- `.npmrc` 需一并 COPY 进镜像（可能含 pnpm 配置影响 install 行为）。
- `preinstall: npx only-allow pnpm` —— 用 pnpm 安装可通过，用 npm 会被拒。

### 边界约束
- 不改任何 `src/**` 业务代码。
- `vercel.json` 保留不动。
- 迁移脚本 `scripts/migrate-*`、`inspect-*`、`drop-*` 不进运行镜像。

### 技术栈规范
- 已加载认知：`references/nodejs-patterns.md`（Node/pnpm 容器化）。Dockerfile 遵循 Next 官方 standalone 示例。

## 阶段

### 阶段 1: 构建输出配置（前置，其余全部依赖它）
**复杂度:** Low
- [ ] T1: 修改 `next.config.ts` 增加 `output: 'standalone'`
  - 输入: `next.config.ts`
  - 输出: `next build` 产出 `.next/standalone/server.js`
  - 验证: `pnpm build` 后存在 `.next/standalone/server.js` 与 `.next/static/`
  - Blocked-by: 无

### 阶段 2: 容器化
**复杂度:** Medium
- [ ] T2: 新建 `.dockerignore`
  - 输入: 无
  - 输出: `.dockerignore`，排除 `node_modules` `.next` `.git` `.specs` `.claude` `.spec-coding` `docs` `.env*` `scripts` 等
  - 验证: 内容覆盖设计清单
  - Blocked-by: 无
- [ ] T3: 新建 `Dockerfile`（三阶段 deps→builder→runner）
  - 输入: `package.json` `pnpm-lock.yaml` `.npmrc`，design.md 层级设计
  - 输出: `Dockerfile`
  - 关键: builder 后显式 COPY `public/` 与 `.next/static/`；runner 设 `HOSTNAME=0.0.0.0` `PORT=3000`；非 root 用户
  - 验证: `docker build` 成功；`docker run -e DATABASE_URL=... -p 3000:3000` 后 `curl localhost:3000` 返回 200
  - Blocked-by: T1, T2

### 阶段 3: 定时任务迁移
**复杂度:** Low
- [ ] T4: 新建 `.github/workflows/cloudbase-cron.yml`
  - 输入: design.md 的 cron 映射表（UTC，与 vercel.json 一致）
  - 输出: workflow，含 4 个 `schedule` + 手动 `workflow_dispatch`，用 `secrets.DEPLOY_URL` + `secrets.CRON_SECRET` curl 调用
  - 验证: YAML 语法正确；4 条 cron 与 vercel.json 时间一致；带 `Authorization: Bearer`
  - Blocked-by: 无

### 阶段 4: 文档
**复杂度:** Low
- [ ] T5: 新建 `DEPLOY-CLOUDBASE.md` 部署操作手册
  - 输入: 全部设计
  - 输出: 含镜像构建、CloudBase 控制台配置步骤、环境变量清单、GitHub Secrets 配置、定时任务、404 排查
  - 验证: 步骤可照做，覆盖 `DATABASE_URL` `CRON_SECRET` `PORT` `HOSTNAME`
  - Blocked-by: T3, T4
- [ ] T6: 补充 `.env.example` 云托管说明
  - 输入: 现有 `.env.example`
  - 输出: 追加云托管环境变量段（不破坏 Vercel 段）
  - 验证: 保留原有内容，新增段落清晰
  - Blocked-by: 无

## 依赖 DAG

```
T1 ─┐
T2 ─┼─▶ T3 ─┐
            ├─▶ T5
T4 ─────────┘
T6（独立）
```
无环，有效 DAG。

## 风险

| 风险 | 严重度 | 缓解 |
|------|--------|------|
| standalone 漏 COPY `public`/`.next/static` 导致静态资源 404 | HIGH | Dockerfile 显式两条 COPY；验证时检查页面样式与 favicon |
| 忘设 `HOSTNAME=0.0.0.0`，容器外访问不到 | HIGH | runner 阶段 ENV 固定；design 已标注 |
| alpine 缺原生库导致某依赖运行失败 | MEDIUM | 本项目纯 JS 无原生模块；若失败回退 node:20-slim |
| GitHub Actions cron 时区误解（当作本地时区） | MEDIUM | 明确 GH Actions 为 UTC，且 vercel 本就 UTC，直接沿用；文档标注 |
| 本地无 Docker 环境无法验证镜像 | MEDIUM | 提供 `pnpm build` 静态验证 standalone 产物；docker 验证在 verify 阶段标注为需人工/CI |
| `.dockerignore` 误排除必要文件（如 `public`） | MEDIUM | 用白名单思路核对，构建后 `curl` 静态资源 |

## E2E 验证规划

**SKIP**：本 feature 为部署基建配置（构建输出、Dockerfile、CI workflow、文档），无新增 UI 与浏览器交互入口。

验证策略：
- Level 1（静态）：`next.config.ts` / YAML / Dockerfile 语法检查，`pnpm ts-check` / `pnpm lint`。
- Level 3（构建）：`pnpm build` 成功且产出 `.next/standalone/server.js` —— 核心验收。
- Level 4（集成）：`docker build` + `docker run` 后 `curl` 首页与 `/api/heartbeat`（需 Docker 环境；无则标注人工/CI 验证并说明）。
- 应用本身功能不变，沿用现有回归。

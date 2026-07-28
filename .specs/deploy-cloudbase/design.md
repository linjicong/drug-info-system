# Design: 部署到腾讯云 CloudBase 云托管

## Spec 引用
- 路径: `.specs/deploy-cloudbase/spec.md`
- feature-id: `deploy-cloudbase` | trace_id: `sc-20260728-7ae25420`

## 方案概述

开启 Next.js `output: 'standalone'`，用多阶段 Dockerfile 把应用打包成自包含镜像，部署到 CloudBase 云托管（容器服务）。容器内 `node server.js` 监听 `0.0.0.0:$PORT`，由 CloudBase 注入 `PORT` 与业务环境变量。定时抓取任务因 Vercel Cron 在容器环境失效，改用 GitHub Actions 定时 `curl` 调用部署后域名的 `/api/cron/trigger`。`vercel.json` 保留，Vercel 与 CloudBase 双部署互不影响。

## 架构设计

```
                       ┌─────────────────────────────────────┐
  GitHub Actions       │      CloudBase 云托管 (容器)          │
  (定时 cron) ───HTTPS──▶  Docker 镜像                          │
  curl + Bearer        │   node .next/standalone/server.js    │──TiDB连接──▶ TiDB Cloud
                       │   监听 0.0.0.0:$PORT                   │  (DATABASE_URL)
  用户浏览器 ──HTTPS────▶   ├─ SSR 页面 (/, /gz, /pubonln...)   │
                       │   └─ API 路由 (/api/**)               │──抓取HTTPS──▶ 广东/广州医保平台
                       │   环境变量: DATABASE_URL / CRON_SECRET │  (api-config 默认值)
                       └─────────────────────────────────────┘
```

**组件清单：**

| 组件 | 状态 | 职责 |
|------|------|------|
| `next.config.ts` | MOD | 增加 `output: 'standalone'`，产出自包含 server |
| `Dockerfile` | NEW | 多阶段构建：deps → builder → runner |
| `.dockerignore` | NEW | 缩小构建上下文，排除无关文件 |
| `.github/workflows/cloudbase-cron.yml` | NEW | 替代 Vercel Cron 的 4 个定时触发 |
| `DEPLOY-CLOUDBASE.md` | NEW | 云托管部署 + 定时任务 + 环境变量清单 |
| `.env.example` | MOD | 补充云托管环境变量与部署说明 |

**数据流：** 与现状一致，不改任何业务代码。`db.ts` 已用 Proxy 懒初始化，构建期不触碰 `DATABASE_URL`（决策依据）。

## 技术决策

### 决策 1: Next 输出模式 —— standalone vs 默认 vs static export
- **选项 A（选）standalone**：`next build` 产出 `.next/standalone/`（含精简 `node_modules` 与 `server.js`）。镜像最小、启动 `node server.js` 即可，无需在镜像内装全量依赖。
- **选项 B 默认输出**：镜像内需 `pnpm start` + 完整 `node_modules`，镜像体积大、层缓存差。
- **选项 C static export**：牺牲全部 API 路由与 SSR，与项目性质冲突（已在 spec 否决）。
- **理由**：standalone 是 Next 官方推荐的容器部署方式，体积与冷启动最优。需在 runner 阶段手动拷贝 `public/` 与 `.next/static/`（standalone 不含这两者）。

### 决策 2: 基础镜像 —— node:20-alpine vs node:20-slim vs distroless
- **选项 A（选）node:20-alpine**：体积小（~50MB），社区通用，corepack 内置。
- **选项 B node:20-slim（Debian）**：兼容性更好但体积大 3-4 倍。
- **选项 C distroless**：最安全但无 shell，调试困难、corepack 处理麻烦。
- **理由**：项目为纯 JS 运行（TiDB serverless 走 HTTP fetch，无原生 mysql 客户端编译），alpine 无 glibc 兼容问题。Node 20 满足 Next 16 要求。若后续构建出现 sharp/原生模块报错，回退到 slim。

### 决策 3: 定时任务方案 —— GitHub Actions vs CloudBase 定时触发器
- **选项 A（选，用户确认）GitHub Actions**：`schedule` cron + `curl`，不依赖平台能力，配置在代码仓库内可版本化。
- **选项 B CloudBase 定时触发器**：控制台配置，脱离仓库、不可版本化。
- **理由**：用户已选 A。注意 GitHub Actions cron 为 **UTC 时区**，需换算；且免费额度下有分钟级延迟，对每日一次的抓取无影响。触发密钥通过仓库 Secret `CRON_SECRET` + `DEPLOY_URL` 注入。

### 决策 4: 镜像内包管理 —— corepack pnpm vs npm ci
- **选项 A（选）corepack + pnpm@9**：与本地一致（`packageManager` 字段锁定），`preinstall` 的 only-allow 校验通过。
- **选项 B 转 npm**：需生成 package-lock，与项目锁文件体系冲突。
- **理由**：项目强制 pnpm，镜像内 `corepack enable` 后 pnpm 版本由 `packageManager` 字段自动锁定。

## Dockerfile 层级设计

```
Stage 1 (deps):    node:20-alpine + corepack pnpm
                   COPY package.json pnpm-lock.yaml
                   pnpm install --frozen-lockfile   ← 层缓存：仅锁文件变才重装

Stage 2 (builder): 复用 deps 的 node_modules
                   COPY . .
                   ENV NEXT_TELEMETRY_DISABLED=1
                   pnpm build                        ← 产出 .next/standalone + .next/static

Stage 3 (runner):  node:20-alpine（干净层）
                   ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
                   非 root 用户 nextjs
                   COPY --from=builder .next/standalone ./
                   COPY --from=builder .next/static ./.next/static
                   COPY --from=builder public ./public
                   EXPOSE 3000
                   CMD ["node", "server.js"]
```

**关键点：**
- `preinstall` 脚本用 `npx only-allow pnpm`，在 `pnpm install` 时执行需网络，已用 pnpm 调用故通过。
- `standalone` 不含 `public/` 和 `.next/static/`，必须显式 COPY，否则静态资源 404。
- `HOSTNAME=0.0.0.0` 必须设置，否则 Next server 默认 localhost，容器外无法访问（这也是很多人云托管仍 404 的次因）。
- `PORT` 给默认值 3000；CloudBase 注入 `PORT` 时 Next standalone server 自动读取覆盖。

## 数据模型

N/A —— 不涉及任何 schema 变更。`health_check` 表已存在（heartbeat 使用）。

## 接口契约

不新增/修改接口。复用现有：

| 接口 | 用途 | 鉴权 |
|------|------|------|
| `GET /api/cron/trigger?source=<src>` | 定时触发抓取 | `Authorization: Bearer $CRON_SECRET` 或 `?secret=` |
| `GET/HEAD /api/heartbeat` | 探活 + 验证 DB 连通 | 无 |

`source` 取值：`gz_drug` / `gd_pubonln` / `merged_drug` / `ledger`。

**GitHub Actions 定时映射（UTC 换算，原 Vercel 为 UTC）：**

| source | vercel.json (UTC) | GitHub Actions cron (UTC) |
|--------|-------------------|----------------------------|
| gz_drug | `0 18 * * *` | `0 18 * * *` |
| gd_pubonln | `30 18 * * *` | `30 18 * * *` |
| merged_drug | `0 20 * * *` | `0 20 * * *` |
| ledger | `0 22 * * *` | `0 22 * * *` |

（Vercel crons 本就是 UTC，直接沿用，语义一致。）

## 安全与性能考量

- **密钥管理**：`DATABASE_URL`、`CRON_SECRET` 只进 CloudBase 环境变量与 GitHub Secrets，不进镜像层、不进 git。`.dockerignore` 排除 `.env`。
- **最小权限**：runner 阶段用非 root `nextjs` 用户运行。
- **Cron 鉴权**：`/api/cron/trigger` 已校验 secret，GitHub Actions 携带 Bearer；未带或错误返回 401。
- **构建上下文**：`.dockerignore` 排除 `node_modules`、`.git`、`.specs`、`.claude`、`.spec-coding`、`docs`、`scripts`（迁移脚本不进运行镜像）。
- **性能**：standalone 镜像冷启动快；层缓存让仅代码改动时跳过依赖安装。

## 范围外（设计层面不解决的）

- CloudBase 控制台实际操作（创建服务、绑定镜像仓库、配环境变量、绑域名）—— 写入 `DEPLOY-CLOUDBASE.md` 供人工执行。
- CI 自动构建推送镜像到 CloudBase —— 本次仅提供 Dockerfile，构建触发方式由用户在控制台选择（本地 push / 代码库自动构建）。
- Vercel 相关配置改动 —— 保留不动。

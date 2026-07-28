# Review: 部署到腾讯云 CloudBase 云托管

- feature-id: `deploy-cloudbase` | trace_id: `sc-20260728-7ae25420`
- 评审范围: `next.config.ts`(MOD) / `Dockerfile`(NEW) / `.dockerignore`(NEW) / `.github/workflows/cloudbase-cron.yml`(NEW) / `DEPLOY-CLOUDBASE.md`(NEW) / `.env.example`(MOD)
- 模式: fast path 合并审查（纯配置，无业务逻辑）

## 六维度评估

### 1. 正确性
- ✅ `next.config.ts` 语法正确，`output: 'standalone'` 生效（build 已产出 `.next/standalone/server.js`）。
- ✅ Dockerfile 三阶段完整；显式 COPY `.next/static` 与 `public`（消除 HIGH 风险的静态资源 404）。
- ✅ `HOSTNAME=0.0.0.0`、`PORT=3000` 已设（消除 HIGH 风险的容器外不可访问）。
- ✅ standalone 产物含精简 `node_modules`，`CMD node server.js` 入口正确。
- ✅ workflow YAML 语法校验通过；cron 时间与 `vercel.json` 逐条一致（UTC）。
- ✅ cron→source 映射用 `github.event.schedule` 精确匹配，`workflow_dispatch` 走 input 兜底。
- ✅ curl 检查 HTTP 200，非 200 以 `::error::` 失败退出，错误处理显式。

### 2. 可读性
- ✅ 每个文件均有中文注释说明意图；Dockerfile 各阶段职责清晰。
- ✅ 文档结构分节，含排查表与验证清单。

### 3. 架构
- ✅ 与 design.md 完全一致：standalone + 多阶段 alpine + GitHub Actions cron。
- ✅ 未触碰任何 `src/**` 业务代码，`vercel.json` 保留（双部署兼容）。

### 4. 安全
- ✅ 密钥（`DATABASE_URL`/`CRON_SECRET`）不进代码、不进镜像层；`.dockerignore` 排除 `.env*`（保留 `.env.example`）。
- ✅ runner 用非 root `nextjs` 用户运行（最小权限）。
- ✅ cron 接口沿用现有 Bearer 鉴权，Actions 通过 Secret 注入。
- ✅ `.dockerignore` 排除 `scripts`（迁移脚本不进运行镜像）、`.specs`/`.claude`/`.spec-coding`。

### 5. 性能
- ✅ deps 阶段独立，层缓存让仅代码改动跳过依赖安装。
- ✅ alpine 基础镜像 + standalone 精简产物，镜像体积与冷启动最优。

### 6. Spec 合规
- ✅ 验收标准 1（standalone 产物）已由 build 验证通过。
- ✅ 验收标准 2/3/4（容器启动/DB连通/cron 触发）需运行时验证，已在文档与 verify 规划中覆盖。
- ✅ 验收标准 5（.dockerignore 排除清单）已满足。

## 问题清单

| 级别 | 问题 | 处理 |
|------|------|------|
| — | 未发现 CRITICAL / HIGH | — |
| LOW | docker build/run 实测依赖本地或 CloudBase 环境，本机未跑 | 已在 verify 规划标注为运行时/人工验证，文档提供命令 |
| LOW | GitHub Actions 免费额度 cron 有分钟级延迟 | 文档已说明，对日级任务无影响 |

## 结论

**CRITICAL: 0 | HIGH: 0 | MEDIUM: 0 | LOW: 2**

无阻断项，可进入 `/zy-verify`。

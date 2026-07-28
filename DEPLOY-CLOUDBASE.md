# CloudBase 云托管部署手册

本项目是**全栈 Next.js 16 应用**（含 API 路由 + TiDB 直连 + SSR），**不能**用
CloudBase「静态网站托管」部署（会 404）。必须用 **CloudBase 云托管（容器服务）**。

> 静态托管 404 的原因：它只是 CDN + 对象存储，只能返回预生成的静态文件；
> 而 `next build` 产出的是服务端构建产物，没有可托管的 `index.html`。

---

## 一、前置准备

- 已开通腾讯云 CloudBase 环境，进入「云托管」。
- 一个可用的 TiDB Cloud Serverless 连接串（`DATABASE_URL`）。
- 本仓库当前分支：`master-cloudbase`。

关键文件（本次已就绪）：

| 文件 | 作用 |
|------|------|
| `next.config.ts` | 开启 `output: 'standalone'` |
| `Dockerfile` | 多阶段构建，产出最小运行镜像 |
| `.dockerignore` | 缩小构建上下文，排除密钥/文档/脚本 |
| `.github/workflows/cloudbase-cron.yml` | 替代 Vercel Cron 的定时抓取 |

---

## 二、部署（推荐：代码库自动构建）

CloudBase 云托管支持直接用仓库里的 `Dockerfile` 构建，二选一：

### 方式 A：控制台代码仓库部署
1. 云托管 → 新建服务 → 选择「代码仓库」，授权并选中本仓库 `master-cloudbase` 分支。
2. 构建方式选 **Dockerfile**，路径 `./Dockerfile`。
3. 监听端口填 **3000**（与 Dockerfile `EXPOSE`/`PORT` 一致）。
4. 配置环境变量（见第三节）。
5. 部署，等待构建完成，获得公网访问域名。

### 方式 B：本地构建后推送镜像
```bash
# 1. 构建镜像
docker build -t drug-info-system:latest .

# 2. 本地验证（可选，需本地 Docker）
docker run --rm -p 3000:3000 \
  -e DATABASE_URL='mysql://<user>:<pwd>@<host>:4000/<db>?ssl={"rejectUnauthorized":true}' \
  -e CRON_SECRET='<your-secret>' \
  drug-info-system:latest
# 浏览器打开 http://localhost:3000 应正常显示；curl http://localhost:3000/api/heartbeat 返回 success

# 3. 按 CloudBase 控制台「镜像拉取」指引，打标签并推送到云托管镜像仓库，再选该镜像部署
```

---

## 三、环境变量（在云托管「版本配置 → 环境变量」中填写）

| 变量 | 必填 | 说明 |
|------|------|------|
| `DATABASE_URL` | ✅ | TiDB 连接串，格式见 `.env.example` |
| `CRON_SECRET` | ✅ | 定时任务鉴权密钥，需与 GitHub Secret 一致 |
| `NODE_ENV` | 自动 | 容器内已固定 `production`，无需手填 |
| `PORT` | 自动 | 平台注入；Dockerfile 默认 3000 |
| `HOSTNAME` | 自动 | Dockerfile 已固定 `0.0.0.0`，勿覆盖 |
| `PUBONLN_API_URL` 等 | ❌ | 抓取源地址，代码已内置默认值，一般不填 |

> ⚠️ 密钥只填在云托管环境变量，**不要**写进代码或提交到 git。

---

## 四、定时抓取任务（GitHub Actions）

Vercel Cron 在云托管**不生效**。改用 `.github/workflows/cloudbase-cron.yml`：

1. 在 GitHub 仓库 → Settings → Secrets and variables → Actions 添加：
   - `DEPLOY_URL`：云托管公网域名（结尾**不带** `/`），如
     `https://your-app.ap-shanghai.run.tcloudbase.com`
   - `CRON_SECRET`：与云托管环境变量中的 `CRON_SECRET` 相同值
2. 4 个抓取任务的时间（UTC，与原 `vercel.json` 一致）：

   | 数据源 | UTC | 北京时间 |
   |--------|-----|----------|
   | gz_drug | 18:00 | 次日 02:00 |
   | gd_pubonln | 18:30 | 次日 02:30 |
   | merged_drug | 20:00 | 次日 04:00 |
   | ledger | 22:00 | 次日 06:00 |

3. 手动测试：Actions → CloudBase Cron Trigger → Run workflow → 选 source 运行，
   查看日志应为 `HTTP 200`。

> 说明：GitHub Actions 免费额度下 cron 有分钟级延迟，对每日一次的抓取无影响。
> 也可保留 `vercel.json`，若同时部署 Vercel 则两边定时都会跑（按需取舍）。

---

## 五、404 / 部署问题排查

| 现象 | 原因 | 解决 |
|------|------|------|
| 整站 404 | 用了「静态托管」而非「云托管」 | 改用云托管容器部署 |
| 页面能开但无样式、favicon 404 | 漏拷贝 `.next/static` 或 `public` | 本 Dockerfile 已显式 COPY，勿删这两行 |
| 容器启动但外部访问超时/拒绝 | 未监听 `0.0.0.0` 或端口不匹配 | 确认 `HOSTNAME=0.0.0.0`，监听端口 = 服务端口 3000 |
| API 返回 500，日志报 DATABASE_URL | 未配置 `DATABASE_URL` | 在环境变量中补齐 |
| `/api/cron/trigger` 返回 401 | secret 不匹配 | 校对云托管 `CRON_SECRET` 与 GitHub Secret |
| 构建报某原生模块缺失 | alpine 缺 glibc | 将 Dockerfile 三处 `node:20-alpine` 改为 `node:20-slim` |

---

## 六、验证清单

- [ ] `pnpm build` 本地成功，存在 `.next/standalone/server.js`
- [ ] 云托管构建成功并获得公网域名
- [ ] 打开域名首页正常渲染（含样式）
- [ ] `curl https://<域名>/api/heartbeat` 返回 `success: true`
- [ ] 手动运行 GitHub Actions workflow，返回 HTTP 200

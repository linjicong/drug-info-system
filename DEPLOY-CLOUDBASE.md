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
| `.github/workflows/scrape-runner.yml` | 定时抓取执行器（Actions runner 直连 TiDB，与部署位置无关） |

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
| `CRON_SECRET` | 可选 | 仅用于 `/api/ledger/scheduler` 历史 cron 端点鉴权（优先读数据库 cron_secret） |
| `NODE_ENV` | 自动 | 容器内已固定 `production`，无需手填 |
| `PORT` | 自动 | 平台注入；Dockerfile 默认 3000 |
| `HOSTNAME` | 自动 | Dockerfile 已固定 `0.0.0.0`，勿覆盖 |
| `PUBONLN_API_URL` 等 | ❌ | 抓取源地址，代码已内置默认值，一般不填 |

> ⚠️ 密钥只填在云托管环境变量，**不要**写进代码或提交到 git。

---

## 四、定时抓取任务（GitHub Actions）

抓取/合并/台账任务不在应用容器内执行，而是由 `.github/workflows/scrape-runner.yml` 在 GitHub runner 上直连 TiDB 执行（与部署位置无关）：

1. 在 GitHub 仓库 → Settings → Secrets and variables → Actions 添加：
   - `DATABASE_URL`：TiDB 连接串，与容器环境变量同值
2. 运行机制：schedule 每 5 分钟轮询（上线初期注释禁用，验证后放开），
   认领数据库中 queued 的手动任务与到期的定时任务；定时时刻由
   `scheduler_config.next_run_at` 到期判定吸收 cron 的分钟级漂移。
3. 手动测试：Actions → Scrape Runner → Run workflow → 选 source 运行，
   查看日志应输出各源处理结果，且 `scrape_log` 出现 `success` 记录。

---

## 五、404 / 部署问题排查

| 现象 | 原因 | 解决 |
|------|------|------|
| 整站 404 | 用了「静态托管」而非「云托管」 | 改用云托管容器部署 |
| 页面能开但无样式、favicon 404 | 漏拷贝 `.next/static` 或 `public` | 本 Dockerfile 已显式 COPY，勿删这两行 |
| 容器启动但外部访问超时/拒绝 | 未监听 `0.0.0.0` 或端口不匹配 | 确认 `HOSTNAME=0.0.0.0`，监听端口 = 服务端口 3000 |
| API 返回 500，日志报 DATABASE_URL | 未配置 `DATABASE_URL` | 在环境变量中补齐 |
| Actions 抓取任务失败 | 未配置 `DATABASE_URL` secret 或连接串错误 | 校对仓库 Secrets 中的 `DATABASE_URL` |
| 构建报某原生模块缺失 | alpine 缺 glibc | 将 Dockerfile 三处 `node:20-alpine` 改为 `node:20-slim` |

---

## 六、验证清单

- [ ] `pnpm build` 本地成功，存在 `.next/standalone/server.js`
- [ ] 云托管构建成功并获得公网域名
- [ ] 打开域名首页正常渲染（含样式）
- [ ] `curl https://<域名>/api/heartbeat` 返回 `success: true`
- [ ] 手动运行 GitHub Actions workflow，返回 HTTP 200

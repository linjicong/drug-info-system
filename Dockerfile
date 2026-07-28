# syntax=docker/dockerfile:1

# ==============================================================================
# Next.js 16 (standalone) 多阶段构建 —— 用于腾讯云 CloudBase 云托管等容器环境
# 包管理器：pnpm 9（由 package.json 的 packageManager 字段锁定，corepack 启用）
# ==============================================================================

# ---- Stage 1: deps —— 仅装依赖，利用层缓存（锁文件不变则跳过重装）----
FROM node:20-alpine AS deps
WORKDIR /app
# alpine 下 Next/部分依赖需要 libc 兼容
RUN apk add --no-cache libc6-compat
# 启用 corepack，pnpm 版本由 package.json 的 packageManager 自动锁定
RUN corepack enable
# 先只拷贝依赖清单，最大化层缓存命中
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

# ---- Stage 2: builder —— 复用 node_modules 执行 next build ----
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 关闭遥测，加速构建
ENV NEXT_TELEMETRY_DISABLED=1
# db.ts 为懒初始化，构建期无需 DATABASE_URL
RUN pnpm build

# ---- Stage 3: runner —— 干净的最小运行镜像 ----
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# CloudBase 会注入 PORT；给默认值 3000。HOSTNAME 必须 0.0.0.0，否则容器外无法访问（常见 404 诱因）
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# 以非 root 用户运行
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# standalone 产物已含精简 node_modules 与 server.js
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# standalone 不含以下两者，必须显式拷贝，否则静态资源/样式/favicon 404
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

# standalone 的入口是根目录的 server.js
CMD ["node", "server.js"]

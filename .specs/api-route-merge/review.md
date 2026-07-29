# Review — api-route-merge（commit 9aa6b11）

审查方式：CodeReview 子代理逐提交全量 diff + 工作区交叉验证（2026-07-28）

## 结论：0 CRITICAL / 0 HIGH / 0 MEDIUM / 1 LOW — 可发布

## 等价性验证（全部通过）

- 20 个旧 handler 逐行搬迁，响应形状（success/data/pagination/summary）、
  状态码 400/401/404/405/409/500、Cache-Control 头、Excel 文件名完全一致
- 分发表方法集合正确：gz progress 显式挂 POST（405 保留）；pubonln progress 无 POST，
  由 createModuleRoute 兜底 405，与旧文件不导出 POST 的框架默认行为等价
- 外部契约 /api/cron/trigger、/api/heartbeat 未触碰；ledger 五个子路径 URL 不变
- 前端三个 page.tsx 全部切换新 URL，旧 URL 在 src/、.github/ 下 grep 零残留
- Next.js 16 契约：context.params 已 await；merged 模块级 initialized 语义等价

## LOW（不阻塞，择机处理）

1. **405 响应无 Allow 头**（module-route.ts）：旧路由由框架返回 405 时自动带
   `Allow` 头，新实现只在 JSON 消息中列出支持的方法。当前无消费方依赖该头。
   建议：405 响应补 `headers: { Allow: ... }`。

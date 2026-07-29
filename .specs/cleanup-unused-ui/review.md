# Review — cleanup-unused-ui（commit a0c2acc）

审查方式：CodeReview 子代理逐提交全量 diff + 全仓引用扫描（2026-07-28）

## 结论：PASSED，未发现任何问题 — 可发布

## 验证明细

- 保留的 8 个组件（badge/button/card/input/label/progress/select/table）仍被
  src/components/drug/* 业务代码引用，其依赖（@radix-ui/react-label/progress/
  select/slot、class-variance-authority、lucide-react）均保留
- 已删 45 个组件路径与 src/hooks/use-mobile 全仓 grep 零残留 import
- 已删 33 个依赖在 src/、scripts/、配置文件范围 grep 零引用
- 关键确认：toast/Toaster 一直直接 import 自 sonner npm 包（非已删的 ui/sonner.tsx）；
  ui/sonner.tsx 是 next-themes 唯一引用方，二者同批删除自洽

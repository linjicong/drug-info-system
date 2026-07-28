# cleanup-unused-ui — 清理未使用的 shadcn/ui 组件与独占依赖

## 背景

模板预装了 53 个 shadcn/ui 组件，业务代码（src 下非 components/ui 文件）实际仅引用 8 个：
`badge, button, card, input, label, progress, select, table`。
这 8 个组件之间零内部依赖，其余 45 个组件可安全删除。

## 范围

**删除文件（46 个）：**
- `src/components/ui/` 下 45 个未引用组件：accordion, alert-dialog, alert, aspect-ratio,
  avatar, breadcrumb, button-group, calendar, carousel, chart, checkbox, collapsible,
  command, context-menu, dialog, drawer, dropdown-menu, empty, field, form, hover-card,
  input-group, input-otp, item, kbd, menubar, navigation-menu, pagination, popover,
  radio-group, resizable, scroll-area, separator, sheet, sidebar, skeleton, slider,
  sonner, spinner, switch, tabs, textarea, toggle-group, toggle, tooltip
- `src/hooks/use-mobile.ts`（仅被 ui/sidebar.tsx 引用）

> 注：业务代码的 toast/Toaster 均直接 import 自 `sonner` npm 包，`ui/sonner.tsx` 封装未被使用。

**package.json 清理：**
删除后全仓扫描 import，凡不再被任何 src/scripts 文件引用的依赖一并移除
（预期含大部分 @radix-ui/*、recharts、embla-carousel-react、react-day-picker、
react-hook-form、@hookform/resolvers、cmdk、vaul、input-otp、react-resizable-panels 等；
以实际扫描结果为准）。`sonner`、`lucide-react`、`next-themes` 等仍在用的保留。

## 验收（GWT）

- Given 删除 46 个文件并同步清理依赖，When 执行 `pnpm install && pnpm build`，
  Then 构建成功且路由表与删除前一致（6 条 API + 5 页面）。
- Given 清理完成，When 执行 `tsc --noEmit` 与 `vitest run`，Then 0 错误、12/12 通过。
- Given 四个业务页面，When 手动打开，Then 渲染与交互无变化（在用 8 组件未动）。

## 回滚

任一 shadcn 组件将来需要时：`pnpm dlx shadcn@latest add <name>` 即可恢复。

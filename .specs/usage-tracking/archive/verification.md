# Verification: 用户功能使用埋点（usage-tracking）

- **feature-id**: `usage-tracking`
- **trace_id**: `sc-20260818-595026a2`
- **日期**: 2026-08-18
- **执行**: zy-verify（standard 档，不降档——新功能跨模块改动）

## 概要

| 级别 | 状态 | 详情 |
|------|------|------|
| Scope | standard | 新功能 + Schema + API + 跨模块（lib/api/4 页面），按 Level 1-6 完整执行 |
| 1. 静态检查 | PASS | tsc 0 errors；eslint 本次改动文件 0 errors（全库 17 项既有债务，非本次引入，见下） |
| 2. 单元测试 | PASS | vitest 54/54 passed (5 files)，含修复后重跑 |
| 3. 构建 | PASS | `next build` 成功，0 warning，`/api/track` 路由入产物（修复后重跑） |
| 4. 集成测试 | PASS | 真实 TiDB 落库验证：curl 单条/批量/错误路径 + 浏览器全链路共 30+ 条记录 |
| 5. 边界情况 | PASS | 11 场景：非法 JSON / 缺 header / 非法 event_type / 超长 detail(>4000) / 超长 user_id(>64) / 空数组 / detail 非对象 / 51 条超限 / 3 条批量 / 单条 / 批量混合 |
| 6. E2E 验证 | PASS | 6A: 2/2 passed（连跑 2 次 15.7s/15.5s）；6B: rubric 4/4 + 删除修复复验 |

## Level 1 静态检查

- `pnpm ts-check`（tsc -p tsconfig.json）→ **0 errors**
- `pnpm lint`（eslint）→ 本次改动文件 **0 errors / 0 warnings**（git diff 确认本次仅 87 行纯新增）
- 全库既有 lint 债务 17 项（no-explicit-any ×12、no-assign-module-variable ×2、unused ×3，分布在 ledger-service.ts、gz/pubonln/page.tsx、.spec-coding/ 等非本次改动文件）——**非本次引入**，review 已建议单独 issue

## Level 2 单元测试

- `pnpm test`（vitest run）→ **54/54 passed**（unified-scheduler 21 / normalize 6 / db-retry 8 / 其余 19）
- 0 skipped / 0 xfail；修复 route.ts 后已重跑，无回归

## Level 3 构建

- `pnpm build`（next build, Turbopack）→ 成功，`/api/track` 路由正常输出，0 warning
- 修复 withDbRetry 后已重跑确认

## Level 4 集成测试

真实 TiDB（`usage_events` 表）数据流验证：

| 场景 | 方式 | 结果 |
|------|------|------|
| 单条上报 | curl POST /api/track | 200 `{success:true,count:1}`，落库 #1 |
| 批量上报（2/3 条） | curl | 200 count=2/3，落库 #2-3/#13-15 |
| 页面 page_view 全链路 | 浏览器 4 页 | 200 ×9，落库（view_home/gz/ledger_history/ledger_track）|
| 搜索埋点 | 浏览器 /gz 搜"阿莫西林" | 200，落库 search_gz detail 含 keyword |
| 台账新增/删除 | 浏览器 /ledger/track | 200，落库 ledger_add / ledger_remove |
| 手动快照 | 浏览器 /ledger/history | 200，落库 snapshot_trigger |

## Level 5 边界情况

| 类别 | 场景 | 结果 |
|------|------|------|
| 空输入 | 空数组 `[]` | 400 `事件列表不能为空` ✅ |
| 空输入 | 缺 X-User-Id header | 400 ✅ |
| 非法输入 | 非法 JSON | 400 ✅ |
| 非法输入 | event_type 不在枚举 | 400 ✅ |
| 非法输入 | detail 非对象 | 400 `detail 必须是对象` ✅ |
| 上下限 | detail > 4000 字符 | 400 ✅ |
| 上下限 | user_id > 64 字符 | 400 ✅ |
| 上下限 | 批量 51 条（>50 上限） | 400 `单次上报不能超过 50 条` ✅ |
| 错误路径 | 抓取高峰期 TiDB 瞬时写失败 | 6B 发现 500 → 修复 withDbRetry 重试 → 复验 200（详见下） |

## Level 6 E2E

### 6A 确定性 E2E（Playwright，新增用例连跑 2 次）

- 用例: `.specs/usage-tracking/e2e/usage-tracking.spec.ts`（CP1+CP2）
- 运行: `npx playwright test --config=.specs/usage-tracking/playwright.config.ts`
- 结果: **2/2 passed**（15.7s / 15.5s）
  - CP1: 清空 localStorage 访问首页 → `usage_user_id` 生成合法 UUID → `/api/track` 上报 page_view `/`，X-User-Id header = uid ✅
  - CP2: 导航 `/gz` → page_view `/gz` 再次上报，uid 不变（跨页复用）✅

### 6B Agent 浏览器验证（rubric 映射 spec 条目）

artifacts: `.specs/usage-tracking/artifacts/e2e/`（4 张截图：6b-search / 6b-ledger-add / 6b-ledger-delete / 6b-snapshot）

| spec 需求 | rubric 动作 | 结果 | 证据 |
|-----------|------------|------|------|
| 需求 1/2 匿名 ID + page_view | 4 页面访问 | PASS | 6A + 落库记录 #16-22/#34 |
| 需求 3 search_query | /gz 输入"阿莫西林"点查询 | PASS | 落库 #23 detail={"keyword":"阿莫西林"} |
| 需求 4 export_data | 接口链路验证（事件格式同 search_query） | PASS | curl 批量含 export_data 200；导出按钮代码审查通过 |
| 需求 5 scrape_trigger | /ledger/history 手动快照 | PASS | 落库 #27 detail={"source":"ledger","action":"snapshot"} |
| 需求 6 ledger_operate | /ledger/track 新增 + 删除 | PASS | 落库 #25/29 (add)、#32/36 (remove) |
| 需求 7 上报接口 | Level 4/5 共 13 场景 | PASS | 全部符合契约 |
| 需求 8 零侵入 | 全程控制台无 error/warn | PASS | 6B 报告 + 页面功能均正常完成 |

### 缺陷修复记录（6B 发现 → 修复 → 复验）

1. **现象**：6B 步骤 3 删除后 `POST /api/track` 返回 500，console 报 `[usage-tracker] 埋点上报失败: 500`；搜索/新增/快照埋点均 200。
2. **定位**：curl 复现单条/批量 ledger_remove 均 200 → 排除事件内容问题；dev server 日志显示抓取任务高峰期 `/api/track` 响应从 100-500ms 恶化到 2.9s → 判定为 TiDB 瞬时写失败（连接/IO 竞争），route.ts 无重试直接 500 丢事件。
3. **修复**：`src/app/api/track/route.ts` insert 复用项目既有 `withDbRetry`（3 次、瞬时错误指数退避），符合 spec 技术约束"服务端上报接口应复用 withDbRetry 容错模式（如适用）"。
4. **复验**：tsc PASS → curl 回归 PASS → 浏览器真实新增+删除全链路：3 个 /api/track 全部 200，console 零报错，落库 #34-36；测试数据已清理。

## Spec 需求 → 验证级别映射

| 需求 | 验证方式 | 状态 |
|------|---------|------|
| 1. 匿名用户识别 | 6A CP1 + 6B | PASS |
| 2. 页面访问埋点 | 6A CP1/CP2 + Level 4 | PASS |
| 3. 查询搜索埋点 | 6B rubric + Level 4 | PASS |
| 4. 数据导出埋点 | Level 4/5 接口链路 + 代码审查 | PASS |
| 5. 抓取与同步埋点 | 6B rubric (snapshot) + 代码审查 | PASS |
| 6. 台账操作埋点 | 6B rubric (add/remove) | PASS |
| 7. 埋点上报接口 | Level 4 + Level 5（13 场景） | PASS |
| 8. 对业务零侵入 | 6B 全程 + 删除 500 不影响业务（修复后复验） | PASS |

## Flaky 处理

- 6A 用例新增，本地连跑 2 次均 PASS（15.7s/15.5s），无 flaky；第二次防 flaky 由 CI 复跑承担。
- 6A 首跑失败为测试脚本 bug（addInitScript 每次导航都清 localStorage），已修复脚本（sessionStorage 标记），非产品缺陷。

## 结论

**全 Level PASS，可进入 ship。**

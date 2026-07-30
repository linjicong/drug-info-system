# Spec — fix-merged-sync-pagination（hotfix）

## 问题（用户报告）

/merged 点击「手动合并」后，前端一直停留在「正在查询广东医保数据...」。

## 排障证据

- 服务端进度接口实测：任务并未死锁，5 分钟后仍处于查询阶段
  （gdLoaded=43722 已完成，gzLoaded=0 无推进）
- 数据量级：drug_info_gd 43722 行 / drug_info_gz 47002 行 / merged 54340 行

## 根因

1. **OFFSET 深分页**：`fetchAllGdDrugs` / `fetchAllGzDrugs` 用
   `OFFSET n LIMIT 1000` 翻页，TiDB 每页都要重扫并丢弃前面所有行，
   4 万+行共 40+ 页呈 O(n²) 递增，整个查询阶段长达数分钟。
2. **循环内不回写进度**：`gdLoaded` / `gzLoaded` 要整表查完才更新一次，
   长查询期间前端数字纹丝不动，体感即「卡死」。

## 变更清单

| 文件 | 变更 |
|------|------|
| src/lib/merged-drug-service.ts | 两个取数函数改 keyset 分页（`WHERE id > lastId ORDER BY id`，id 为 varchar(36) 主键，走索引 range scan）；每批循环内回写 gdLoaded/gzLoaded 进度 |

未改动：`shared/db-query.ts` 的 `fetchAllInBatches`（导出场景带筛选、
数据量小，不在本次报障路径内，留待后续统一优化）。

## 验收（GWT）

- Given 点击手动合并，When 查询阶段进行中，Then gdLoaded/gzLoaded 每秒级持续递增
- Given GD/GZ 全量取数，When keyset 分页执行，Then 查询阶段总耗时显著低于 OFFSET 版本
- Given 合并完成，When 前端刷新，Then 状态回写正常（依赖 9b821ea 已修复的 finalize）

## 风险/回滚

仅改取数方式与进度上报，合并去重与写入逻辑未动；回滚 revert 单提交即可。

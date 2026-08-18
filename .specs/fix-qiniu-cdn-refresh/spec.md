# Spec — fix-qiniu-cdn-refresh（hotfix）

## 问题（用户现象）

发版 0.1.1 后，0.1.0 安装版重启约 5 秒后未弹出"发现新版本"对话框，自动更新毫无反应。

## 根因

`latest.yml` 在七牛桶内为**同名覆盖上传**（key 不变），七牛 CDN 按
`Cache-Control: max-age=31536000`（1 年）缓存旧清单，命中缓存不回源；
客户端 `updater.cjs` 读到旧版本号后 `compareVersions <= 0` 直接跳过，
且更新检查静默失败无 UI 提示，表现为"不弹窗"。

证据：CDN 响应头 `X-Qnm-Cache: Hit` / `Age: 4280` / `Last-Modified` 为
0.1.0 上传时间；带随机 query 绕过缓存后源站 `latest.yml` 已是 0.1.1。

## 变更清单

| 文件 | 变更 |
|------|------|
| scripts/upload-qiniu.mjs | latest.yml 上传完成后调用 `qiniu.cdn.CdnManager.refreshUrls` 刷新 CDN 缓存（未设置 UPDATE_URL 时跳过并提示） |

## 验证（GWT）

- Given 发版流程执行完毕，When latest.yml 上传完成，Then 自动发起 CDN 刷新请求，返回 HTTP 200
- Given 未设置 UPDATE_URL，When 上传完成，Then 跳过刷新并打印提示，不中断发版

## 验证结果

- `node --check` 语法通过；`qiniu.cdn.CdnManager.prototype.refreshUrls` 存在
- 刷新端点 `http://fusion.qiniuapi.com/v2/tune/refresh` 网络可达（无凭证时 401 属预期）
- 人工复核：刷新后 `curl latest.yml` 响应头 `X-Qnm-Cache` 应变 Miss

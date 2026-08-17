# Spec — desktop-release-cache（lightweight）

## 背景与目标

`desktop-release.yml` 发版流水线（tag 触发，windows-latest）当前只启用了
`setup-node@v4` 的 `cache: pnpm`（pnpm store），耗时大头仍在：

1. Electron 发行包 zip（约 110MB）每次从 npmmirror 镜像重新下载
2. electron-builder 工具链（nsis / winCodeSign）每次重新下载
3. `next build` 编译缓存缺失，每次全量编译

目标：新增 `actions/cache@v4` 缓存上述三处，key 由
`hashFiles('pnpm-lock.yaml')` 派生，保留 `restore-keys` 兜底复用旧缓存。

## 现状（已确认）

- `desktop-build.mjs`（scripts/desktop-build.mjs L35-L51）已内置
  `%LOCALAPPDATA%\electron\Cache` 查找 + 预解压逻辑：缓存 zip 命中后
  完全跳过网络下载，只做本地解压 → 该目录缓存的收益被脚本原生承接
- electron-builder 自动使用 `%LOCALAPPDATA%\electron-builder\Cache`
- `desktop:build` = `next build && assemble-desktop && desktop-build`，
  Next.js 编译缓存目录为 `.next/cache`

## 变更清单

| 文件 | 变更 |
|------|------|
| .github/workflows/desktop-release.yml | Install dependencies 之后新增 1 个 actions/cache 步骤，path 含 3 个缓存目录，key 用 pnpm-lock.yaml hash，restore-keys 兜底 |

不改动任何构建脚本与业务代码。scrape-runner.yml（self-hosted）无
Electron/Next 构建且本地 store 持久化，不在本次范围。

## 验收（GWT）

- Given 推送 v* tag 首次触发发版（无缓存），When CI 运行，Then 构建成功
  且三个缓存目录被保存
- Given lockfile 未变化的再次发版，When CI 运行，Then 命中 electron /
  next 编译缓存，跳过对应下载/编译
- Given lockfile 变化（key 不匹配），When CI 运行，Then restore-keys
  兜底仍恢复旧缓存（Electron 版本不变时复用）
- Given actions/cache 恢复失败，When CI 运行，Then 仅 warning 不阻断构建

## 风险/回滚

- actions/cache 对恢复失败只发 warning 不 fail，最坏情况退化为无缓存全量构建
- 改动为纯加法步骤，不触碰构建/上传/发布步骤；回滚 revert 单提交即可
- GitHub Actions 缓存 7 天未访问被淘汰：发版间隔长时缓存会重建，命中即赚

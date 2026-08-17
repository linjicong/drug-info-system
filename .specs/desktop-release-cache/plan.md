# Plan — desktop-release-cache

## 技术栈与前置事实

- workflow：GitHub Actions，windows-latest，YAML 配置
- actions/cache@v4：恢复失败仅 warning 不阻断（官方行为）
- key 派生：`hashFiles('pnpm-lock.yaml')` —— electron / electron-builder
  版本均由 lockfile 锁定，key 变化即依赖集变化，粒度精确
- Windows runner 环境变量：`${{ env.LOCALAPPDATA }}` 展开为
  `C:\Users\runneradmin\AppData\Local`

## 任务清单

| # | 任务 | 说明 |
|---|------|------|
| T1 | desktop-release.yml 新增 Cache 步骤 | 置于 Setup Node.js 之后、Install dependencies 之前；actions/cache@v4，2 个 path，key + restore-keys |
| T2 | 本地校验 YAML 语法与步骤顺序 | 无 CI 环境，用 YAML 解析校验 + 人工核对步骤顺序/缩进 |

## 具体改动（T1 内容，含 build 阶段修正）

```yaml
      - name: Cache electron binaries & next build
        # 必须在 pnpm install 之前：electron 包 postinstall 会用 @electron/get
        # 下载发行包 zip 到 %LOCALAPPDATA%\electron\Cache，恢复晚了照样全量下载；
        # desktop-build.mjs 已内置「缓存 zip → 预解压」逻辑，命中后跳过网络下载
        uses: actions/cache@v4
        with:
          path: |
            ${{ runner.temp }}\localappdata
            .next/cache
          key: build-cache-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}
          restore-keys: |
            build-cache-${{ runner.os }}-
```

job 级 env 增加（修正 1：env 上下文不含 runner 系统变量）：

```yaml
env:
  # LOCALAPPDATA 重定向到 runner.temp 下稳定路径：electron postinstall 下载、
  # desktop-build.mjs 查找、electron-builder 工具链缓存均读该环境变量，
  # 统一落位后 actions/cache 一次缓存（path 中写 %LOCALAPPDATA% 不会被展开）
  LOCALAPPDATA: '${{ runner.temp }}\localappdata'
```

### build 阶段修正记录（相对初版 plan）

1. path 由 `${{ env.LOCALAPPDATA }}\electron\Cache` 改为 `${{ runner.temp }}\localappdata`：
   GitHub Actions 的 env 上下文只含显式定义变量，`env.LOCALAPPDATA` 会展开为空串；
   改为显式定义 LOCALAPPDATA 环境变量 + runner.temp 绝对路径（官方上下文，可靠展开）
2. 步骤位置由 Install dependencies 之后改为之前：electron postinstall 在 install
   期间即下载 zip，恢复晚了缓存永远不命中（修正 2）

## 验证（证据要求）

- T2：python yaml 解析成功 + 步骤位于 Setup Node.js 与 Install dependencies
  之间，缩进 6 空格与相邻步骤一致
- 缓存命中行为无法本地复现，依赖 GitHub Actions 运行时证据：首次 tag
  触发后观察 Actions 页面 cache 步骤输出（`Cache saved` / `Cache restored`）
  与第二次构建日志中的 `Cache hit`。此部分属于部署后验证，超出本次
  改动范围，记录为后续观察项

## 风险

- 缓存目录含大文件（Electron zip ~110MB），压缩/上传耗时约几十秒，
  相对全量下载收益可忽略
- 无破坏性风险：actions/cache 不命中/恢复失败均不 fail

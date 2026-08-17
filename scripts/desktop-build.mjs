/**
 * electron-builder 打包包装：
 * 1. 注入国内镜像环境变量——electron-builder 通过 @electron/get 下载 Electron
 *    发行包，只认大写环境变量（ELECTRON_MIRROR / ELECTRON_BUILDER_BINARIES_MIRROR），
 *    .npmrc 里的 electron_mirror 仅在依赖安装期生效，运行期需要显式注入
 * 2. 预解压 Electron 发行包 + electronDist 指向解压目录——electron-builder 默认
 *    流程是解压到 win-unpacked.tmp 后 rename 为 win-unpacked，本机（Defender 实时
 *    扫描）该 rename 稳定 EPERM；改为直接解压到目标目录，electron-builder 对
 *    已解压的 electronDist 只做普通文件拷贝，彻底绕 rename
 * 3. 更新源注入——环境变量 UPDATE_URL 非空时向配置追加 generic publish，
 *    产物 resources/app-update.yml 与 latest.yml 即指向该更新源（配合
 *    electron/updater.cjs 自动更新）；未设置则产物不带更新能力
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, createReadStream, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const env = {
  ...process.env,
  ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
  ELECTRON_BUILDER_BINARIES_MIRROR:
    process.env.ELECTRON_BUILDER_BINARIES_MIRROR || 'https://npmmirror.com/mirrors/electron-builder-binaries/',
};

/* ---------- 预解压 Electron 发行包 ---------- */

const electronVersion = JSON.parse(
  readFileSync(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8'),
).version;
const cacheDir = path.join(process.env.LOCALAPPDATA || path.join(require('node:os').homedir(), 'AppData', 'Local'), 'electron', 'Cache');
const zipName = `electron-v${electronVersion}-win32-x64.zip`;

function findCachedZip() {
  if (!existsSync(cacheDir)) return null;
  for (const hash of readdirSync(cacheDir)) {
    const candidate = path.join(cacheDir, hash, zipName);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const unpackedDir = path.join(root, 'desktop-dist', 'electron-unpacked');
async function ensureElectronUnpacked() {
  if (existsSync(path.join(unpackedDir, 'electron.exe'))) return;
  const zip = findCachedZip();
  if (!zip) return; // 缓存不存在则交给 electron-builder 默认下载流程
  console.log(`📦 预解压 ${zipName} → desktop-dist/electron-unpacked`);
  mkdirSync(unpackedDir, { recursive: true });
  try {
    // unzipper 是 app-builder-lib 的依赖，pnpm 隔离下需从依赖链逐层解析
    const ebRequire = createRequire(require.resolve('electron-builder/package.json'));
    const ablRequire = createRequire(ebRequire.resolve('app-builder-lib/package.json'));
    const unzipper = ablRequire('unzipper');
    await new Promise((resolve, reject) => {
      createReadStream(zip)
        .pipe(unzipper.Extract({ path: unpackedDir }))
        .on('close', resolve)
        .on('error', reject);
    });
  } catch (error) {
    console.warn(`⚠️ unzipper 解压失败（${error.message}），改用 PowerShell Expand-Archive`);
    const result = spawnSync(
      'powershell',
      ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${unpackedDir}' -Force`],
      { stdio: 'inherit' },
    );
    if (result.status !== 0) console.warn('⚠️ Expand-Archive 也失败，将回退 electron-builder 默认流程');
  }
}

await ensureElectronUnpacked();

/* ---------- 按需写入 electronDist / publish（均在 finally 恢复配置） ---------- */

const builderYml = path.join(root, 'electron-builder.yml');
const originalYml = readFileSync(builderYml, 'utf8');
let patchedYml = originalYml;
if (existsSync(path.join(unpackedDir, 'electron.exe'))) {
  // YAML 单引号标量不转义反斜杠，Windows 路径可直接写入
  patchedYml = `${patchedYml.trimEnd()}\n\nelectronDist: '${unpackedDir}'\n`;
  console.log(`⚙️ electronDist → ${unpackedDir}`);
} else {
  console.warn('⚠️ 预解压未就绪，将使用 electron-builder 默认下载解压流程');
}
const updateUrl = process.env.UPDATE_URL;
if (updateUrl) {
  patchedYml = `${patchedYml.trimEnd()}\n\npublish:\n  provider: generic\n  url: '${updateUrl}'\n`;
  console.log(`⚙️ publish → ${updateUrl}`);
} else {
  console.log('ℹ️ 未设置 UPDATE_URL，产物不含自动更新能力');
}
writeFileSync(builderYml, patchedYml);

/* ---------- 执行打包（失败重试兑底） ---------- */

const builderCli = require.resolve('electron-builder/cli.js');
const MAX_ATTEMPTS = 3;
let exitCode = 1;
try {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // --publish never：仅生成 latest.yml 等更新元数据，上传由 CI 的 coscmd 步骤完成
    const result = spawnSync(process.execPath, [builderCli, '--win', '--publish', 'never'], {
      cwd: root,
      stdio: 'inherit',
      env,
    });
    if (result.status === 0) {
      exitCode = 0;
      break;
    }
    if (attempt < MAX_ATTEMPTS) {
      console.warn(`⚠️ electron-builder 第 ${attempt} 次尝试失败（exit ${result.status}），5 秒后重试…`);
      spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},5000)']);
    } else {
      exitCode = result.status ?? 1;
    }
  }
} finally {
  writeFileSync(builderYml, originalYml); // 恢复配置，不污染工作区
}
process.exit(exitCode);

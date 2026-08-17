/**
 * 桌面版服务产物组装：desktop-dist/server/
 *
 * 拷贝规则与 Dockerfile runner 阶段一致：
 * - .next/standalone/*          → desktop-dist/server/（含精简 node_modules 与 server.js）
 * - .next/static                → desktop-dist/server/.next/static（standalone 不含，缺了会 404）
 * - public                      → desktop-dist/server/public
 *
 * 两个平台约束：
 * 1. pnpm 环境下 standalone 产物内含符号链接/junction，且指向仓库级 pnpm 虚拟
 *    存储的绝对路径；electron-builder 复制 extraResources 时会跳过链接，导致
 *    打包后 node_modules 缺失。因此组装时做「全实体化」：
 *    - 以 standalone 自身的 .pnpm 虚拟存储（nft 裁剪过的最小依赖集）为源，
 *      把所有包平铺实体化到产物 node_modules 顶层（npm 风格扁平布局）。
 *      nft 裁剪集内每个包名只有一个版本，扁平布局下 Node 向上查找
 *      node_modules 的解析规则全部可达，无需保留链接与 .pnpm 层级
 *      （直接实体化顶层链接而不同步补齐兄弟依赖会导致 styled-jsx 等解析失败）
 *    - 产物内不保留任何链接，免 symlink 权限，electron-builder 可完整打包
 *    - 依赖目录改名为 server_modules 而非 node_modules：electron-builder 对
 *      extraResources 硬编码排除根级 node_modules（filter 配置无法覆盖），
 *      改名后由主进程启动时注入 NODE_PATH 供 Node 解析（见 electron/main.cjs）
 * 2. standalone 会把仓库根 .env 原样拷入产物（含 DATABASE_URL 等敏感信息），
 *    打包分发前必须删除，数据库连接串由桌面应用首次启动配置窗口管理。
 */
import { cpSync, rmSync, existsSync, mkdirSync, readdirSync, realpathSync, unlinkSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const standaloneDir = path.join(root, '.next', 'standalone');

/** Windows 长路径前缀：历史失控的递归可能留下超 MAX_PATH 的残留目录，普通 API 无法删除 */
function longPath(p) {
  return process.platform === 'win32' && !p.startsWith('\\\\') ? `\\\\?\\${p}` : p;
}

if (!existsSync(path.join(standaloneDir, 'server.js'))) {
  console.error('❌ 未找到 .next/standalone/server.js，请先执行 pnpm build');
  process.exit(1);
}

/**
 * 实体化拷贝：src 可以是链接（跟随到真实目录），递归拷贝全部内容；
 * 损坏链接（其他平台未安装的可选依赖，如 swc-darwin-*）直接跳过
 */
function copyMaterialized(src, dest) {
  const real = realpathSync(src);
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(real, { withFileTypes: true })) {
    const s = path.join(real, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      copyMaterialized(s, d);
    } else {
      try {
        cpSync(s, d, { recursive: lstatSync(realpathSync(s)).isDirectory() });
      } catch (error) {
        if (error.code === 'ENOENT' && entry.isSymbolicLink()) continue;
        throw error;
      }
    }
  }
}

/* ---------------- node_modules 平铺实体化 ----------------
 *
 * 兼容两种仓库依赖布局（standalone 产物结构随 node-linker 变化）：
 * - pnpm 默认嵌套布局：以 standalone 自身的 .pnpm 虚拟存储（nft 裁剪过的
 *   最小依赖集）为源，不跟随指向仓库级 .pnpm 的链接（那是未裁剪的完整
 *   依赖闭包，会把整个仓库 node_modules 拖进产物）
 * - 平铺布局（node-linker=hoisted，CI 为绕开 makensis 260 字符路径限制
 *   而启用）：standalone 的 node_modules 已是 npm 风格扁平结构，无 .pnpm，
 *   直接实体化顶层包即可
 */

const standaloneNm = path.join(standaloneDir, 'node_modules');
const pnpmDir = path.join(standaloneNm, '.pnpm');

// 包名 → 存储目录（.pnpm/<id>/node_modules/<name>）。同名包会在多个 <id> 下重复出现
// （自身 + 其他包的兄弟依赖链接），链接目标在仓库级 .pnpm、实体目录在 standalone 内，
// realpath 必然不同，因此用 package.json 的 version 判断：同版本取其一，
// 不同版本才是真正冲突（扁平布局无法容纳）
const storeByName = new Map();
const versionByName = new Map();
function readPkgVersion(dir) {
  try {
    return JSON.parse(readFileSync(path.join(realpathSync(dir), 'package.json'), 'utf8')).version;
  } catch {
    return null;
  }
}
for (const id of existsSync(pnpmDir) ? readdirSync(pnpmDir) : []) {
  const nm = path.join(pnpmDir, id, 'node_modules');
  if (!existsSync(nm)) continue;
  const remember = (name, dir) => {
    const version = readPkgVersion(dir);
    if (version === null) return; // 损坏链接（其他平台未安装的可选依赖）跳过
    const knownVersion = versionByName.get(name);
    if (knownVersion && knownVersion !== version) {
      throw new Error(`standalone 依赖集出现同名多版本包「${name}」（${knownVersion} vs ${version}），扁平实体化不适用，需要改用重嵌套方案`);
    }
    if (!knownVersion) {
      versionByName.set(name, version);
      storeByName.set(name, dir);
    }
  };
  for (const entry of readdirSync(nm, { withFileTypes: true })) {
    if (entry.name.startsWith('@')) {
      const scopeDir = path.join(nm, entry.name);
      for (const sub of readdirSync(scopeDir, { withFileTypes: true })) {
        remember(`${entry.name}/${sub.name}`, path.join(scopeDir, sub.name));
      }
    } else {
      remember(entry.name, path.join(nm, entry.name));
    }
  }
}

// 平铺布局分支：无 .pnpm 时直接把顶层包登记进 storeByName（扁平结构天然单版本）
if (storeByName.size === 0 && existsSync(standaloneNm)) {
  for (const entry of readdirSync(standaloneNm, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name.startsWith('@')) {
      const scopeDir = path.join(standaloneNm, entry.name);
      for (const sub of readdirSync(scopeDir, { withFileTypes: true })) {
        storeByName.set(`${entry.name}/${sub.name}`, path.join(scopeDir, sub.name));
      }
    } else {
      storeByName.set(entry.name, path.join(standaloneNm, entry.name));
    }
  }
}
if (storeByName.size === 0) {
  console.error('❌ standalone 产物中未找到任何依赖包（node_modules 缺失？）');
  process.exit(1);
}

/* ---------------- 组装 ---------------- */

const outDir = path.join(root, 'desktop-dist', 'server');
rmSync(longPath(outDir), { recursive: true, force: true, maxRetries: 3 });

// standalone 根内容（server.js、package.json、.next 等），node_modules 单独实体化
for (const entry of readdirSync(standaloneDir, { withFileTypes: true })) {
  if (entry.name === 'node_modules') continue;
  const src = path.join(standaloneDir, entry.name);
  const dest = path.join(outDir, entry.name);
  if (entry.isDirectory() && !entry.isSymbolicLink()) {
    copyMaterialized(src, dest);
  } else {
    cpSync(src, dest, { recursive: true });
  }
}

// 注意：目标目录名为 server_modules 而非 node_modules（electron-builder 会硬编码
// 排除 extraResources 根级 node_modules），运行时由 NODE_PATH 补上解析路径
const outNm = path.join(outDir, 'server_modules');
console.log(`📦 平铺实体化 ${storeByName.size} 个包`);
for (const [name, storeDir] of storeByName) {
  copyMaterialized(storeDir, path.join(outNm, ...name.split('/')));
}

cpSync(path.join(root, '.next', 'static'), path.join(outDir, '.next', 'static'), { recursive: true });
cpSync(path.join(root, 'public'), path.join(outDir, 'public'), { recursive: true });

// 删除误入产物的 .env（含 DATABASE_URL 等敏感信息，桌面版由配置窗口管理）
const leakedEnv = path.join(outDir, '.env');
if (existsSync(leakedEnv)) {
  unlinkSync(leakedEnv);
  console.log('🔒 已移除产物中的 .env（敏感信息不随安装包分发）');
}

// 自检：产物内不允许残留任何符号链接/junction
let leftoverLinks = 0;
function assertNoLinks(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      leftoverLinks++;
      console.error('残留链接:', fp);
    } else if (entry.isDirectory()) {
      assertNoLinks(fp);
    }
  }
}
assertNoLinks(outDir);
if (leftoverLinks > 0) {
  console.error(`❌ 产物内残留 ${leftoverLinks} 个链接`);
  process.exit(1);
}

console.log(`✅ 桌面版服务产物已组装（全实体化，无链接）: ${outDir}`);

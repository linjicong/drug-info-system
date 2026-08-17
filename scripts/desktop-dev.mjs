/**
 * 桌面版开发启动：验证与打包一致的链路（standalone + Electron）
 *
 * 1. 若无 .next/standalone/server.js 则先执行 pnpm build
 * 2. 通过 node_modules/electron/cli.js 启动 Electron（开发模式读取仓库根 .env）
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!existsSync(path.join(root, '.next', 'standalone', 'server.js'))) {
  console.log('📦 未检测到 standalone 产物，先执行 pnpm build ...');
  const build = spawnSync('pnpm', ['build'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (build.status !== 0) {
    console.error('❌ pnpm build 失败');
    process.exit(build.status ?? 1);
  }
}

const electronCli = require.resolve('electron/cli.js');
const child = spawn(process.execPath, [electronCli, root], { cwd: root, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
